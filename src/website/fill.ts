import type { Locator, Page } from 'playwright';
import type { Journal, RunRecord } from '../journal';
import { FIELDS, matchesNativeEmpty } from '../policy/fields';
import { isAllowed } from '../policy/merge';
import type { Issue, Operation, Patch, Section } from '../schemas';
import { issue } from '../schemas';
import { displayDate, normalizeDate, normalizeInvoiceNumber } from '../values';
import { openSection, readFields } from './read';
import type { BrowserSession } from './session';
import { assertSession, postback, selectSessionControl } from './session';
import { assertJobIdentity, identityFor } from './verify';
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
  if (value.trim() === '') {
    const blanks = options.filter((o) => o.value.trim() === '');
    if (blanks.length === 1) return blanks[0]!.value;
  }
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
async function canonicalSelectOperation(
  page: Page,
  o: Operation,
): Promise<string> {
  const d = FIELDS[o.field]!;
  if ((await page.locator('#' + d.id).count()) !== 1)
    throw new Error('Expected site control missing: ' + o.field);
  try {
    return await canonicalOption(page, d.id, o.value);
  } catch (error) {
    if (o.value.trim() === '')
      throw new Error(
        'Site cannot represent an empty value for ' +
          o.field +
          ': ' +
          (error as Error).message,
      );
    throw error;
  }
}
export async function canonicalText(
  page: Page,
  id: string,
  value: string,
): Promise<string> {
  const info = await page.locator('#' + id).evaluate((e) => {
    const transform = getComputedStyle(e).textTransform;
    const attr = e.getAttribute('maxlength');
    const maxLength = attr ? parseInt(attr, 10) : null;
    return {
      transform,
      maxLength: maxLength && maxLength > 0 ? maxLength : null,
    };
  });
  let text =
    info.transform === 'uppercase' || id === FIELDS['shipment.marks']!.id
      ? value.toUpperCase()
      : value;
  if (id === FIELDS['invoice.number']!.id) text = normalizeInvoiceNumber(text);
  if (info.maxLength !== null && text.length > info.maxLength)
    text = text.slice(0, info.maxLength);
  return text;
}
export async function writeControl(
  s: BrowserSession,
  o: Operation,
): Promise<void> {
  if (!isAllowed(o)) throw new Error('Forbidden field operation: ' + o.field);
  const d = FIELDS[o.field]!;
  if (d.kind === 'port') {
    if (o.value === '') {
      const control = s.page.locator('#' + d.id);
      if ((await control.inputValue()) === '') return;
      throw new Error(
        'Clearing an existing port requires a reviewed native clearing workflow',
      );
    }
    if ((await s.page.locator('#' + d.id).inputValue()) === o.value) return;
    await writePort(s, o);
    return;
  }
  const l = s.page.locator('#' + d.id);
  const value =
    d.kind === 'select'
      ? await canonicalSelectOperation(s.page, o)
      : d.kind === 'date'
        ? displayDate(o.value)
        : o.value;
  const current =
    d.kind === 'check' ? String(await l.isChecked()) : await l.inputValue();
  if (equivalent(current, value, d.kind)) return;
  if (!(await l.isEnabled())) {
    if (
      d.kind === 'decimal' &&
      (value === '' || value === '0' || Number(value) === 0)
    )
      return;
    if (value === '') return;
    throw new Error('Control disabled: ' + o.field);
  }
  const handler = await l.getAttribute(
    d.kind === 'check' ? 'onclick' : 'onchange',
  );
  const autoPostback = handler?.includes('__doPostBack');
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
  if (
    autoPostback &&
    (d.kind === 'text' || d.kind === 'date' || d.kind === 'decimal')
  ) {
    // A WebForms postback can re-render the tab and discard a value the
    // server only persists on Save. Re-assert once without blurring so no
    // second postback fires; the section Save posts the intended value.
    if (!equivalent(await l.inputValue(), value, d.kind)) await l.fill(value);
  }
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
  jobNo: string | null,
  p: Patch,
): Promise<Patch> {
  if (p.operations.some((o) => !isAllowed(o)))
    throw new Error('Forbidden field operation in patch');
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
    // A new job has no invoice controls until its General record exists.
    if (!jobNo && section !== 'general') continue;
    const ops = result.operations.filter((o) => o.section === section);
    if (!ops.length) continue;
    const indexes = invoiceIndexes(result.operations, section);
    for (const index of indexes) {
      if (jobNo) await openSection(s, jobNo, section, index, { reload: true });
      else await assertSession(s);
      await canonicalizeOperations(
        s,
        ops.filter((o) => (o.invoiceIndex ?? 0) === index),
        result.issues,
      );
    }
  }
  validatePorts(result.operations, !!jobNo);
  return result;
}
function validatePorts(operations: Operation[], checkCountry: boolean): void {
  for (const o of operations.filter((o) => FIELDS[o.field]!.kind === 'port')) {
    if (o.value === '') continue;
    if (!/^[A-Z]{2}[A-Z0-9]{3}$/.test(o.value))
      throw new Error('Supply an exact site port code for ' + o.field);
    if (!checkCountry) continue;
    const country = operations.find(
      (c) =>
        c.field ===
        (o.field === 'shipment.destinationPort'
          ? 'shipment.destinationCountry'
          : 'shipment.dischargeCountry'),
    )?.value;
    if (country !== o.value.slice(0, 2))
      throw new Error('Port code does not match selected country: ' + o.field);
  }
}
async function canonicalizeOperations(
  s: BrowserSession,
  operations: Operation[],
  issues: Issue[],
): Promise<void> {
  for (const o of operations) {
    if (!isAllowed(o)) throw new Error('Forbidden field operation: ' + o.field);
    const d = FIELDS[o.field]!;
    if (d.kind === 'text') o.value = await canonicalText(s.page, d.id, o.value);
    if (d.kind === 'select') {
      try {
        o.value = await canonicalSelectOperation(s.page, o);
      } catch (error) {
        if (
          o.value.trim() !== '' ||
          !(error as Error).message.startsWith('Site cannot represent an empty')
        )
          throw error;
        if (
          !issues.some(
            (i) => i.code === 'site_blank_unavailable' && i.field === o.field,
          )
        )
          issues.push(
            issue(
              'site_blank_unavailable',
              'Site has no empty option; native save requires a supplied value',
              o.field,
              false,
            ),
          );
        continue;
      }
    }
    if (
      o.value !== '' &&
      (o.field === 'general.mode' || o.field === 'general.customCity')
    )
      await selectSessionControl(s, s.page.locator('#' + d.id), o.value);
  }
  validatePorts(operations, true);
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
    p.issues.some((i) => i.blocking) ||
    p.operations.some((o) => !isAllowed(o))
  )
    throw new Error('Write target or patch is unsafe');
  const general = await assertJobIdentity(s, target, identityFor(record));
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
      await openSection(s, target, section, index);
      const operations = p.operations.filter(
        (o) => o.section === section && (o.invoiceIndex ?? 0) === index,
      );
      await canonicalizeOperations(s, operations, p.issues);
      await journal.save(record);
      const before =
        section === 'general' ? general : await readFields(s, section);
      if (
        operations.every(
          (o) =>
            equivalent(
              before[o.field] ?? '',
              FIELDS[o.field]!.kind === 'date' ? displayDate(o.value) : o.value,
              FIELDS[o.field]!.kind,
            ) || matchesNativeEmpty(o.field, o.value, before[o.field] ?? ''),
        )
      ) {
        if (!record.savedSections.includes(key)) {
          record.savedSections.push(key);
          await journal.save(record);
        }
        continue;
      }
      // Choice changes may post back and regenerate dependent text. Apply
      // them first, then fill the intended values before the section Save.
      const isChoice = (o: Operation) =>
        ['select', 'check', 'port'].includes(FIELDS[o.field]!.kind);
      for (const o of operations.sort(
        (a, b) => Number(isChoice(b)) - Number(isChoice(a)),
      )) {
        await assertSession(s, target);
        await writeControl(s, o);
      }
      await assertSession(s, target);
      await journal.transition(record, record.state, 'save ' + key);
      const save = s.page.locator(
        '#' +
          SAVE_IDS[section] +
          ':visible' +
          (section === 'shipment'
            ? ', #ContentPlaceHolder1_Shipment_TabPanelExch_btnSave:visible'
            : ''),
      );
      if ((await save.count()) !== 1)
        throw new Error(
          'Native section Save/Update is missing or ambiguous: ' + section,
        );
      await postback(s, () => save.click());
      await assertSaveAccepted(s, section);
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
  if (actual.trim() === expected.trim()) return true;
  return (
    actual.replace(/\s+/g, ' ').trim() === expected.replace(/\s+/g, ' ').trim()
  );
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

