import { afterAll, beforeAll, expect, test } from 'bun:test';
import { type Browser, chromium, type Page } from 'playwright';
import { extractGeneratedTarget, parseCopyRates } from '../src/browser/copy';
import { canonicalOption, writeControl } from '../src/browser/write';

let browser: Browser;
let page: Page;
beforeAll(async () => {
  browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    headless: true,
    chromiumSandbox: true,
  });
  page = await browser.newPage();
});
afterAll(async () => {
  await browser?.close();
});
test('real DOM country lookup accepts label but returns stored code', async () => {
  await page.setContent(
    '<select id="country"><option value="CA">CANADA</option></select>',
  );
  expect(await canonicalOption(page, 'country', 'CANADA')).toBe('CA');
  await expect(canonicalOption(page, 'country', 'UNKNOWN')).rejects.toThrow();
});
test('writer changes allowed control and refuses Product operation', async () => {
  await page.setContent(
    '<input id="ContentPlaceHolder1_tbJobCreation_TabPanel5_txtConsigneeName" value="OLD">',
  );
  await writeControl({ page } as any, {
    section: 'general',
    field: 'general.consignee',
    action: 'replace',
    value: 'NEW',
    evidence: [],
  });
  expect(await page.locator('input').inputValue()).toBe('NEW');
  await expect(
    writeControl(
      { page } as any,
      {
        section: 'product',
        field: 'product.rate',
        action: 'replace',
        value: '1',
        evidence: [],
      } as any,
    ),
  ).rejects.toThrow();
});
test('generated target must be explicit, unique and distinct from source', () => {
  expect(
    extractGeneratedTarget('Successfully generated EXP-2627-12', 'EXP-2627-11'),
  ).toBe('EXP-2627-12');
  expect(() =>
    extractGeneratedTarget('Source EXP-2627-11', 'EXP-2627-11'),
  ).toThrow();
  expect(() =>
    extractGeneratedTarget('EXP-2627-12 EXP-2627-13', 'EXP-2627-11'),
  ).toThrow();
});
test('copy rate uses new column rather than old source rate', () => {
  expect(
    parseCopyRates(
      [
        [
          'EXP-2627-11',
          '01/10/2026',
          'ICD',
          '123',
          '01/10/2026',
          'ACME',
          'USD',
          '93.5',
          '95.25',
        ],
      ],
      'EXP-2627-11',
    ),
  ).toEqual({ USD: '95.25' });
});
test('packing snapshot reads saved rows rather than empty editor controls', async () => {
  const { readFields } = await import('../src/browser/read');
  const { FIELDS } = await import('../src/policy/fields');
  await page.setContent(
    Object.entries(FIELDS)
      .filter(([, d]) => d.section === 'shipment' && d.kind !== 'packing')
      .map(([, d]) =>
        d.kind === 'check'
          ? `<input type="checkbox" id="${d.id}">`
          : `<input id="${d.id}" value="">`,
      )
      .join('') +
      '<table id="ContentPlaceHolder1_Shipment_TabPanelExch_gvpackinglist"><tr><td><a href="#">Select</a></td><td style="display:none">54712</td><td>1</td><td>148</td><td>148</td><td>BOX</td></tr></table>',
  );
  const fields = await readFields({ page } as any, 'shipment');
  expect(fields['shipment.packingTo']).toBe('148');
  expect(fields['shipment.packingUnit']).toBe('BOX');
});
test('active-session ReLogin uses separate observed button', async () => {
  const { continueLogin } = await import('../src/browser/session');
  await page.route('https://export.impexcube.in/frmLogin.aspx', (r) =>
    r.fulfill({
      body: '<form method="POST"><button id="btnresubmit">ReLogin</button></form>',
      contentType: 'text/html',
    }),
  );
  await page.goto('https://export.impexcube.in/frmLogin.aspx');
  await page.route('https://export.impexcube.in/frmLogin.aspx', (r) =>
    r.fulfill({
      body: '<select id="drBranch"><option>DELHI</option></select>',
      contentType: 'text/html',
    }),
  );
  expect(typeof continueLogin).toBe('function');
  await continueLogin({ page } as any);
  expect(await page.locator('#drBranch').count()).toBe(1);
  await page.unrouteAll();
});
test('postback waits for WebForms async DOM replacement after response', async () => {
  const { postback } = await import('../src/browser/session');
  await page.route('https://export.impexcube.in/async', (r) =>
    r.fulfill({ body: 'ok' }),
  );
  await page.setContent(
    `<button onclick="pending=true;fetch('https://export.impexcube.in/async',{method:'POST'}).then(()=>setTimeout(()=>{document.querySelector('#result').textContent='NEW';pending=false},100))">Save</button><span id="result">OLD</span><script>var pending=false;window.Sys={WebForms:{PageRequestManager:{getInstance:()=>({get_isInAsyncPostBack:()=>pending})}}}</script>`,
  );
  await postback({ page } as any, () =>
    page.getByRole('button', { name: 'Save' }).click(),
  );
  expect(await page.locator('#result').textContent()).toBe('NEW');
  await page.unrouteAll();
});

