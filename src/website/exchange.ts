import type { Journal, RunRecord } from '../journal';
import { openSection, readVisibleTableRows } from './read';
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
  const frameCurrency = (
    await frame.locator('#txtCurencyCode').inputValue()
  ).trim();
  const invoiceCurrencies = Array.from(
    new Set(
      r.patch.operations
        .filter((o) => o.field === 'invoice.currency')
        .map((o) => o.value.trim())
        .filter((c): c is string => Boolean(c)),
    ),
  );
  if (invoiceCurrencies.length > 1)
    throw new Error(
      'Native exchange-rate update currently supports one currency; review multiple currencies manually',
    );
  const currency = invoiceCurrencies[0];
  if (!currency)
    throw new Error(
      'Exchange-rate currency missing from merged invoice headers',
    );
  if (frameCurrency !== currency)
    throw new Error(
      'Exchange-rate currency differs from merged invoices; inspect the native currency selection before Update',
    );
  const readRate = async () => {
    const rows = await readVisibleTableRows(frame.locator('#gvCurrency tr'));
    const matches = rows.filter((c) => c[1] === target && c[2] === currency);
    if (matches.length !== 1)
      throw new Error('Exchange-rate saved row absent or ambiguous');
    return matches[0]![4] ?? '';
  };
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
