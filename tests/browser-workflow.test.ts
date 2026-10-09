import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { copyJob } from '../src/browser/copy';
import { BASE_URL } from '../src/browser/session';
import { savePatch } from '../src/browser/write';
import { FIELDS } from '../src/policy/fields';
import { Journal } from '../src/runs/journal';
import { runFixture } from './fixtures';

test('native copy once and section saves persist on target with source untouched', async () => {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    chromiumSandbox: true,
  });
  const dir = await mkdtemp(join(tmpdir(), 'impex-browser-'));
  try {
    const page = await browser.newPage();
    const source = 'EXP-2627-11',
      target = 'EXP-2627-12';
    let generates = 0;
    let saves = 0;
    let targetLoads = 0;
    let packingAdds = 0;
    let packing: string[] = [];
    const stores: Record<string, Record<string, string>> = {
      [source]: { 'general.consignee': 'OLD' },
      [target]: { 'general.consignee': 'OLD' },
    };
    const header =
      'VISHAL LOGISTICS SOLUTIONS Branch : DELHI Fin.Year :2026-2027';
    function html(job: string, section = 'general') {
      const controls = Object.entries(FIELDS)
        .filter(([, d]) => d.section === section && d.kind !== 'packing')
        .map(([key, d]) =>
          key === 'general.buyerCountry'
            ? `<select name="${d.id}" id="${d.id}"><option value=""></option></select>`
            : `<input ${d.kind === 'check' ? 'type="checkbox"' : ''} name="${d.id}" id="${d.id}" value="${stores[job]?.[key] ?? ''}">`,
        )
        .join('');
      return `<body>${header}<form method="POST"><input id="ContentPlaceHolder1_txtjno" value="${job}"><button name="action" value="shipment">Shipment</button><button name="action" value="invoice">Invoice</button><input name="section" type="hidden" value="${section}">${controls}${section === 'shipment' ? `<input id="ContentPlaceHolder1_Shipment_TabPanelExch_txtpckno_from" name="packFrom"><input id="ContentPlaceHolder1_Shipment_TabPanelExch_txtpckno_to" name="packTo"><select id="ContentPlaceHolder1_Shipment_TabPanelExch_ddlpackcode" name="packUnit"><option>CTN</option></select><input type="submit" id="ContentPlaceHolder1_Shipment_TabPanelExch_btnPackingListSave" name="packingSave" value="ADD">${packing.length ? `<table id="ContentPlaceHolder1_Shipment_TabPanelExch_gvpackinglist"><tr><td><a href="#">Select</a></td>${packing.map((x) => `<td>${x}</td>`).join('')}</tr></table>` : ''}` : ''}<button id="${section === 'general' ? 'ContentPlaceHolder1_tbJobCreation_TabPanel5_btnUpdate' : 'ContentPlaceHolder1_Shipment_TabPanelExch_btnUpdate'}" name="action" value="save">Update</button></form></body>`;
    }
    await page.route(BASE_URL + '**', async (route) => {
      const req = route.request(),
        url = new URL(req.url());
      const data = new URLSearchParams(req.postData() ?? '');
      if (url.pathname.includes('frmCopyEJobDetails')) {
        if (data.get('action') === 'generate') {
          generates++;
          await route.fulfill({
            body: `<body>${header}<span id="ContentPlaceHolder1_lblMessage">Created ${target}</span></body>`,
            contentType: 'text/html',
          });
          return;
        }
        await route.fulfill({
          body: `<body>${header}<form method="POST"><input id="ContentPlaceHolder1_txtJobNo" name="source"><button id="ContentPlaceHolder1_btnViewJob" name="action" value="view">View</button><button id="ContentPlaceHolder1_btnNewJob" name="action" value="generate">Generate</button></form><table id="ContentPlaceHolder1_GridView1"><tr><td style="display:none">61068</td>${[source, '01/10/2026', 'ICD', '123', '01/10/2026', 'ACME', 'USD', '93.5', '95.25'].map((x) => `<td>${x}</td>`).join('')}</tr></table></body>`,
          contentType: 'text/html',
        });
        return;
      }
      const job = url.searchParams.get('JobNo')!;
      if (req.method() === 'GET' && job === target) targetLoads++;
      let section = 'general';
      if (req.method() === 'POST') {
        section =
          data.get('action') === 'shipment'
            ? 'shipment'
            : (data.get('section') ?? 'general');
        if (data.has('packingSave')) {
          packingAdds++;
          stores[job]!['shipment.netWeight'] = '111.000';
          packing = [
            data.get('packFrom')!,
            data.get('packTo')!,
            '999',
            data.get('packUnit')!,
          ];
        }
        if (data.get('action') === 'save') saves++;
        if (data.get('action') === 'save')
          for (const [key, d] of Object.entries(FIELDS))
            if (d.section === section && data.has(d.id))
              stores[job]![key] = data.get(d.id)!;
      }
      await route.fulfill({
        body: html(job, section),
        contentType: 'text/html',
      });
    });
    const session: any = {
      page,
      context: { branch: 'DELHI', financialYear: '2026-2027' },
    };
    await page.goto(BASE_URL + 'efrmJobDetails.aspx');
    const journal = new Journal(dir);
    const patch: any = {
      issues: [],
      operations: [
        {
          section: 'general',
          field: 'general.consignee',
          action: 'replace',
          value: 'NEW',
          evidence: [],
        },
        {
          section: 'shipment',
          field: 'shipment.netWeight',
          action: 'replace',
          value: '5888.600',
          evidence: [],
        },
        ...['packingFrom', 'packingTo', 'packingUnit'].map((name, n) => ({
          section: 'shipment',
          field: 'shipment.' + name,
          action: 'replace',
          value: ['1', '999', 'CTN'][n],
          evidence: [],
        })),
      ],
    };
    const record: any = runFixture({
      runId: 'fixture',
      context: session.context,
      sourceJobNo: source,
      sourceSnapshot: {
        ...runFixture().sourceSnapshot,
        jobNo: source,
        packingRanges: [],
      },
      expectedRates: { USD: '93.50' },
      patch,
    });
    await journal.save(record);
    expect(await copyJob(session, record, journal)).toBe(target);
    await savePatch(session, target, patch, record, journal);
    expect(targetLoads).toBe(1);
    const firstSaves = saves;
    await savePatch(session, target, patch, record, journal);
    expect(saves).toBe(firstSaves);
    await expect(copyJob(session, record, journal)).rejects.toThrow();
    expect(generates).toBe(1);
    expect(packingAdds).toBe(1);
    expect(packing).toEqual(['1', '999', '999', 'CTN']);
    expect(stores[source]!['general.consignee']).toBe('OLD');
    expect(stores[target]!['general.consignee']).toBe('NEW');
    expect(record.savedSections).toContain('general:0');
  } finally {
    await browser.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 15000);