export async function assertSaveAccepted(
  s: BrowserSession,
  section: string,
): Promise<void> {
  const warnings = await s.page
    .locator(
      '#ContentPlaceHolder1_lblerrwarning, #ContentPlaceHolder1_lblerror, #ContentPlaceHolder1_lblerrorspan',
    )
    .allInnerTexts()
    .catch(() => []);
  const warningText = warnings
    .map((w) => w.trim())
    .filter(Boolean)
    .join(' ');
  if (
    warningText &&
    /already|duplicate|invalid|fail|error|mandatory|require|cannot|please check|please choose|please select/i.test(
      warningText,
    )
  ) {
    throw new Error(`Site rejected ${section} save: ${warningText}`);
  }
}

/** Bootstrap real invoices on a recorded new target before native rate Update. */
export async function initializeInvoices(
  s: BrowserSession,
  record: RunRecord,
  journal: Journal,
): Promise<void> {
  if (
    s.context.branch !== record.context.branch ||
    s.context.financialYear !== record.context.financialYear
  )
    throw new Error('Record/session context differs');
  const target = record.targetJobNo;
  if (
    !target ||
    target === record.sourceJobNo ||
    record.patch.issues.some((i) => i.blocking)
  )
    throw new Error(
      'Invoice creation requires a validated, recorded new target',
    );
  await assertJobIdentity(s, target, identityFor(record));
  await openSection(s, target, 'invoice', 0, { allowEmptyInvoice: true });
  const rows = s.page
    .locator('#ContentPlaceHolder1_tbInvoice_TabPanel1_gvInvoiceDetails tr')
    .filter({ has: s.page.getByRole('link', { name: 'Select', exact: true }) });
  let count = await rows.count();
  if (count > record.shipment.invoices.length)
    throw new Error('New target has unexpected extra invoices');
  const existing: { number: string; date: string }[] = [];
  for (let index = 0; index < count; index++) {
    await openSection(s, target, 'invoice', index);
    const actual = await readFields(s, 'invoice');
    const identity = {
      number: normalizeInvoiceNumber(actual['invoice.number'] ?? ''),
      date: normalizeDate(actual['invoice.date'] ?? ''),
    };
    const expected = record.shipment.invoices[index]!;
    if (
      identity.number !==
        normalizeInvoiceNumber(expected['invoice.number']?.value ?? '') ||
      identity.date !== normalizeDate(expected['invoice.date']?.value ?? '')
    )
      throw new Error(
        'Existing invoice identity differs from the current shipment prefix; manual invoice-layout reconciliation is required before resuming',
      );
    existing.push(identity);
  }
  if (record.pendingInvoice) {
    const pending = record.pendingInvoice;
    if (count <= pending.index)
      throw new Error(
        'Invoice Add is uncertain; inspect/add the exact invoice manually before resuming. Add will not be repeated.',
      );
    const actual = existing[pending.index]!;
    if (
      actual.number !== normalizeInvoiceNumber(pending.number) ||
      actual.date !== normalizeDate(pending.date)
    )
      throw new Error(
        'Uncertain Invoice Add does not match the visible invoice identity',
      );
    record.pendingInvoice = null;
    await journal.save(record);
  }
  for (let index = count; index < record.shipment.invoices.length; index++) {
    await assertSession(s, target);
    await postback(s, () =>
      s.page.locator('#ContentPlaceHolder1_tbInvoice_TabPanel1_btnNew').click(),
    );
    await assertSession(s, target);
    if (
      (
        await s.page.locator('#' + FIELDS['invoice.number']!.id).inputValue()
      ).trim()
    )
      throw new Error('Native New Invoice did not open an empty editor');
    const operations = record.patch.operations.filter(
      (o) => o.section === 'invoice' && o.invoiceIndex === index,
    );
    await canonicalizeOperations(s, operations, record.patch.issues);
    await journal.save(record);
    for (const operation of operations) {
      await assertSession(s, target);
      await writeControl(s, operation);
    }
    const number = operations.find((o) => o.field === 'invoice.number')?.value;
    const date = operations.find((o) => o.field === 'invoice.date')?.value;
    if (!number || !date)
      throw new Error(
        'Native Invoice Add requires a nonblank invoice number and date; supply current shipment evidence',
      );
    record.pendingInvoice = { index, number, date: normalizeDate(date) };
    await journal.transition(
      record,
      record.state,
      'Add native invoice ' + index + ' ' + number,
    );
    await postback(s, () =>
      s.page
        .locator('#ContentPlaceHolder1_tbInvoice_TabPanel1_btnAddInvoice')
        .click(),
    );
    await assertSession(s, target);
    await assertSaveAccepted(s, 'invoice creation');
    count = await rows.count();
    if (count !== index + 1)
      throw new Error(
        'Native Invoice Add did not establish the expected row count',
      );
    record.pendingInvoice = null;
    await journal.save(record);
  }
}
