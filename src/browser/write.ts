import type { Locator, Page } from 'playwright';
import type { Operation, Patch, Section } from '../domain/model';
import { displayDate } from '../domain/validate';
import { FIELDS } from '../policy/fields';
import { isAllowed } from '../policy/patch';
import type { Journal, RunRecord } from '../runs/journal';
import { openSection, readFields } from './read';
import type { BrowserSession } from './session';
import { assertSession, postback, selectSessionControl } from './session';
import { verifyIdentity } from './verify';
export const SAVE_IDS: Partial<Record<Section, string>> = {
  general: 'ContentPlaceHolder1_tbJobCreation_TabPanel5_btnUpdate',
  shipment: 'ContentPlaceHolder1_Shipment_TabPanelExch_btnUpdate',
  invoice: 'ContentPlaceHolder1_tbInvoice_TabPanel1_btnUpdateInvoice',
  charges: 'ContentPlaceHolder1_tbInvoice_TabPanel3_btnSavefreightins',
  thirdParty: 'ContentPlaceHolder1_tbInvoice_TabPanel13_btnbuyer',
};
export async function canonicalOption(
  page: Page,
  id: string,
  value: string,
): Promise<string> {
  const options = await page.locator('#' + id + ' option').evaluateAll((es) =>
    es.map((e) => ({
      value: (e as HTMLOptionElement).value,
      label: e.textContent?.trim() ?? '',
    })),
  );
  const exact = options.filter((o) => o.value === value);
  if (exact.length === 1) return exact[0]!.value;
  const matched = options.filter(
    (o) =>
      o.value !== '' && o.label.toUpperCase() === value.trim().toUpperCase(),
  );
  if (matched.length !== 1)
    throw new Error(
      `Select option absent or ambiguous: ${id} (value: "${value}", available: ${options.map((o) => `${o.value}=${o.label}`).join(', ')})`,
    );
  return matched[0]!.value;
}
export async function canonicalText(
  page: Page,
  id: string,
  value: string,
): Promise<string> {
  const transform = await page
    .locator('#' + id)
    .evaluate((e) => getComputedStyle(e).textTransform);
  const text = transform === 'uppercase' ? value.toUpperCase() : value;
  return id === FIELDS['invoice.number']!.id ? text.replace(/\s/g, '') : text;
}
export async function writeControl(
  s: BrowserSession,
  o: Operation,
): Promise<void> {
  if (!isAllowed(o)) throw new Error('Forbidden field operation: ' + o.field);
  if (o.action === 'carry') return;
  const d = FIELDS[o.field]!;
  if (d.kind === 'packing')
    throw new Error('Packing range requires row update');
  if (d.kind === 'port') {
    if ((await s.page.locator('#' + d.id).inputValue()) === o.value) return;
    await writePort(s, o);
    return;
  }
  const l = s.page.locator('#' + d.id);
  if (!(await l.isEnabled())) throw new Error('Control disabled: ' + o.field);
  const value =
    d.kind === 'select'
      ? await canonicalOption(s.page, d.id, o.value)
      : d.kind === 'date'
        ? displayDate(o.value)
        : o.value;
  const handler = await l.getAttribute(
    d.kind === 'check' ? 'onclick' : 'onchange',
  );
  const autoPostback = handler?.includes('__doPostBack');
  const current =
    d.kind === 'check' ? String(await l.isChecked()) : await l.inputValue();
  if (equivalent(current, value, d.kind)) return;
  const action = async () => {
    if (d.kind === 'select') await l.selectOption(value);
    else if (d.kind === 'check') await l.setChecked(value === 'true');
    else {
      await l.fill(value);
      if (autoPostback) await l.blur();
    }
  };
  if (autoPostback) await postback(s, action);
  else await action();
}
export async function writePort(
  s: BrowserSession,
  o: Operation,
): Promise<void> {
  await s.page.locator('#ContentPlaceHolder1_chkPortofOrigin').check();
  await s.page.locator('#ContentPlaceHolder1_chPortofship').check();
  await s.page.locator('#ContentPlaceHolder1_chkexactport').check();
  await s.page.locator('#ContentPlaceHolder1_txtPortdetails').fill(o.value);
  await postback(s, () => s.page.locator('#ContentPlaceHolder1_Butgo').click());
  const rows = s.page
    .locator('#ContentPlaceHolder1_GridPort tr')
    .filter({ has: s.page.getByRole('link', { name: 'Select', exact: true }) });
  const hits: Locator[] = [];
  for (let n = 0; n < (await rows.count()); n++) {
    const row = rows.nth(n);
    const cells = await row.locator('td').allTextContents();
    if (cells.some((c) => c.trim().toUpperCase() === o.value.toUpperCase()))
      hits.push(row);
  }
  if (hits.length !== 1)
    throw new Error('Port code lookup absent or ambiguous');
  await postback(s, () =>
    hits[0]!.getByRole('link', { name: 'Select', exact: true }).click(),
  );
  if (
    (await s.page.locator('#' + FIELDS[o.field]!.id).inputValue()) !== o.value
  )
    throw new Error('Port master returned a different code');
}
export async function canonicalizePatch(
  s: BrowserSession,
  jobNo: string,
  p: Patch,
): Promise<Patch> {
  const result: Patch = {
    operations: structuredClone(p.operations),
    issues: [...p.issues],
  };
  for (const section of [
    'general',
    'shipment',
    'invoice',
    'charges',
    'thirdParty',
  ] as const) {
    const ops = result.operations.filter((o) => o.section === section);
    if (!ops.length) continue;
    const indexes = invoiceIndexes(result.operations, section);
    for (const index of indexes) {
      await openSection(s, jobNo, section, index);
      for (const o of ops.filter((o) => (o.invoiceIndex ?? 0) === index)) {
        const d = FIELDS[o.field]!;
        if (d.kind === 'text')
          o.value = await canonicalText(s.page, d.id, o.value);
        if (d.kind === 'select' || o.field === 'shipment.packingUnit')
          o.value = await canonicalOption(s.page, d.id, o.value);
        if (o.field === 'general.customCity')
          await selectSessionControl(s, s.page.locator('#' + d.id), o.value);
        if (d.kind === 'port' && !/^[A-Z]{2}[A-Z0-9]{3}$/.test(o.value))
          throw new Error('Supply an exact site port code for ' + o.field);
      }
    }
  }
  for (const o of result.operations.filter(
    (o) => FIELDS[o.field]!.kind === 'port',
  )) {
    const country = result.operations.find(
      (c) =>
        c.field ===
        (o.field === 'shipment.destinationPort'
          ? 'shipment.destinationCountry'
          : 'shipment.dischargeCountry'),
    )?.value;
    if (country !== o.value.slice(0, 2))
      throw new Error('Port code does not match selected country: ' + o.field);
  }
  return result;
}
export async function savePatch(
  s: BrowserSession,
  target: string,
  p: Patch,
  record: RunRecord,
  journal: Journal,
): Promise<void> {
  if (
    s.context.branch !== record.context.branch ||
    s.context.financialYear !== record.context.financialYear
  )
    throw new Error('Record/session context differs');
  if (
    target === record.sourceJobNo ||
    target !== record.targetJobNo ||
    p.issues.some((i) => i.blocking)
  )
    throw new Error('Write target or patch is unsafe');
  await openSection(s, target, 'general');
  const general = await readFields(s, 'general');
  if (verifyIdentity(general, record.sourceSnapshot.fields).length)
    throw new Error('Target exporter differs');
  for (const section of [
    'general',
    'shipment',
    'invoice',
    'charges',
    'thirdParty',
  ] as const) {
    const groups = invoiceIndexes(p.operations, section);
    for (const index of groups) {
      const key = `${section}:${index}`;
      if (section !== 'general') await openSection(s, target, section, index);
      const operations = p.operations.filter(
        (o) => o.section === section && (o.invoiceIndex ?? 0) === index,
      );
      const before =
        section === 'general' ? general : await readFields(s, section);
      if (
        operations.every((o) =>
          equivalent(
            before[o.field] ?? '',
            FIELDS[o.field]!.kind === 'date' ? displayDate(o.value) : o.value,
            FIELDS[o.field]!.kind,
          ),
        )
      ) {
        if (!record.savedSections.includes(key)) {
          record.savedSections.push(key);
          await journal.save(record);
        }
        continue;
      }
      // Buyer toggle can post back; set it before filling any dependent buyer text.
      if (section === 'shipment')
        await savePacking(s, target, operations, record, journal);
      operations.sort((a, b) =>
        a.field === 'general.buyerDifferent'
          ? -1
          : b.field === 'general.buyerDifferent'
            ? 1
            : 0,
      );
      for (const o of operations) {
        await assertSession(s, target);
        if (FIELDS[o.field]!.kind !== 'packing') await writeControl(s, o);
      }
      await assertSession(s, target);
      await journal.transition(record, record.state, 'save ' + key);
      await postback(s, () => s.page.locator('#' + SAVE_IDS[section]).click());
      // Persisted-value comparisons happen once, after all section saves, in verifyPatch.
      if (!record.savedSections.includes(key)) record.savedSections.push(key);
      await journal.save(record);
    }
  }
}
export function equivalent(
  actual: string,
  expected: string,
  kind: string,
): boolean {
  if (kind === 'decimal' && actual !== '' && expected !== '') {
    const clean = (v: string) => {
      if (!/^[+-]?\d+(?:\.\d+)?$/.test(v.trim())) return null;
      let [a, b = ''] = v.trim().replace(/^\+/, '').split('.');
      const negative = a!.startsWith('-');
      a = a!.replace(/^-/, '').replace(/^0+(?=\d)/, '');
      b = b.replace(/0+$/, '');
      return (negative && (a !== '0' || b) ? '-' : '') + a + (b ? '.' + b : '');
    };
    const a = clean(actual),
      b = clean(expected);
    return a !== null && b !== null && a === b;
  }
  return actual.trim() === expected.trim();
}

