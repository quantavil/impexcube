import { type Context, type Issue, issue } from './model';
import { ContextSchema, ShipmentSchema } from './schemas';
export function validContext(c: unknown): c is Context {
  return ContextSchema.safeParse(c).success;
}
export function normalizeDate(raw: string): string {
  const m = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(raw.trim());
  const iso = m ? `${m[3]}-${m[2]}-${m[1]}` : raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso))
    throw new Error('Date must be DD/MM/YYYY or YYYY-MM-DD');
  const d = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(d.valueOf()) || d.toISOString().slice(0, 10) !== iso)
    throw new Error('Invalid calendar date');
  return iso;
}
export function normalizeDecimal(raw: string, locale?: string): string {
  let v = raw.trim();
  if (locale === 'de-DE') {
    if (!/^-?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?$/.test(v))
      throw new Error('Invalid decimal');
    v = v.replaceAll('.', '').replace(',', '.');
  } else if (v.includes(',')) {
    if (!locale) throw new Error('Grouped decimal requires locale');
    if (
      !/^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(v) &&
      !(locale === 'en-IN' && /^-?\d{1,2}(?:,\d{2})*,\d{3}(?:\.\d+)?$/.test(v))
    )
      throw new Error('Invalid grouping');
    v = v.replaceAll(',', '');
  }
  if (!/^-?\d+(?:\.\d+)?$/.test(v)) throw new Error('Invalid decimal');
  return v.replace(/^(-?)0+(?=\d)/, '$1');
}
export function validateShipment(s: unknown): Issue[] {
  const parsed = ShipmentSchema.safeParse(s);
  if (!parsed.success)
    return parsed.error.issues.map((e) => {
      const path = e.path.map(String);
      const key =
        path[0] === 'fields'
          ? path[1]
          : path[0] === 'invoices' && path.length > 2
            ? `invoice[${path[1]}].${path[2]}`
            : path[0] === 'products' && path.length > 3
              ? `product[${path[1]}].${path[3]}`
              : path.join('.');
      const code =
        path[0] === 'context'
          ? 'context'
          : e.code === 'custom'
            ? String(e.params?.domainCode ?? 'shape')
            : path.at(-1) === 'value'
              ? /iec|number|gst/i.test(key ?? '')
                ? 'identifier'
                : 'value'
              : 'shape';
      return issue(code, e.message, key);
    });
  return [
    ...Object.entries(parsed.data.fields),
    ...parsed.data.invoices.flatMap((i, n) =>
      Object.entries(i).map(([k, v]) => [`invoice[${n}].${k}`, v] as const),
    ),
    ...(parsed.data.products?.flatMap((p, n) =>
      Object.entries(p.fields).map(
        ([k, v]) => [`product[${n}].${k}`, v] as const,
      ),
    ) ?? []),
  ]
    .filter(([, f]) => f.status === 'conflict')
    .map(([k]) => issue('conflict', 'Conflicting sources need resolution', k));
}

export function displayDate(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value.split('-').reverse().join('/')
    : value;
}

// Convert monetary values exactly, rounding half up to the site's two INR decimals.
export function convertedINR(amount: string, rate: string): string {
  const parts = (raw: string) => {
    const v = normalizeDecimal(raw);
    const [whole, fraction = ''] = v.split('.');
    return { integer: BigInt(whole! + fraction), scale: fraction.length };
  };
  const a = parts(amount),
    b = parts(rate),
    product = a.integer * b.integer,
    negative = product < 0n,
    absolute = negative ? -product : product,
    scale = a.scale + b.scale;
  const cents =
    scale <= 2
      ? absolute * 10n ** BigInt(2 - scale)
      : (absolute + 10n ** BigInt(scale - 2) / 2n) / 10n ** BigInt(scale - 2);
  return (
    (negative && cents ? '-' : '') +
    (cents / 100n).toString() +
    '.' +
    (cents % 100n).toString().padStart(2, '0')
  );
}
