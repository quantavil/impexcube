import type { DocumentText, Shipment } from '../domain/model';
import { validateShipment } from '../domain/validate';
import { FIELDS } from '../policy/fields';
export function ingestExtraction(
  raw: unknown,
  docs: DocumentText[],
  instructions: Record<string, string> = {},
): Shipment {
  const s = structuredClone(raw) as Shipment;
  const errors = validateShipment(s).filter((i) => i.code !== 'conflict');
  if (errors.length)
    throw new Error(
      errors.map((i) => `${i.code}: ${i.field ?? ''}`).join(', '),
    );
  for (const [key, field] of [
    ...Object.entries(s.fields),
    ...s.invoices.flatMap((i) => Object.entries(i)),
    ...(s.products?.flatMap((p) => Object.entries(p.fields)) ?? []),
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
            : doc.cells?.some(
                (c) =>
                  c.sheet === e.sheet &&
                  c.cell === e.cell &&
                  c.raw.includes(e.raw),
              );
      if (!matched) throw new Error(`Evidence location/text not found: ${key}`);
    }
  }
  for (const [path, value] of Object.entries(instructions)) {
    const invMatch = /^invoice\[(\d+)\]\.(.+)$/.exec(path);
    const prodMatch = /^product\[(\d+)\]\.(.+)$/.exec(path);
    let targetFields: Record<string, any> | undefined = s.fields;
    let key = path;
    if (invMatch) {
      targetFields = s.invoices[Number(invMatch[1])];
      key = invMatch[2]!;
    } else if (prodMatch) {
      targetFields = s.products?.[Number(prodMatch[1])]?.fields;
      key = prodMatch[2]!;
    }
    if (!targetFields) continue;
    if (prodMatch) {
      targetFields[key] = {
        value,
        status:
          value === ''
            ? 'default'
            : /^0(?:\.0+)?$/.test(value)
              ? 'explicit_zero'
              : 'default',
        evidence: [{ file: 'manifest.json', page: 1, raw: `${path}=${value}` }],
      };
      continue;
    }
    if (!FIELDS[key]) throw new Error('Unknown instruction field: ' + path);
    targetFields[key] = {
      value,
      status:
        value === ''
          ? 'default'
          : /^0(?:\.0+)?$/.test(value)
            ? 'explicit_zero'
            : 'default',
      evidence: [{ file: 'manifest.json', page: 1, raw: `${path}=${value}` }],
    };
  }
  const remaining = validateShipment(s);
  if (remaining.length)
    throw new Error(
      remaining.map((i) => `${i.code}: ${i.field ?? ''}`).join(', '),
    );
  return s;
}