async function savePacking(
  s: BrowserSession,
  target: string,
  operations: Operation[],
  record: RunRecord,
  journal: Journal,
) {
  const packing = operations.filter((o) => FIELDS[o.field]!.kind === 'packing');
  if (!packing.length) return;
  const rows = s.page
    .locator('#ContentPlaceHolder1_Shipment_TabPanelExch_gvpackinglist tr')
    .filter({ has: s.page.getByRole('link', { name: 'Select', exact: true }) });
  const count = await rows.count();
  const expected = record.sourceSnapshot.packingRanges?.length ?? 1;
  if (count > 1 || expected > 1 || (count === 0 && expected !== 0))
    throw new Error('Copied packing range count changed');
  const actual = await readFields(s, 'shipment');
  if (packing.every((o) => actual[o.field] === o.value)) return;
  await assertSession(s, target);
  if (count === 1)
    await postback(s, () =>
      rows.first().getByRole('link', { name: 'Select', exact: true }).click(),
    );
  const button = s.page.locator(
    '#ContentPlaceHolder1_Shipment_TabPanelExch_' +
      (count === 0 ? 'btnPackingListSave' : 'btnPackingListUpdate'),
  );
  if (
    (await button.inputValue()).trim().toUpperCase() !==
    (count === 0 ? 'ADD' : 'UPDATE')
  )
    throw new Error('Packing editor mode differs from saved row count');
  for (const o of packing) {
    const d = FIELDS[o.field]!;
    const l = s.page.locator('#' + d.id);
    if (o.field === 'shipment.packingUnit') await l.selectOption(o.value);
    else await l.fill(o.value);
  }
  await assertSession(s, target);
  await journal.transition(
    record,
    record.state,
    count === 0 ? 'add missing packing range' : 'update existing packing range',
  );
  await postback(s, () => button.click());
  await assertSession(s, target);
}

function invoiceIndexes(operations: Operation[], section: Section): number[] {
  return section === 'general' || section === 'shipment'
    ? [0]
    : [
        ...new Set(
          operations
            .filter((o) => o.section === section)
            .map((o) => o.invoiceIndex ?? 0),
        ),
      ];
}
