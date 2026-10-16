import {
  type Field,
  issue,
  type Operation,
  type Patch,
  type Shipment,
  type Snapshot,
} from '../schemas';
import {
  normalizeDate,
  normalizeDecimal,
  normalizeInvoiceNumber,
  normalizeName,
  validateShipment,
} from '../values';
import {
  type Definition,
  FIELDS,
  mergeMarks,
  UNSUPPORTED_FIELDS,
  validateHeaderRules,
} from './fields';
export function isAllowed(o: Operation): boolean {
  const d = FIELDS[o.field];
  return (
    !!d &&
    !d.readonly &&
    d.kind !== 'packing' &&
    !['site', 'none'].includes(d.source) &&
    d.section === o.section
  );
}
// Resolve the same way for field values and conditional dependencies.
function selectValue(
  d: Definition,
  field: Field | undefined,
  previous: string | undefined,
): { value: string | undefined; source: 'new' | 'old' | 'rule' } {
  const known = field && field.status !== 'unknown' && field.value !== null;
  const fresh = {
    value: known ? field.value! : undefined,
    source: 'new' as const,
  };
  const old = {
    value: previous,
    source: 'old' as const,
  };
  const empty = {
    value: d.value ?? (d.kind === 'check' ? 'false' : ''),
    source: 'rule' as const,
  };
  switch (d.source) {
    case 'fixed':
      return { value: d.value, source: 'rule' };
    case 'new_or_old':
      return known ? fresh : old.value !== undefined ? old : empty;
    case 'new':
    case 'derived':
      return known ? fresh : empty;
    case 'site':
    case 'none':
      return { value: undefined, source: 'rule' };
  }
}
/** Resolve readonly master-selection fallbacks without rewriting document evidence. */
export function resolveMasterRequest(
  source: Snapshot | null,
  shipment: Shipment,
): Shipment {
  const request = structuredClone(shipment);
  for (const [key, d] of Object.entries(FIELDS)) {
    if (!d.identity || d.source !== 'new_or_old') continue;
    const choice = selectValue(d, shipment.fields[key], source?.fields[key]);
    if (choice.source === 'new') continue;
    request.fields[key] = {
      value: choice.value ?? null,
      status: choice.value === undefined ? 'unknown' : 'default',
      evidence:
        choice.source === 'old' && choice.value !== undefined
          ? [{ file: 'previous-job', raw: choice.value }]
          : [],
    };
  }
  return request;
}

