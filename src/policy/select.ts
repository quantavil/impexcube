import {
  type Candidate,
  type Issue,
  issue,
  type Selection,
  type Shipment,
} from '../domain/model';
import { normalizeDate } from '../domain/validate';
import { normalizeName } from './identity';
export function selectSource(
  candidates: Candidate[],
  s: Shipment,
): Selection | Issue[] {
  const name = s.fields['general.exporter']?.value ?? '',
    iec = s.fields['general.iec']?.value,
    consignee = s.fields['general.consignee']?.value ?? '';
  if (!name || !consignee)
    return [issue('identity', 'Exporter and consignee required')];
  let pool = candidates.filter(
    (c) =>
      c.context.branch === s.context.branch &&
      !c.cancelled &&
      (iec
        ? c.iec === iec
        : normalizeName(c.exporterName) === normalizeName(name)),
  );
  if (!iec && new Set(pool.map((c) => c.iec).filter(Boolean)).size !== 1)
    return [issue('identity', 'Exporter name does not establish a unique IEC')];
  const current = pool.filter(
    (c) => c.context.financialYear === s.context.financialYear,
  );
  const start = Number(s.context.financialYear.slice(0, 4));
  pool = current.length
    ? current
    : pool.filter((c) => c.context.financialYear === `${start - 1}-${start}`);
  if (!pool.length)
    return [
      issue(
        'no_source',
        'No eligible exporter job in selected or previous year',
      ),
    ];
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
  const same = pool.filter(
    (c) => normalizeName(c.consigneeName) === normalizeName(consignee),
  );
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
