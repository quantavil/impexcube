import type { Journal, RunRecord } from '../runs/journal';
import { openSection, readFields } from './read';
import type { BrowserSession } from './session';
import { assertSession, BASE_URL, postback } from './session';
import { verifyIdentity } from './verify';
export function extractGeneratedTarget(text: string, source: string): string {
  const ids = [
    ...new Set(text.match(/\b(?:VIDE-)?EXP-\d{4}-\d+\b/g) ?? []),
  ].filter((id) => id !== source);
  if (ids.length !== 1)
    throw new Error('Generated target cannot be established uniquely');
  return ids[0]!;
}
export function parseCopyRates(
  rows: string[][],
  source: string,
): Record<string, string> {
  const rates: Record<string, string> = {};
  for (const c of rows) {
    if (c[0]?.trim() !== source) continue;
    const currency = c[6]?.trim(),
      rate = c[8]?.trim();
    if (!currency || !/^\d+(?:\.\d+)?$/.test(rate ?? '') || Number(rate) <= 0)
      throw new Error('Copy preview rate unavailable');
    if (rates[currency] && rates[currency] !== rate)
      throw new Error('Conflicting copy rates');
    rates[currency] = rate!;
  }
  if (!Object.keys(rates).length)
    throw new Error('Copy preview missing source/rates');
  return rates;
}
export async function previewCopy(
  s: BrowserSession,
  source: string,
): Promise<Record<string, string>> {
  await s.page.goto(BASE_URL + 'frmCopyEJobDetails.aspx');
  await assertSession(s);
  await s.page.locator('#ContentPlaceHolder1_txtJobNo').fill(source);
  await postback(s, () =>
    s.page.locator('#ContentPlaceHolder1_btnViewJob').click(),
  );
  const rows = await s.page
    .locator('#ContentPlaceHolder1_GridView1 tr')
    .evaluateAll((rs) =>
      rs.map((r) =>
        Array.from(r.querySelectorAll(':scope > td'))
          .filter((e) => e.getClientRects().length)
          .map((e) => (e.textContent ?? '').trim()),
      ),
    );
  return parseCopyRates(rows, source);
}
export async function copyJob(
  s: BrowserSession,
  record: RunRecord,
  journal: Journal,
): Promise<string> {
  if (record.state !== 'prepared' && record.state !== 'source_selected')
    throw new Error(
      'Copy already attempted; resume/reconcile without regenerating',
    );
  await openSection(s, record.sourceJobNo, 'general');
  if (
    verifyIdentity(await readFields(s, 'general'), record.sourceSnapshot.fields)
      .length
  )
    throw new Error('Source exporter changed since preparation');
  await previewCopy(s, record.sourceJobNo);
  await assertSession(s);
  await journal.transition(record, 'copy_started', 'Generate native copy once');
  await postback(s, () =>
    s.page.locator('#ContentPlaceHolder1_btnNewJob').click(),
  );
  // Only accept the new job header, redirect, or explicit result message; never infer from listing rows.
  let target: string;
  const header = s.page.locator('#ContentPlaceHolder1_txtjno');
  if (await header.count())
    target = extractGeneratedTarget(
      await header.inputValue(),
      record.sourceJobNo,
    );
  else {
    const message = s.page.locator('#ContentPlaceHolder1_lblMessage');
    await message.waitFor({ state: 'attached' });
    target = extractGeneratedTarget(
      await message.innerText(),
      record.sourceJobNo,
    );
  }
  record.targetJobNo = target;
  await journal.transition(record, 'target_identified');
  return target;
}