test('country label skips a stale blank-value option', async () => {
  await page.setContent(
    `<select id="country"><option value="">UNITED KINGDOM</option><option value="GB">UNITED KINGDOM</option></select>`,
  );
  expect(await canonicalOption(page, 'country', 'United Kingdom')).toBe('GB');
});

test('buyer country readback resolves its persisted blank-value label', async () => {
  const { readFields } = await import('../src/browser/read');
  const { FIELDS } = await import('../src/policy/fields');
  await page.setContent(
    Object.entries(FIELDS)
      .filter(([, d]) => d.section === 'general')
      .map(([k, d]) =>
        k === 'general.buyerCountry'
          ? `<select id="${d.id}"><option value="" selected>UNITED KINGDOM</option><option value="GB">UNITED KINGDOM</option></select>`
          : d.kind === 'check'
            ? `<input type="checkbox" id="${d.id}">`
            : `<input id="${d.id}" value="">`,
      )
      .join(''),
  );
  expect(
    (await readFields({ page } as any, 'general'))['general.buyerCountry'],
  ).toBe('GB');
});

test('text normalization follows the sites uppercase control style', async () => {
  const { canonicalText } = await import('../src/browser/write');
  await page.setContent(
    `<input id="road" style="text-transform:uppercase"><input id="invoice">`,
  );
  expect(await canonicalText(page, 'road', 'Road')).toBe('ROAD');
  expect(await canonicalText(page, 'invoice', 'Ab123')).toBe('Ab123');
});

test('invoice number normalization strips the spaces removed by Impex Cube', async () => {
  const { canonicalText } = await import('../src/browser/write');
  const { FIELDS } = await import('../src/policy/fields');
  const id = FIELDS['invoice.number']!.id;
  await page.setContent(`<input id="${id}" style="text-transform:uppercase">`);
  expect(await canonicalText(page, id, 'GGI 885/26-27')).toBe('GGI885/26-27');
});

test('text AutoPostBack commits on blur before subsequent header fields are filled', async () => {
  const { FIELDS } = await import('../src/policy/fields');
  const id = FIELDS['shipment.packages']!.id;
  let posts = 0;
  const url = 'https://export.impexcube.in/text-postback';
  await page.route(url, async (r) => {
    posts++;
    await r.fulfill({
      contentType: 'text/html',
      body: `<input id="${id}" value="999"><input id="weight" value="OLD">`,
    });
  });
  await page.setContent(
    `<form method="POST" action="${url}"><input id="${id}" value="517" onchange="__doPostBack()"><input id="weight" value="OLD"></form><script>function __doPostBack(){document.querySelector('form').submit()}</script>`,
  );
  try {
    await writeControl({ page } as any, {
      section: 'shipment',
      field: 'shipment.packages',
      action: 'replace',
      value: '999',
      evidence: [],
    });
    await page.locator('#weight').fill('NEW');
    expect(posts).toBe(1);
    expect(await page.locator('#weight').inputValue()).toBe('NEW');
  } finally {
    await page.unrouteAll();
  }
}, 30000);
test('an already-correct AutoPostBack field does not wait for or trigger another postback', async () => {
  const { FIELDS } = await import('../src/policy/fields');
  const id = FIELDS['shipment.packages']!.id;
  await page.setContent(
    `<input id="${id}" value="999" onchange="__doPostBack()"><script>function __doPostBack(){throw new Error('Unexpected postback')}</script>`,
  );
  await writeControl({ page } as any, {
    section: 'shipment',
    field: 'shipment.packages',
    action: 'replace',
    value: '999',
    evidence: [],
  });
  expect(await page.locator('#' + id).inputValue()).toBe('999');
}, 30000);
