import { expect, test } from 'bun:test';
import { chromium } from 'playwright';
import { FIELDS } from '../src/policy/fields';
import { selectSource } from '../src/policy/select';
import { discoverCandidates } from '../src/website/read';
import { BASE_URL } from '../src/website/session';
import { shipmentFixture } from './fixtures';

test.each([
  { explicitIEC: true, missingConsignee: false },
  { explicitIEC: true, missingConsignee: true },
  { explicitIEC: false, missingConsignee: false },
  { explicitIEC: false, missingConsignee: true },
])(
  'source discovery preserves latest ordering and ambiguity: %j',
  async ({ explicitIEC, missingConsignee }) => {
    const browser = await chromium.launch({
      executablePath: '/usr/bin/chromium',
      chromiumSandbox: true,
    });
    try {
      const page = await browser.newPage(),
        shipment = shipmentFixture();
      if (!explicitIEC) delete shipment.fields['general.iec'];
      shipment.fields['general.exporter'] = {
        value: 'ACME',
        status: 'sourced',
        evidence: [],
      };
      shipment.fields['general.consignee'] = {
        value: missingConsignee ? '' : 'BUYER A',
        status: 'sourced',
        evidence: [],
      };
      const records = [
        {
          jobNo: 'EXP-2627-10',
          jobDate: '16/10/2026',
          iec: '001',
          buyer: 'OTHER',
        },
        {
          jobNo: 'EXP-2627-7',
          jobDate: '13/10/2026',
          iec: '001',
          buyer: 'BUYER A',
        },
        {
          jobNo: 'EXP-2627-9',
          jobDate: '15/10/2026',
          iec: '001',
          buyer: 'BUYER A',
        },
        {
          jobNo: 'EXP-2627-8',
          jobDate: '14/10/2026',
          iec: '999',
          buyer: 'BUYER A',
        },
      ];
      const visited: string[] = [],
        searches: string[] = [];
      const header =
        'VISHAL LOGISTICS SOLUTIONS Branch : DELHI Fin.Year :2026-2027';
      await page.route(BASE_URL + '**', async (route) => {
        const url = new URL(route.request().url()),
          data = new URLSearchParams(route.request().postData() ?? '');
        if (url.pathname === '/efrmJobDetails.aspx') {
          if (data.has('searchMode')) searches.push(data.get('searchMode')!);
          const n = Number(data.get('page') ?? '1');
          const rows = records
            .slice((n - 1) * 2, n * 2)
            .map(
              (r) =>
                `<tr><td>Select</td><td>${r.jobNo}</td><td>${r.jobDate}</td><td>ACTIVE</td></tr>`,
            )
            .join('');
          const next =
            n === 1
              ? `<tr><td><a href="javascript:__doPostBack('grid','Page$2')" onclick="document.querySelector('[name=page]').value='2';document.querySelector('form').requestSubmit();return false">2</a></td></tr>`
              : '';
          await route.fulfill({
            contentType: 'text/html',
            body: `<body>${header}<form method="POST"><select name="searchMode" id="ContentPlaceHolder1_ddlsearch">${['IECCode', 'Exporter Name', 'ConsigneeName'].map((mode) => `<option ${mode === (data.get('searchMode') ?? 'IECCode') ? 'selected' : ''}>${mode}</option>`).join('')}</select><input id="ContentPlaceHolder1_txtSearch"><input type="hidden" name="page" value="${n}"><button>Search</button><table id="ContentPlaceHolder1_gvJobNo">${rows}${next}</table></form></body>`,
          });
          return;
        }
        const record = records.find(
          (r) => r.jobNo === url.searchParams.get('JobNo'),
        )!;
        visited.push(record.jobNo);
        const values: Record<string, string> = {
          'general.exporter': 'ACME',
          'general.iec': record.iec,
          'general.consignee': record.buyer,
        };
        const controls = Object.entries(FIELDS)
          .filter(([, d]) => d.section === 'general')
          .map(([key, d]) =>
            key === 'general.buyerCountry'
              ? `<select id="${d.id}"><option value=""></option></select>`
              : `<input id="${d.id}" value="${values[key] ?? ''}" ${d.kind === 'check' ? 'type="checkbox"' : ''}>`,
          )
          .join('');
        await route.fulfill({
          contentType: 'text/html',
          body: `<body>${header}<input id="ContentPlaceHolder1_txtjno" value="${record.jobNo}">${controls}</body>`,
        });
      });
      await page.goto(BASE_URL + 'efrmJobDetails.aspx');
      const candidates = await discoverCandidates(
        { page, context: shipment.context },
        shipment,
      );
      const selection = selectSource(candidates, shipment);
      if (explicitIEC) {
        expect(Array.isArray(selection)).toBe(false);
        if (!Array.isArray(selection))
          expect(selection.source.jobNo).toBe(
            missingConsignee ? 'EXP-2627-10' : 'EXP-2627-9',
          );
        expect(visited).toEqual(
          missingConsignee ? ['EXP-2627-10'] : ['EXP-2627-10', 'EXP-2627-9'],
        );
      } else {
        expect(
          Array.isArray(selection) &&
            selection.some((i) => i.code === 'identity' && i.blocking),
        ).toBe(true);
        expect(visited).toHaveLength(4);
      }
      expect(
        searches.every(
          (search) => search === (explicitIEC ? 'IECCode' : 'Exporter Name'),
        ),
      ).toBe(true);
    } finally {
      await browser.close();
    }
  },
  15000,
);
