import { FIELDS } from '../policy/fields';
import { openSection } from './read';
import type { BrowserSession } from './session';
import { assertSession, selectSessionControl } from './session';

export async function resolveCustomsCity(
  s: BrowserSession,
  jobNo: string,
  code: string,
): Promise<string> {
  await openSection(s, jobNo, 'general');
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
    await assertSession(s, jobNo);
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
  return matches[0]!;
}
