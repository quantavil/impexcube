export interface DutyExportInfo {
  ritc: string;
  standardUqc: string | null;
  itemDescription: string | null;
  status: string | null;
  rodtepUqc: string | null;
  rodtepRate: string | null;
  rodtepDesc: string | null;
  rodtepCapRate: string | null;
  dbkScheduleNo: string | null;
  dbkRate: string | null;
  dbkDesc: string | null;
  dbkUnit: string | null;
}

const DUTY_BASE_URL = 'https://impexcube.in/DutyStructureExport';

export async function fetchDutyExportStructure(
  ritc: string,
): Promise<DutyExportInfo | null> {
  const cleanRitc = String(ritc || '').trim();
  if (!cleanRitc) return null;

  const headers = { 'Content-Type': 'application/json' };

  try {
    const [descRes, rodtepRes, dbkRes] = await Promise.all([
      fetch(`${DUTY_BASE_URL}/FillDescription`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          RITC: cleanRitc,
          Country: 'null',
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
          Country: 'null',
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
          Country: 'null',
          Mode: 'DBK',
        }),
        signal: AbortSignal.timeout(5000),
      })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]);

    const descItem = Array.isArray(descRes) ? descRes[0] : null;
    const rodtepItem = Array.isArray(rodtepRes) ? rodtepRes[0] : null;

    let bestDbk: any = null;
    if (Array.isArray(dbkRes) && dbkRes.length > 0) {
      bestDbk =
        dbkRes.find(
          (d: any) =>
            Number(d.ActualDBKRate || 0) > 0 &&
            /other/i.test(d.ActualDBK_Desc || ''),
        ) ||
        dbkRes.find((d: any) => Number(d.ActualDBKRate || 0) > 0) ||
        dbkRes[0];
    }

    return {
      ritc: cleanRitc,
      standardUqc: descItem?.StandardUQC?.trim() || null,
      itemDescription: descItem?.Item_Description?.trim() || null,
      status: descItem?.Status?.trim() || null,
      rodtepUqc: rodtepItem?.RoDTEPUQC?.trim() || null,
      rodtepRate: rodtepItem?.RoDTEPRatePer?.trim() || null,
      rodtepDesc: rodtepItem?.RoDTEPDesc?.trim() || null,
      rodtepCapRate: rodtepItem?.RoDTEPCapRate?.trim() || null,
      dbkScheduleNo: bestDbk?.ActualDBK_SERNo?.trim() || null,
      dbkRate: bestDbk?.ActualDBKRate?.trim() || null,
      dbkDesc: bestDbk?.ActualDBK_Desc?.trim() || null,
      dbkUnit: bestDbk?.ActualUnit?.trim() || null,
    };
  } catch (err: any) {
    console.warn(
      `Could not fetch duty export structure for ${cleanRitc}: ${err.message}`,
    );
    return null;
  }
}
