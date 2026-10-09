import type { Candidate, Shipment } from '../domain/model';
import { normalizeDate } from '../domain/validate';
import { normalizeName } from '../policy/identity';
import { openSection, parseJobRows, readFields } from './read';
import type { BrowserSession } from './session';
import { assertSession, BASE_URL, ensureContext, postback } from './session';
export async function listJobNumbers(
  s: BrowserSession,
  spec: Shipment,
): Promise<{ jobNo: string; jobDate: string; cancelled: boolean }[]> {
  await s.page.goto(BASE_URL + 'efrmJobDetails.aspx');
  await assertSession(s);
  const iec = spec.fields['general.iec']?.value;
  const exporter = spec.fields['general.exporter']?.value;
  if (!exporter) throw new Error('Exporter required');
  await s.page
    .locator('#ContentPlaceHolder1_ddlsearch')
    .selectOption({ label: iec ? 'IECCode' : 'Exporter Name' });
  await s.page.locator('#ContentPlaceHolder1_txtSearch').fill(iec ?? exporter);
  await postback(s, () =>
    s.page.getByRole('button', { name: 'Search', exact: true }).click(),
  );
  const found = new Map<
      string,
      { jobNo: string; jobDate: string; cancelled: boolean }
    >(),
    seen = new Set<string>();
  let pageNumber = 1;
  for (;;) {
    await assertSession(s);
    const table = s.page.locator('#ContentPlaceHolder1_gvJobNo');
    if (!(await table.count())) break;
    const signature = await table.innerText();
    if (seen.has(signature)) throw new Error('Pagination did not advance');
    seen.add(signature);
    const rows = await table.locator('tr').evaluateAll((rows) =>
      rows.map((r) =>
        Array.from(r.querySelectorAll(':scope > td'))
          .filter((e) => e.getClientRects().length)
          .map((e) => (e.textContent ?? '').trim()),
      ),
    );
    for (const r of parseJobRows(rows)) found.set(r.jobNo, r);
    pageNumber++;
    const next = table.locator(`a[href*="Page$${pageNumber}'"]`);
    if (await next.count()) await postback(s, () => next.click());
    else {
      const ellipsis = table
        .getByRole('link', { name: '...', exact: true })
        .last();
      const href = (await ellipsis.count())
        ? await ellipsis.getAttribute('href')
        : null;
      const target = href?.match(/Page\$(\d+)/)?.[1];
      if (target && Number(target) === pageNumber)
        await postback(s, () => ellipsis.click());
      else break;
    }
  }
  return [...found.values()];
}
async function hasSearchOption(
  s: BrowserSession,
  label: string,
): Promise<boolean> {
  try {
    const opts = await s.page
      .locator('#ContentPlaceHolder1_ddlsearch option')
      .allTextContents();
    return opts.some((o) => o.trim().toUpperCase() === label.toUpperCase());
  } catch {
    return false;
  }
}

export async function discoverCandidates(
  s: BrowserSession,
  spec: Shipment,
): Promise<Candidate[]> {
  await ensureContext(s, spec.context);
  const out: Candidate[] = [];
  const scan = async () => {
    const iec = spec.fields['general.iec']?.value;
    const consignee = spec.fields['general.consignee']?.value;
    if (consignee) {
      await s.page.goto(BASE_URL + 'efrmJobDetails.aspx');
      await assertSession(s);
      if (await hasSearchOption(s, 'ConsigneeName')) {
        const prefix = consignee
          .split(',')[0]!
          .trim()
          .split(/\s+/)
          .slice(0, 2)
          .join(' ');
        if (prefix.length >= 3) {
          await s.page
            .locator('#ContentPlaceHolder1_ddlsearch')
            .selectOption({ label: 'ConsigneeName' });
          await s.page.locator('#ContentPlaceHolder1_txtSearch').fill(prefix);
          await postback(s, () =>
            s.page.getByRole('button', { name: 'Search', exact: true }).click(),
          );
          const table = s.page.locator('#ContentPlaceHolder1_gvJobNo');
          if ((await table.count()) > 0) {
            const rows = await table.locator('tr').evaluateAll((trs) =>
              trs.map((r) =>
                Array.from(r.querySelectorAll(':scope > td'))
                  .filter((e) => e.getClientRects().length)
                  .map((e) => (e.textContent ?? '').trim()),
              ),
            );
            const cands = parseJobRows(rows).filter((r) => !r.cancelled);
            for (const r of cands) {
              await openSection(s, r.jobNo, 'general');
              const f = await readFields(s, 'general');
              const match = iec
                ? f['general.iec'] === iec
                : normalizeName(f['general.exporter'] ?? '') ===
                  normalizeName(spec.fields['general.exporter']?.value ?? '');
              if (match) {
                out.push({
                  ...r,
                  context: { ...s.context },
                  exporterName: f['general.exporter'] ?? '',
                  iec: f['general.iec'] ?? null,
                  consigneeName: f['general.consignee'] ?? '',
                  mode: f['general.mode'] ?? '',
                  customHouse: f['general.customHouse'] ?? '',
                });
                if (
                  normalizeName(f['general.consignee'] ?? '') ===
                  normalizeName(consignee)
                )
                  return;
              }
            }
            if (out.length) return;
          }
        }
      }
    }
    const records = (await listJobNumbers(s, spec)).filter((r) => !r.cancelled);
    for (const r of records) normalizeDate(r.jobDate);
    records.sort(
      (a, b) =>
        normalizeDate(b.jobDate).localeCompare(normalizeDate(a.jobDate)) ||
        Number(b.jobNo.split('-').at(-1)) - Number(a.jobNo.split('-').at(-1)),
    );
    for (const r of records) {
      if (r.cancelled) continue;
      await openSection(s, r.jobNo, 'general');
      const f = await readFields(s, 'general');
      if (
        spec.fields['general.iec']?.value
          ? f['general.iec'] === spec.fields['general.iec'].value
          : normalizeName(f['general.exporter'] ?? '') ===
            normalizeName(spec.fields['general.exporter']?.value ?? '')
      )
        out.push({
          ...r,
          context: { ...s.context },
          exporterName: f['general.exporter'] ?? '',
          iec: f['general.iec'] ?? null,
          consigneeName: f['general.consignee'] ?? '',
          mode: f['general.mode'] ?? '',
          customHouse: f['general.customHouse'] ?? '',
        });
      if (
        spec.fields['general.iec']?.value &&
        out.at(-1)?.jobNo === r.jobNo &&
        normalizeName(f['general.consignee'] ?? '') ===
          normalizeName(spec.fields['general.consignee']?.value ?? '')
      )
        break;
    }
  };
  await scan();
  if (!out.length) {
    const start = Number(spec.context.financialYear.slice(0, 4));
    await ensureContext(s, {
      branch: spec.context.branch,
      financialYear: `${start - 1}-${start}`,
    });
    await scan();
    await ensureContext(s, spec.context);
  }
  return out;
}
