import { FIELDS } from '../policy/fields';
import type {
  Candidate,
  Context,
  Section,
  Shipment,
  Snapshot,
} from '../schemas';
import { normalizeDate, normalizeName } from '../values';
import type { BrowserSession } from './session';
import {
  assertSession,
  BASE_URL,
  ensureContext,
  postback,
  selectSessionControl,
} from './session';
export function assertContextText(text: string, c: Context): void {
  const branch = /Branch\s*:\s*(DELHI|MORADABAD)\b/.exec(text)?.[1];
  const year = /Fin\.Year\s*:\s*(\d{4}-\d{4})/.exec(text)?.[1];
  if (
    !text.includes('VISHAL LOGISTICS SOLUTIONS') ||
    branch !== c.branch ||
    year !== c.financialYear
  )
    throw new Error('Session expired or branch/year differs');
}
export function parseJobRows(
  rows: string[][],
): { jobNo: string; jobDate: string; cancelled: boolean }[] {
  return rows.flatMap((c) => {
    const no = c.findIndex((t) => /^(VIDE-)?EXP-\d{4}-\d+$/.test(t.trim()));
    if (no < 0) return [];
    const jobNo = c[no]!.trim();
    const jobDate =
      c.find((t) => /^\d{2}\/\d{2}\/\d{4}$/.test(t.trim()))?.trim() ?? '';
    return [
      {
        jobNo,
        jobDate,
        cancelled: c.some((t) => /^CANCELLED?$/i.test(t.trim())),
      },
    ];
  });
}
export function jobUrl(jobNo: string): string {
  if (!/^(VIDE-)?EXP-\d{4}-\d+$/.test(jobNo))
    throw new Error('Invalid job identifier');
  return (
    BASE_URL +
    'frmExportJobCreation.aspx?JobNo=' +
    encodeURIComponent(jobNo) +
    '&Mode=Edit'
  );
}
export async function openSection(
  s: BrowserSession,
  jobNo: string,
  section: Section,
  index = 0,
  options: { reload?: boolean; allowEmptyInvoice?: boolean } = {},
): Promise<void> {
  const url = jobUrl(jobNo),
    current = new URL(s.page.url());
  const jobPage = current.pathname === '/frmExportJobCreation.aspx';
  const knownPage =
    current.origin + '/' === BASE_URL &&
    (jobPage ||
      ['/efrmShipment.aspx', '/efrmInvoiceDetails.aspx'].includes(
        current.pathname,
      ));
  const state =
    knownPage && !options.reload
      ? await s.page.locator('body').evaluate((body, id) => {
          const data = (body as HTMLElement).dataset,
            number = (document.getElementById(id) as HTMLInputElement | null)
              ?.value;
          return {
            jobs: [
              'ContentPlaceHolder1_txtjno',
              'ContentPlaceHolder1_txtJobNo',
            ].map(
              (key) =>
                (document.getElementById(key) as HTMLInputElement | null)
                  ?.value,
            ),
            selected:
              number !== undefined && number === data.impexSelectedInvoiceNumber
                ? data.impexSelectedInvoice
                : undefined,
          };
        }, FIELDS['invoice.number']!.id)
      : null;
  const reuse =
    state?.jobs.includes(jobNo) &&
    (!jobPage || current.searchParams.get('JobNo') === jobNo);
  if (!reuse) await s.page.goto(url);
  await assertSession(s, jobNo);
  const anchor =
    section === 'general'
      ? FIELDS['general.exporter']
      : section === 'shipment'
        ? FIELDS['shipment.packages']
        : Object.values(FIELDS).find((d) => d.section === section);
  const invoiceSection = ['invoice', 'charges', 'thirdParty'].includes(section),
    sameInvoice = reuse && state?.selected === jobNo + ':' + index;
  if (
    anchor &&
    (await s.page.locator('#' + anchor.id).isVisible()) &&
    (!invoiceSection || sameInvoice)
  )
    return;
  if (section === 'general') {
    const tab = s.page.getByRole('link', {
        name: 'General Details',
        exact: true,
      }),
      back = s.page.getByRole('button', { name: 'Job Details', exact: true });
    if (await tab.isVisible()) await tab.click();
    else if (await back.isVisible()) await postback(s, () => back.click());
    else await s.page.goto(url);
  } else if (section === 'shipment') {
    if (
      new URL(s.page.url()).pathname !== '/frmExportJobCreation.aspx' ||
      !(await s.page
        .getByRole('button', { name: 'Shipment', exact: true })
        .isVisible())
    )
      await openSection(s, jobNo, 'general');
    await postback(s, () =>
      s.page.getByRole('button', { name: 'Shipment', exact: true }).click(),
    );
  } else if (section === 'exchange') {
    if (
      !(await s.page
        .getByRole('link', { name: 'Exchange Rate', exact: true })
        .isVisible())
    )
      await openSection(s, jobNo, 'general');
    await postback(s, () =>
      s.page.getByRole('link', { name: 'Exchange Rate', exact: true }).click(),
    );
  } else {
    if (!sameInvoice || section === 'invoice') {
      if (
        !(await s.page.locator('#' + FIELDS['invoice.number']!.id).isVisible())
      ) {
        if (
          new URL(s.page.url()).pathname !== '/frmExportJobCreation.aspx' ||
          !(await s.page
            .getByRole('button', { name: 'Invoice', exact: true })
            .isVisible())
        )
          await openSection(s, jobNo, 'general');
        await postback(s, () =>
          s.page.getByRole('button', { name: 'Invoice', exact: true }).click(),
        );
        await assertSession(s, jobNo);
      }
      const row = s.page
        .locator('#ContentPlaceHolder1_tbInvoice_TabPanel1_gvInvoiceDetails tr')
        .filter({
          has: s.page.getByRole('link', { name: 'Select', exact: true }),
        })
        .nth(index);
      if ((await row.count()) !== 1) {
        if (options.allowEmptyInvoice && index === 0) {
          await assertSession(s, jobNo);
          return;
        }
        throw new Error('Invoice row missing');
      }
      await postback(s, () =>
        row.getByRole('link', { name: 'Select', exact: true }).click(),
      );
      await s.page.evaluate(
        ({ value, id }) => {
          document.body.dataset.impexSelectedInvoice = value;
          document.body.dataset.impexSelectedInvoiceNumber =
            (document.getElementById(id) as HTMLInputElement | null)?.value ??
            '';
        },
        { value: jobNo + ':' + index, id: FIELDS['invoice.number']!.id },
      );
    }
    if (section === 'charges')
      await s.page.getByRole('link', { name: 'F&I', exact: true }).click();
    if (section === 'thirdParty')
      await s.page
        .getByRole('link', { name: 'Third Party Details', exact: true })
        .click();
  }
  if (anchor)
    await s.page.locator('#' + anchor.id).waitFor({ state: 'visible' });
  await assertSession(s, jobNo);
}
export async function readFields(
  s: BrowserSession,
  section: Section,
  packingRanges?: NonNullable<Snapshot['packingRanges']>,
): Promise<Record<string, string>> {
  const definitions = Object.entries(FIELDS).filter(
    ([, d]) => d.section === section && d.kind !== 'packing',
  );
  const result = await s.page.evaluate(
    (definitions) =>
      Object.fromEntries(
        definitions.map(([key, d]) => {
          const e = document.getElementById(d.id) as
            | HTMLInputElement
            | HTMLSelectElement
            | null;
          if (!e) throw new Error('Expected site control missing: ' + key);
          let value =
            d.kind === 'check'
              ? String((e as HTMLInputElement).checked)
              : e.value;
          if (key === 'general.buyerCountry' && value === '') {
            const select = e as HTMLSelectElement;
            const label = select.selectedOptions[0]?.textContent
              ?.trim()
              .toUpperCase();
            const codes = Array.from(select.options)
              .filter(
                (o) => o.value && o.textContent?.trim().toUpperCase() === label,
              )
              .map((o) => o.value);
            if (codes.length === 1) value = codes[0]!;
          }
          return [key, value];
        }),
      ),
    definitions,
  );
  if (section === 'shipment') {
    const ranges = packingRanges ?? (await readPackingRanges(s));
    if (ranges.length === 1) {
      result['shipment.packingFrom'] = ranges[0]!.from;
      result['shipment.packingTo'] = ranges[0]!.to;
      result['shipment.packingUnit'] = ranges[0]!.unit;
    }
  }
  return result;
}
export async function readSnapshot(
  s: BrowserSession,
  jobNo: string,
): Promise<Snapshot> {
  await openSection(s, jobNo, 'general', 0, { reload: true });
  const fields = await readFields(s, 'general');
  await openSection(s, jobNo, 'shipment');
  const packingRanges = await readPackingRanges(s);
  Object.assign(fields, await readFields(s, 'shipment', packingRanges));
  await openSection(s, jobNo, 'invoice', 0, { allowEmptyInvoice: true });
  const count = await s.page
    .locator('#ContentPlaceHolder1_tbInvoice_TabPanel1_gvInvoiceDetails tr')
    .filter({ has: s.page.getByRole('link', { name: 'Select', exact: true }) })
    .count();
  const invoices: Record<string, string>[] = [];
  for (let n = 0; n < count; n++) {
    const invoice: Record<string, string> = {};
    for (const section of ['invoice', 'charges', 'thirdParty'] as const) {
      if (n !== 0 || section !== 'invoice')
        await openSection(s, jobNo, section, n);
      Object.assign(invoice, await readFields(s, section));
    }
    invoices.push(invoice);
  }
  return {
    context: { ...s.context },
    jobNo,
    fields,
    invoices,
    packingRanges,
  };
}

