import type { Context, Section, Snapshot } from '../domain/model';
import { FIELDS } from '../policy/fields';
import type { BrowserSession } from './session';
import { assertSession, BASE_URL, postback } from './session';
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
  options: { reload?: boolean } = {},
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
  } else if (section === 'shipment')
    await postback(s, () =>
      s.page.getByRole('button', { name: 'Shipment', exact: true }).click(),
    );
  else if (section === 'exchange') {
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
      if ((await row.count()) !== 1) throw new Error('Invoice row missing');
      await postback(s, () =>
        row.getByRole('link', { name: 'Select', exact: true }).click(),
      );
      await s.page.evaluate(
        ({ value, id }) => {
          document.body.dataset.impexSelectedInvoice = value;
          document.body.dataset.impexSelectedInvoiceNumber = (
            document.getElementById(id) as HTMLInputElement
          ).value;
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
  await openSection(s, jobNo, 'invoice');
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
    productFingerprint: null,
    packingRanges,
  };
}

export async function readPackingRanges(s: BrowserSession) {
  return s.page
    .locator('#ContentPlaceHolder1_Shipment_TabPanelExch_gvpackinglist tr')
    .filter({ has: s.page.getByRole('link', { name: 'Select', exact: true }) })
    .evaluateAll((rs) =>
      rs.map((r) => {
        const c = Array.from(r.querySelectorAll(':scope > td'))
          .filter((e) => e.getClientRects().length)
          .map((e) => (e.textContent ?? '').trim());
        return {
          from: c[1] ?? '',
          to: c[2] ?? '',
          total: c[3] ?? '',
          unit: c[4] ?? '',
        };
      }),
    );
}
