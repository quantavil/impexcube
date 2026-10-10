export interface DbkEntry {
  ActualDBK_SERNo?: string;
  ActualDBK_Desc?: string;
  ActualDBKRate?: string;
  ActualDBKSPRate?: string;
  ActualUnit?: string;
  ActualNotnNo?: string;
}

export interface DutyExportInfo {
  ritc: string;
  standardUqc: string | null;
  itemDescription: string | null;
  status: string | null;
  ccr: string | null;
  rodtepUqc: string | null;
  rodtepRate: string | null;
  rodtepDesc: string | null;
  rodtepCapRate: string | null;
  dbkScheduleNo: string | null;
  dbkRate: string | null;
  dbkDesc: string | null;
  dbkUnit: string | null;
  dbkEntries: DbkEntry[];
}

const GENERIC_DBK_WORDS = new Set([
  'MIRROR',
  'MIRRORS',
  'GLASS',
  'ARTICLES',
  'ARTICLE',
  'FURNITURE',
  'PARTS',
  'OTHER',
  'OTHERS',
  'PREDOMINANTLY',
  'MADE',
  'WITH',
  'FROM',
  'TYPE',
  'GOODS',
  'PRODUCTS',
  'ROUND',
  'FRAME',
  'FRAMED',
]);

export function resolveBestDbk(
  dbkEntries?: DbkEntry[],
  itemDescription?: string,
): DbkEntry | null {
  if (!Array.isArray(dbkEntries) || dbkEntries.length === 0) return null;

  const positiveRates = dbkEntries.filter(
    (d) => Number(d.ActualDBKRate || 0) > 0,
  );
  const candidates = positiveRates.length > 0 ? positiveRates : dbkEntries;

  if (itemDescription) {
    const descClean = itemDescription.toUpperCase();
    const match = candidates.find((d) => {
      const entryDesc = (d.ActualDBK_Desc || '').trim().toUpperCase();
      if (!entryDesc || /^(?:OTHERS?|ALL\s+OTHERS?)$/.test(entryDesc))
        return false;
      const words = entryDesc
        .split(/[\s,/-]+/)
        .filter((w) => w.length > 3 && !GENERIC_DBK_WORDS.has(w));
      return words.length > 0 && words.some((w) => descClean.includes(w));
    });
    if (match) return match;
  }

  const otherMatch = candidates.find((d) =>
    /other/i.test(d.ActualDBK_Desc || ''),
  );
  if (otherMatch) return otherMatch;

  const sorted = [...candidates].sort(
    (a, b) => Number(b.ActualDBKRate || 0) - Number(a.ActualDBKRate || 0),
  );
  return sorted[0] || null;
}

const DUTY_BASE_URL = 'https://impexcube.in/DutyStructureExport';
const inMemoryDutyCache = new Map<string, DutyExportInfo | null>();

export async function fetchDutyExportStructure(
  ritc: string,
  country = 'null',
): Promise<DutyExportInfo | null> {
  const cleanRitc = String(ritc || '').trim();
  if (!cleanRitc) return null;

  const cacheKey = `${cleanRitc}_${country}`;
  if (inMemoryDutyCache.has(cacheKey)) {
    return inMemoryDutyCache.get(cacheKey) || null;
  }

  const headers = { 'Content-Type': 'application/json' };

  try {
    const [descRes, rodtepRes, dbkRes] = await Promise.all([
      fetch(`${DUTY_BASE_URL}/FillDescription`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          RITC: cleanRitc,
          Country: country,
          Mode: 'Description',
        }),
        signal: AbortSignal.timeout(5000),
      })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),

      fetch(`${DUTY_BASE_URL}/GetDetails`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          RITC: cleanRitc,
          Country: country,
          Mode: 'RODEP',
        }),
        signal: AbortSignal.timeout(5000),
      })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),

      fetch(`${DUTY_BASE_URL}/FillDBK`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          RITC: cleanRitc,
          Country: country,
          Mode: 'DBK',
        }),
        signal: AbortSignal.timeout(5000),
      })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]);

    const descItem = Array.isArray(descRes) ? descRes[0] : null;
    const rodtepItem = Array.isArray(rodtepRes) ? rodtepRes[0] : null;
    const dbkEntries: DbkEntry[] = Array.isArray(dbkRes) ? dbkRes : [];

    const bestDbk = resolveBestDbk(dbkEntries);

    const result: DutyExportInfo = {
      ritc: cleanRitc,
      standardUqc: descItem?.StandardUQC?.trim() || null,
      itemDescription: descItem?.Item_Description?.trim() || null,
      status: descItem?.Status?.trim() || null,
      ccr: descItem?.Item_CCR?.trim() || null,
      rodtepUqc: rodtepItem?.RoDTEPUQC?.trim() || null,
      rodtepRate: rodtepItem?.RoDTEPRatePer?.trim() || null,
      rodtepDesc: rodtepItem?.RoDTEPDesc?.trim() || null,
      rodtepCapRate: rodtepItem?.RoDTEPCapRate?.trim() || null,
      dbkScheduleNo: bestDbk?.ActualDBK_SERNo?.trim() || null,
      dbkRate: bestDbk?.ActualDBKRate?.trim() || null,
      dbkDesc: bestDbk?.ActualDBK_Desc?.trim() || null,
      dbkUnit: bestDbk?.ActualUnit?.trim() || null,
      dbkEntries,
    };

    inMemoryDutyCache.set(cacheKey, result);
    return result;
  } catch (err: any) {
    console.warn(
      `Could not fetch duty export structure for ${cleanRitc}: ${err.message}`,
    );
    inMemoryDutyCache.set(cacheKey, null);
    return null;
  }
}