test('existing packing row uses native Update button instead of Add', async () => {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    chromiumSandbox: true,
  });
  const dir = await mkdtemp(join(tmpdir(), 'impex-packing-'));
  try {
    const page = await browser.newPage(),
      target = 'EXP-2627-12';
    let selected = false,
      updates = 0,
      to = '999';
    const controls = (section: string) =>
      Object.entries(FIELDS)
        .filter(
          ([key, d]) =>
            d.section === section &&
            ![
              'shipment.packages',
              'shipment.packingFrom',
              'shipment.packingTo',
              'shipment.packingUnit',
            ].includes(key),
        )
        .map(([key, d]) =>
          key === 'general.buyerCountry'
            ? `<select id="${d.id}"><option value=""></option></select>`
            : `<input ${d.kind === 'check' ? 'type="checkbox"' : ''} id="${d.id}" value="">`,
        )
        .join('');
    const general =
      controls('general') +
      `<button name="section" value="shipment">Shipment</button>`;
    const shipment = () =>
      controls('shipment') +
      `<input id="${FIELDS['shipment.packages']!.id}" value="640"><input name="from" id="${FIELDS['shipment.packingFrom']!.id}" value="1"><input name="to" id="${FIELDS['shipment.packingTo']!.id}" value="${to}"><select id="${FIELDS['shipment.packingUnit']!.id}"><option>CTN</option></select><table id="ContentPlaceHolder1_Shipment_TabPanelExch_gvpackinglist"><tr><td><a href="#" onclick="document.querySelector('[name=select]').click();return false">Select</a></td><td>1</td><td>${to}</td><td>${to}</td><td>CTN</td></tr></table><button hidden name="select" value="yes">Select row</button>${selected ? '<input type="submit" id="ContentPlaceHolder1_Shipment_TabPanelExch_btnPackingListUpdate" name="packingUpdate" value="Update">' : ''}<button id="ContentPlaceHolder1_Shipment_TabPanelExch_btnUpdate" name="save" value="yes">Update</button>`;
    await page.route(BASE_URL + '**', async (route) => {
      const data = new URLSearchParams(route.request().postData() ?? '');
      if (data.has('select')) selected = true;
      if (data.has('packingUpdate')) {
        updates++;
        to = data.get('to')!;
      }
      const section =
        route.request().method() === 'POST' ? 'shipment' : 'general';
      await route.fulfill({
        contentType: 'text/html',
        body: `<body>VISHAL LOGISTICS SOLUTIONS Branch : DELHI Fin.Year :2026-2027<form method="POST"><input id="ContentPlaceHolder1_txtjno" value="${target}">${section === 'general' ? general : shipment()}</form></body>`,
      });
    });
    const session: any = {
      page,
      context: { branch: 'DELHI', financialYear: '2026-2027' },
    };
    const patch: any = {
      issues: [],
      operations: ['packingFrom', 'packingTo', 'packingUnit'].map(
        (name, n) => ({
          section: 'shipment',
          field: 'shipment.' + name,
          action: 'replace',
          value: ['1', '640', 'CTN'][n],
          evidence: [],
        }),
      ),
    };
    const record = runFixture({
      context: session.context,
      sourceJobNo: 'EXP-2627-11',
      targetJobNo: target,
      patch,
      sourceSnapshot: {
        ...runFixture().sourceSnapshot,
        jobNo: 'EXP-2627-11',
        packingRanges: [{ from: '1', to: '999', total: '999', unit: 'CTN' }],
      },
    });
    await savePatch(session, target, patch, record, new Journal(dir));
    expect(updates).toBe(1);
    expect(to).toBe('640');
  } finally {
    await browser.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 15000);