export async function readVisibleTableRows(
  rowsLocator: import('playwright').Locator,
): Promise<string[][]> {
  return rowsLocator.evaluateAll((rs) =>
    rs.map((r) =>
      Array.from(r.querySelectorAll(':scope > td'))
        .filter((e) => e.getClientRects().length)
        .map((e) => (e.textContent ?? '').trim()),
    ),
  );
}

export async function readPackingRanges(s: BrowserSession) {
  const rows = await readVisibleTableRows(
    s.page
      .locator('#ContentPlaceHolder1_Shipment_TabPanelExch_gvpackinglist tr')
      .filter({
        has: s.page.getByRole('link', { name: 'Select', exact: true }),
      }),
  );
  return rows.map((c) => ({
    from: c[1] ?? '',
    to: c[2] ?? '',
    total: c[3] ?? '',
    unit: c[4] ?? '',
  }));
}

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
    const rows = await readVisibleTableRows(table.locator('tr'));
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
export async function discoverCandidates(
  s: BrowserSession,
  spec: Shipment,
): Promise<Candidate[]> {
  await ensureContext(s, spec.context);
  const out: Candidate[] = [];
  const records = (await listJobNumbers(s, spec)).filter((r) => !r.cancelled);
  for (const r of records) normalizeDate(r.jobDate);
  records.sort(
    (a, b) =>
      normalizeDate(b.jobDate).localeCompare(normalizeDate(a.jobDate)) ||
      Number(b.jobNo.split('-').at(-1)) - Number(a.jobNo.split('-').at(-1)),
  );
  for (const r of records) {
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
      });
    if (
      spec.fields['general.iec']?.value &&
      out.at(-1)?.jobNo === r.jobNo &&
      (!normalizeName(spec.fields['general.consignee']?.value ?? '') ||
        normalizeName(f['general.consignee'] ?? '') ===
          normalizeName(spec.fields['general.consignee']?.value ?? ''))
    )
      break;
  }
  return out;
}

