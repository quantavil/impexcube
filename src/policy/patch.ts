import {
  type Field,
  issue,
  type Operation,
  type Patch,
  type Shipment,
  type Snapshot,
} from '../domain/model';
import {
  normalizeDate,
  normalizeDecimal,
  validateShipment,
} from '../domain/validate';
import { FIELDS } from './fields';
import { normalizeName } from './identity';
export function isAllowed(o: Operation): boolean {
  const d = FIELDS[o.field];
  return !!d && !d.readonly && d.section === o.section;
}
export function buildPatch(source: Snapshot, s: Shipment): Patch {
  const p: Patch = { operations: [], issues: validateShipment(s) };
  if (
    p.issues.some(
      (i) =>
        i.code === 'shape' || i.code === 'value' || i.code === 'identifier',
    )
  )
    return p;
  if (source.context.branch !== s.context.branch)
    p.issues.push(issue('context', 'Cross-branch copy is forbidden'));
  if (source.invoices.length !== s.invoices.length || !s.invoices.length)
    p.issues.push(
      issue(
        'invoice_count',
        'Invoice count differs; preserve old products and resolve mapping first',
      ),
    );
  if (
    s.fields['general.iec']?.value &&
    s.fields['general.iec'].value !== source.fields['general.iec']
  )
    p.issues.push(issue('identity', 'Exporter IEC differs from source'));
  for (const [key, f] of Object.entries(s.fields))
    if (
      [
        'general.exporter',
        'general.exporterAddress',
        'general.gst',
        'general.adCode',
      ].includes(key) &&
      f.value &&
      source.fields[key] &&
      normalizeName(f.value) !== normalizeName(source.fields[key]!)
    )
      p.issues.push(
        issue('identity', 'Exporter master differs from document', key),
      );
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
      if (!FIELDS[key] || !allowedSections.includes(FIELDS[key]!.section))
        p.issues.push(
          issue(
            'excluded',
            'Unknown, excluded or incorrectly scoped field',
            key,
          ),
        );
    for (const [key, d] of Object.entries(FIELDS)) {
      if (!allowedSections.includes(d.section)) continue;
      const f = fields[key];
      if (d.readonly) continue;
      if (!f || f.status === 'unknown' || f.value === null) {
        if (d.required)
          p.issues.push(
            issue(
              'required',
              'Current evidence or explicit instruction required',
              key,
            ),
          );
        else if (d.reset)
          p.operations.push({
            section: d.section,
            field: key,
            action: 'clear',
            value: d.kind === 'decimal' ? '0' : '',
            invoiceIndex,
            evidence: [],
          });
        continue;
      }
      if (f.status === 'conflict') continue;
      let value = f.value;
      if (
        key === 'shipment.marks' &&
        f.status === 'sourced' &&
        old[key] &&
        value !== old[key]
      ) {
        const previous = old[key]!;
        if (/^\d+\s*[-–]\s*\d+$/.test(value.trim())) {
          const total = fields['shipment.packages']?.value;
          if (
            !total ||
            !/^\d+$/.test(total) ||
            fields['shipment.packageUnit']?.value !== 'CTN' ||
            !/^TOTAL\s+\d+\s+CARTONS\b/i.test(previous)
          ) {
            p.issues.push(
              issue(
                'marks_review',
                'Carton range alone cannot safely replace inherited Marks & Nos; provide reviewed complete marks as an instruction',
                key,
              ),
            );
            continue;
          }
          value =
            previous
              .replace(/^(TOTAL\s+)\d+(\s+CARTONS\b)/i, `$1${total}$2`)
              .replace(/\s+CARTON NOS\.\s*\d+\s*[-–]\s*\d+\s*$/i, '')
              .trim() +
            ` CARTON NOS. ${value.trim().replace(/\s*[-–]\s*/, '-')}`;
        } else if (/LUT|RODTEP/i.test(previous) && !/LUT|RODTEP/i.test(value)) {
          p.issues.push(
            issue(
              'marks_review',
              'Document marks omit inherited declarations; provide reviewed complete marks as an instruction',
              key,
            ),
          );
          continue;
        }
      }
      if (d.required && !d.allowBlank && !value.trim()) {
        p.issues.push(
          issue('required', 'Mandatory value cannot be blank', key),
        );
        continue;
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
      const evidence =
        key === 'shipment.marks' && value !== f.value
          ? [
              ...f.evidence,
              ...(fields['shipment.packages']?.evidence ?? []),
              { file: 'previous-job', raw: old[key]! },
            ]
          : f.evidence;
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
  consume(s.fields, source.fields);
  s.invoices.forEach((i, n) => {
    consume(i, source.invoices[n] ?? {}, n);
  });
  p.operations = p.operations.filter(
    (o) => !['general.sbNumber', 'general.sbDate'].includes(o.field),
  );
  p.operations.push(
    {
      section: 'general',
      field: 'general.sbNumber',
      action: 'replace',
      value: '0',
      evidence: [],
    },
    {
      section: 'general',
      field: 'general.sbDate',
      action: 'clear',
      value: '',
      evidence: [],
    },
  );
  if (s.fields['general.buyerDifferent']?.value === 'true')
    for (const key of [
      'general.buyer',
      'general.buyerAddress',
      'general.buyerCountry',
    ])
      if (!s.fields[key]?.value)
        p.issues.push(
          issue('required', 'Different buyer details are required', key),
        );
  if (s.fields['general.buyerDifferent']?.value === 'false')
    p.operations = p.operations.filter(
      (o) =>
        ![
          'general.buyer',
          'general.buyerAddress',
          'general.buyerCountry',
        ].includes(o.field),
    );
  const gross = s.fields['shipment.grossWeight']?.value,
    net = s.fields['shipment.netWeight']?.value;
  if (
    gross &&
    net &&
    s.fields['shipment.grossUnit']?.value ===
      s.fields['shipment.netUnit']?.value &&
    Number(net) > Number(gross)
  )
    p.issues.push(issue('weight', 'Net weight exceeds gross weight'));
  const from = s.fields['shipment.packingFrom']?.value,
    to = s.fields['shipment.packingTo']?.value,
    total = s.fields['shipment.packages']?.value;
  if (source.packingRanges && source.packingRanges.length > 1)
    p.issues.push(
      issue(
        'packing_ranges',
        'Only zero or one copied packing range is supported; resolve complex packing first',
      ),
    );
  if (from && to && total) {
    if (
      !/^\d+$/.test(from) ||
      !/^\d+$/.test(to) ||
      !/^\d+$/.test(total) ||
      BigInt(from) < 1n ||
      BigInt(to) < BigInt(from) ||
      BigInt(to) - BigInt(from) + 1n !== BigInt(total)
    )
      p.issues.push(
        issue(
          'packing_count',
          'Packing range does not reconcile with package count',
        ),
      );
  }
  if (
    s.fields['shipment.packingUnit']?.value &&
    s.fields['shipment.packageUnit']?.value &&
    s.fields['shipment.packingUnit']?.value !==
      s.fields['shipment.packageUnit']?.value
  )
    p.issues.push(issue('packing_unit', 'Packing and total units differ'));
  return p;
}