export function mergeShipment(
  source: Snapshot | null,
  s: Shipment,
  master: Record<string, string> = {},
): Patch {
  const p: Patch = {
    operations: [],
    issues: validateShipment(s).filter((entry) => {
      if (entry.code !== 'conflict' || !entry.field) return true;
      const key = entry.field.replace(/^invoice\[\d+\]\./, '');
      return (
        !UNSUPPORTED_FIELDS.includes(
          key as (typeof UNSUPPORTED_FIELDS)[number],
        ) && !['fixed', 'site', 'none'].includes(FIELDS[key]?.source ?? '')
      );
    }),
  };
  if (
    p.issues.some(
      (i) =>
        i.code === 'shape' || i.code === 'value' || i.code === 'identifier',
    )
  )
    return p;
  const invoiceNumbers = new Set<string>();
  for (const [index, invoice] of s.invoices.entries()) {
    const field = invoice['invoice.number'];
    if (!field || field.status === 'unknown' || field.value === null) continue;
    const number = normalizeInvoiceNumber(field.value);
    if (!number) continue;
    if (invoiceNumbers.has(number))
      p.issues.push(
        issue(
          'duplicate_invoice',
          'Current invoices have the same normalized number; resolve before creating a job',
          `invoice[${index}].invoice.number`,
        ),
      );
    invoiceNumbers.add(number);
  }
  const consume = (
    fields: Record<string, Field>,
    old: Record<string, string>,
    invoiceIndex?: number,
  ) => {
    const allowedSections =
      invoiceIndex === undefined
        ? ['general', 'shipment']
        : ['invoice', 'charges', 'thirdParty'];
    for (const [key, _f] of Object.entries(fields))
      if (
        !UNSUPPORTED_FIELDS.includes(
          key as (typeof UNSUPPORTED_FIELDS)[number],
        ) &&
        (!FIELDS[key] || !allowedSections.includes(FIELDS[key]!.section))
      )
        p.issues.push(
          issue(
            'excluded',
            'Unknown, excluded or incorrectly scoped field',
            key,
          ),
        );
    const definitions = Object.entries(FIELDS).filter(([, d]) =>
      allowedSections.includes(d.section),
    );
    const choices = Object.fromEntries(
      definitions.map(([key, d]) => {
        const choice = selectValue(
          d,
          fields[key],
          d.identity ? (master[key] ?? old[key]) : old[key],
        );
        return [
          key,
          {
            ...choice,
            evidence:
              choice.source === 'old' && choice.value !== undefined
                ? [{ file: 'previous-job', raw: old[key]! }]
                : choice.source === 'new'
                  ? (fields[key]?.evidence ?? [])
                  : [],
          },
        ];
      }),
    );
    const resolvedFields: Record<string, Field> = Object.fromEntries(
      Object.entries(choices).map(([key, choice]) => [
        key,
        {
          value: choice.value ?? null,
          status: choice.value === undefined ? 'unknown' : 'default',
          evidence: choice.evidence,
        },
      ]),
    );
    for (const [key, d] of definitions) {
      const f = fields[key];
      if (d.when) {
        const condition = FIELDS[d.when.field];
        if (
          !condition ||
          selectValue(
            condition,
            s.fields[d.when.field],
            source?.fields[d.when.field],
          ).value !== d.when.value
        )
          continue;
      }
      const known = f && f.status !== 'unknown' && f.value !== null;
      const previous = d.identity ? (master[key] ?? old[key]) : old[key];
      if (d.identity && known && f.value && previous) {
        const matches =
          d.identity === 'exact'
            ? f.value === previous
            : normalizeName(f.value) === normalizeName(previous);
        if (!matches)
          p.issues.push(
            issue('identity', 'Exporter master differs from document', key),
          );
      }
      if (d.readonly || d.source === 'site' || d.source === 'none') continue;
      if (f?.status === 'conflict' && d.source !== 'fixed') continue;
      const choice = choices[key]!;
      const selected = choice.source;
      let value = choice.value;
      if (
        d.source === 'fixed' &&
        (f?.status === 'conflict' ||
          (known && f.value !== value) ||
          (previous !== undefined && previous !== value))
      )
        p.issues.push(
          issue(
            'fixed_override',
            'Configured fixed value overrides supplied or previous value',
            key,
            false,
          ),
        );
      if (value === undefined) continue;
      if (
        selected === 'rule' &&
        ['new', 'new_or_old', 'derived'].includes(d.source)
      )
        p.issues.push(
          issue(
            d.value !== undefined ? 'missing_default' : 'missing',
            d.value !== undefined
              ? `No available value; defaulted to ${d.value}`
              : 'No available value; left empty',
            key,
            false,
          ),
        );
      // Packing fields are fixed empty metadata; native numbered rows are never written.
      if (d.kind === 'packing') continue;
      if (
        d.transform === 'marks' &&
        (selected === 'old' || selected === 'new') &&
        previous
      ) {
        const marks = mergeMarks(
          previous,
          value,
          resolvedFields,
          selected === 'new' && f?.status === 'default',
        );
        if (typeof marks !== 'string') {
          p.issues.push(marks);
          continue;
        }
        value = marks;
      }
      try {
        if (d.kind === 'date' && value) value = normalizeDate(value);
        if (d.kind === 'decimal' && value) value = normalizeDecimal(value);
        if (d.kind === 'check' && !['true', 'false'].includes(value))
          throw new Error();
      } catch {
        p.issues.push(issue('format', 'Invalid field format', key));
        continue;
      }
      value =
        d.aliases?.[value.trim().toUpperCase().replace(/\s+/g, ' ')] ?? value;
      const evidence =
        d.transform === 'marks' && value !== choice.value
          ? [
              ...(selected === 'old' ? [] : choice.evidence),
              ...(resolvedFields['shipment.packages']?.evidence ?? []),
              { file: 'previous-job', raw: previous! },
            ]
          : choice.evidence;
      p.operations.push({
        section: d.section,
        field: key,
        action:
          value === old[key] ? 'carry' : value === '' ? 'clear' : 'replace',
        value,
        invoiceIndex,
        evidence,
      });
    }
  };
  consume(s.fields, source?.fields ?? {});
  const previousInvoices = [...(source?.invoices ?? [])].sort((a, b) =>
    (a['invoice.number'] ?? '').localeCompare(
      b['invoice.number'] ?? '',
      undefined,
      { numeric: true, sensitivity: 'base' },
    ),
  );
  s.invoices.forEach((i, n) => {
    consume(i, previousInvoices[n] ?? {}, n);
  });
  p.issues.push(...validateHeaderRules(source, s, p.operations));
  p.issues.push(
    issue(
      'unsupported_fields',
      `No inspected controls for: ${UNSUPPORTED_FIELDS.join(', ')}`,
      undefined,
      false,
    ),
  );
  return p;
}
