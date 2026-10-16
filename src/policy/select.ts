import {
  type Candidate,
  type Issue,
  issue,
  type Selection,
  type Shipment,
} from '../schemas';
import { normalizeDate, normalizeName } from '../values';
export function selectSource(
  candidates: Candidate[],
  s: Shipment,
): Selection | Issue[] {
  const name = s.fields['general.exporter']?.value ?? '',
    iec = s.fields['general.iec']?.value,
    consignee = s.fields['general.consignee']?.value ?? '';
  const consigneeKey = normalizeName(consignee);
  if (!normalizeName(name)) return [issue('identity', 'Exporter required')];
  let pool = candidates.filter(
    (c) =>
      !c.cancelled &&
      (iec
        ? c.iec === iec
        : normalizeName(c.exporterName) === normalizeName(name)),
  );
  if (!pool.length)
    return [
      issue('no_source', 'No eligible exporter job in selected financial year'),
    ];
  if (!iec && new Set(pool.map((c) => c.iec).filter(Boolean)).size !== 1)
    return [issue('identity', 'Exporter name does not establish a unique IEC')];
  pool = pool.filter(
    (c) => c.context.financialYear === s.context.financialYear,
  );
  if (!pool.length)
    return [
      issue('no_source', 'No eligible exporter job in selected financial year'),
    ];
  const sameBranch = pool.filter((c) => c.context.branch === s.context.branch);
  if (sameBranch.length) pool = sameBranch;
  try {
    for (const c of pool) {
      normalizeDate(c.jobDate);
      if (!/-\d+$/.test(c.jobNo)) throw new Error();
    }
  } catch {
    return [
      issue(
        'job_date',
        'Candidate date or sequence cannot be ordered reliably',
      ),
    ];
  }
  const same = consigneeKey
    ? pool.filter((c) => normalizeName(c.consigneeName) === consigneeKey)
    : [];
  const sorted = (same.length ? same : pool).sort(
    (a, b) =>
      normalizeDate(b.jobDate).localeCompare(normalizeDate(a.jobDate)) ||
      Number(b.jobNo.split('-').at(-1)) - Number(a.jobNo.split('-').at(-1)),
  );
  return {
    source: sorted[0]!,
    reason: same.length ? 'same_consignee' : 'exporter_fallback',
  };
}