export async function resolveCustomsCity(
  s: BrowserSession,
  jobNo: string | null,
  code: string,
): Promise<string> {
  if (jobNo) await openSection(s, jobNo, 'general');
  else if (
    !s.page.url().includes('Mode=NewJob') ||
    (await s.page.locator('#ContentPlaceHolder1_txtjno').inputValue()).trim()
  )
    throw new Error('Customs lookup requires the unsaved native New Job form');
  const city = s.page.locator('#' + FIELDS['general.customCity']!.id);
  const house = s.page.locator('#' + FIELDS['general.customHouse']!.id);
  const options = await city.locator('option').evaluateAll((es) =>
    es
      .map((e) => ({
        value: (e as HTMLOptionElement).value,
        label: e.textContent?.trim() ?? '',
      }))
      .filter((o) => o.value),
  );
  const matches: string[] = [];
  for (const option of options) {
    await selectSessionControl(s, city, option.label);
    await assertSession(s, jobNo ?? undefined);
    if (
      (await house
        .locator('option')
        .evaluateAll(
          (es, code) =>
            es.filter((e) => (e as HTMLOptionElement).value === code).length,
          code,
        )) === 1
    )
      matches.push(option.value);
  }
  if (matches.length !== 1)
    throw new Error(
      'Folder customs code absent or ambiguous in site master: ' + code,
    );
  const current = await city.locator('option:checked').evaluateAll((es) => {
    const el = es[0] as HTMLOptionElement | undefined;
    return el ? el.value : null;
  });
  if (current !== matches[0]!) await selectSessionControl(s, city, matches[0]!);
  return matches[0]!;
}
