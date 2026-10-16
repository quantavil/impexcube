import { FIELDS, MANUAL_SECTIONS } from '../policy/fields';
import type { DocumentText, Shipment } from '../schemas';
import { ShipmentSchema } from '../schemas';
import { validateShipment } from '../values';
export function ingestExtraction(
  raw: unknown,
  docs: DocumentText[],
  instructions: Record<string, string> = {},
): Shipment {
  const errors = validateShipment(raw).filter((i) => i.code !== 'conflict');
  if (errors.length)
    throw new Error(
      errors.map((i) => `${i.code}: ${i.field ?? ''}`).join(', '),
    );
  const s = ShipmentSchema.parse(raw);
  for (const [key, field] of [
    ...Object.entries(s.fields),
    ...s.invoices.flatMap((i) => Object.entries(i)),
  ]) {
    if (!field.evidence.length && !['unknown'].includes(field.status))
      throw new Error(`Missing evidence: ${key}`);
    for (const e of field.evidence) {
      const doc = docs.find((d) => d.file === e.file && d.role !== 'reference');
      if (!doc || !e.raw?.trim())
        throw new Error(`Unsupported evidence: ${key}`);
      const matched =
        e.line !== undefined
          ? doc.lines?.some((l) => l.line === e.line && l.text.includes(e.raw))
          : e.page !== undefined
            ? doc.pages?.some(
                (p) => p.page === e.page && p.text.includes(e.raw),
              )
            : false;
      if (!matched) throw new Error(`Evidence location/text not found: ${key}`);
    }
  }
  for (const [path, value] of Object.entries(instructions)) {
    const invMatch = /^invoice\[(\d+)\]\.(.+)$/.exec(path);
    let targetFields: Record<string, any> | undefined = s.fields;
    let key = path;
    if (invMatch) {
      targetFields = s.invoices[Number(invMatch[1])];
      key = invMatch[2]!;
    }
    if (!targetFields)
      throw new Error('Instruction invoice index does not exist: ' + path);
    if (!FIELDS[key]) {
      throw new Error('Unknown instruction field: ' + path);
    }
    targetFields[key] = {
      value,
      status:
        value === ''
          ? 'default'
          : /^0(?:\.0+)?$/.test(value)
            ? 'explicit_zero'
            : 'default',
      evidence: [
        { file: 'user-instructions', page: 1, raw: `${path}=${value}` },
      ],
    };
  }
  // Every consumer pairs invoices positionally (fallback against previous headers,
  // save against the site row), so ascending invoice numbers must be the order.
  // Applied after instructions so instruction invoice[N] keys keep their meaning.
  sortInvoicesAscending(s);
  const remaining = validateShipment(s).filter((i) => i.code !== 'conflict');
  if (remaining.length)
    throw new Error(
      remaining.map((i) => `${i.code}: ${i.field ?? ''}`).join(', '),
    );
  return s;
}

export function invoiceNumberOf(invoice: Record<string, any>): string {
  const value = invoice['invoice.number']?.value;
  return value === null || value === undefined ? '' : String(value);
}

/** Sort invoices ascending by number, numeric-aware so INV-2 precedes INV-10. */
export function sortInvoicesAscending(shipment: Shipment): void {
  const order = shipment.invoices
    .map((invoice, index) => ({ invoice, index }))
    .sort((a, b) => {
      const cmp = invoiceNumberOf(a.invoice).localeCompare(
        invoiceNumberOf(b.invoice),
        undefined,
        { numeric: true, sensitivity: 'base' },
      );
      return cmp !== 0 ? cmp : a.index - b.index;
    });
  shipment.invoices = order.map((o) => o.invoice);
}

/** Printed to the assisting AI; no user-authored JSON or standalone AI provider. */
export function extractionInstructions(): string {
  return [
    'Read the original documents and converted sources below. Complete the internal shipment.json artifact; the user does not author it.',
    'Retain formatVersion, inputFolder, original file paths/hashes, context, and referenceOnly. Set file roles after inspecting originals; completed examples must be referenceOnly.',
    'Populate shipment.fields and one shipment.invoices entry per actual current invoice. Keep identifiers/decimals as strings, dates YYYY-MM-DD, and unknown values null/status unknown.',
    'Every known value needs an exact file/page/raw or file/line/raw quote from converted document text. Reference-role files cannot support current values.',
    'Store explicit user instructions in instructions, keyed by field or invoice[N].field. Do not invent instructions or evidence. Preserve document values even when policy overrides them.',
    'Read FIELD_POLICY_SPEC.md. The deterministic script applies fixed values, locked/no-write rules, missing-value warnings and previous-job fallback. Do not pre-merge previous values into shipment data.',
    'Inspect original PDF visuals and spreadsheet formulas without cached results. Map Notify Party to Third Party, distinct from Buyer.',
    'Do not infer numbered packing ranges. Native customs derives from the folder and site master. Do not extract Product rows for this workflow.',
    'Manual sections: ' + MANUAL_SECTIONS.join(', ') + '.',
    'Mapped fields: ' + Object.keys(FIELDS).join(', '),
  ].join('\n');
}
