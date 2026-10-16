import { expect, test } from 'bun:test';
import { chromium } from 'playwright';
import { resolveCustomsCity } from '../src/website/read';
import { BASE_URL } from '../src/website/session';

test('folder code selects its dependent city from the site master without saving', async () => {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    chromiumSandbox: true,
  });
  try {
    const page = await browser.newPage();
    let saves = 0;
    await page.route(BASE_URL + '**', async (route) => {
      const data = new URLSearchParams(route.request().postData() ?? '');
      const city = data.get('city') ?? 'MORADABAD';
      if (data.get('action') === 'save') saves++;
      const houses = city === 'NOIDA' ? ['INDER6'] : ['INMBD6'];
      await route.fulfill({
        contentType: 'text/html',
        body: `<body>VISHAL LOGISTICS SOLUTIONS Branch : MORADABAD Fin.Year :2026-2027<form method="POST"><input id="ContentPlaceHolder1_tbJobCreation_TabPanel5_txtExporter" readonly value="SOURCE EXPORTER"><input id="ContentPlaceHolder1_txtjno" value=""><select id="ContentPlaceHolder1_ddlcustcity" name="city" onchange="__doPostBack()"><option value="MORADABAD" ${city === 'MORADABAD' ? 'selected' : ''}>MORADABAD</option><option value="NOIDA" ${city === 'NOIDA' ? 'selected' : ''}>NOIDA</option></select><select id="ContentPlaceHolder1_ddlCustom">${houses.map((code) => `<option value="${code}">${code}</option>`).join('')}</select></form><script>function __doPostBack(){document.querySelector('form').submit()}</script></body>`,
      });
    });
    const session: any = {
      page,
      context: { branch: 'MORADABAD', financialYear: '2026-2027' },
    };
    await page.goto(BASE_URL + 'frmExportJobCreation.aspx?Mode=NewJob');
    expect(await resolveCustomsCity(session, null, 'INDER6')).toBe('NOIDA');
    expect(await resolveCustomsCity(session, null, 'INMBD6')).toBe('MORADABAD');
    try {
      await resolveCustomsCity(session, null, 'INXXX6');
      expect.unreachable();
    } catch (e: any) {
      expect(e.message).toContain('absent or ambiguous');
    }
    expect(saves).toBe(0);
  } finally {
    await browser.close();
  }
}, 30000);
