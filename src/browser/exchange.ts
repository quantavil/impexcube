import type { Journal, RunRecord } from '../runs/journal';
import { openSection } from './read';
import type { BrowserSession } from './session';
import { assertSession, postback } from './session';

export async function updateExchangeRates(
  s: BrowserSession,
  r: RunRecord,
  journal: Journal,
): Promise<void> {
  const target = r.targetJobNo;
  if (!target || target === r.sourceJobNo)
    throw new Error('Exchange-rate update requires a distinct recorded target');
  await openSection(s, target, 'exchange');
  const iframe = await s.page
    .locator('#ContentPlaceHolder1_tbJobCreation_TabPanelExch_mainiFrame')
    .elementHandle();
  const frame = await iframe?.contentFrame();
  if (!frame) throw new Error('Exchange-rate iframe missing');
  await frame.locator('#btnupdate').waitFor({ state: 'visible' });
  if ((await frame.locator('#txtJobNo').inputValue()) !== target)
    throw new Error('Exchange-rate iframe target differs');
  const currencies = Object.keys(r.expectedRates);
  if (currencies.length !== 1)
    throw new Error(
      'Native exchange-rate update currently supports one currency; review multiple currencies manually',
    );
  const currency = currencies[0]!;
  const readRate = async () => {
    const rows = await frame.locator('#gvCurrency tr').evaluateAll((es) =>
      es.map((e) =>
        Array.from(e.querySelectorAll(':scope > td'))
          .filter((c) => c.getClientRects().length)
          .map((c) => c.textContent?.trim() ?? ''),
      ),
    );
    const matches = rows.filter((c) => c[1] === target && c[2] === currency);
    if (matches.length !== 1)
      throw new Error('Exchange-rate saved row absent or ambiguous');
    return matches[0]![4] ?? '';
  };
  if ((await frame.locator('#txtCurencyCode').inputValue()) !== currency)
    throw new Error('Exchange-rate currency differs from the target invoice');
  await assertSession(s, target);
  await journal.transition(
    r,
    r.state,
    'Update native exchange rate for ' + target + ' ' + currency,
  );
  await postback(s, () => frame.locator('#btnupdate').click(), frame);
  if ((await frame.locator('#txtJobNo').inputValue()) !== target)
    throw new Error('Exchange-rate iframe target differs after Update');
  const rate = await readRate();
  if (!/^\d+(?:\.\d+)?$/.test(rate) || Number(rate) <= 0)
    throw new Error('Native Update did not provide a valid saved rate');
  r.expectedRates[currency] = rate;
  await journal.save(r);
}
