import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { Journal } from '../src/journal';
import { FIELDS } from '../src/policy/fields';
import { savePatch } from '../src/website/fill';
import { BASE_URL } from '../src/website/session';
import { runFixture } from './fixtures';

test('native target saves headers and reuses correct values without touching reference or numbered packing', async () => {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    chromiumSandbox: true,
  });
  const dir = await mkdtemp(join(tmpdir(), 'impex-native-save-'));
  try {
    const page = await browser.newPage(),
      source = 'EXP-2627-11',
      target = 'EXP-2627-12';
    const master = { 'general.iec': '001', 'general.exporter': 'ACME' };
    const stores: Record<string, Record<string, string>> = {
      [source]: { ...master, 'general.consignee': 'OLD' },
      [target]: {
        ...master,
        'general.consignee': '',
        'shipment.marks': '',
        'shipment.marksType': '',
      },
    };
    let saves = 0,
      packingRequests = 0,
      sourceRequests = 0;
    await page.route(BASE_URL + '**', async (route) => {
      const request = route.request(),
        job = new URL(request.url()).searchParams.get('JobNo')!;
      const data = new URLSearchParams(request.postData() ?? '');
      if (job === source) sourceRequests++;
      if (data.has('packingSave') || data.has('packingUpdate'))
        packingRequests++;
      const section =
        data.get('action') === 'shipment'
          ? 'shipment'
          : (data.get('section') ?? 'general');
      if (data.get('__EVENTTARGET') === FIELDS['shipment.marksType']!.id) {
        stores[job]!['shipment.marksType'] = data.get(
          FIELDS['shipment.marksType']!.id,
        )!;
        stores[job]!['shipment.marks'] = 'SITE DEFAULT DECLARATION';
      }
      if (data.get('action') === 'save') {
        saves++;
        for (const [key, d] of Object.entries(FIELDS))
          if (d.section === section && data.has(d.id))
            stores[job]![key] = data.get(d.id)!;
      }
      const controls = Object.entries(FIELDS)
        .filter(([, d]) => d.section === section && d.kind !== 'packing')
        .map(([key, d]) =>
          key === 'shipment.marksType'
            ? `<select id="${d.id}" name="${d.id}" onchange="__doPostBack('${d.id}', '')"><option value=""></option><option value="RODTEP" ${stores[job]?.[key] === 'RODTEP' ? 'selected' : ''}>RODTEP</option></select>`
            : key === 'general.buyerCountry'
              ? `<select id="${d.id}"><option value=""></option></select>`
              : `<input id="${d.id}" name="${d.id}" value="${stores[job]?.[key] ?? ''}" ${d.kind === 'check' ? 'type="checkbox"' : ''}>`,
        )
        .join('');
      await route.fulfill({
        contentType: 'text/html',
        body: `<body>VISHAL LOGISTICS SOLUTIONS Branch : DELHI Fin.Year :2026-2027<script>function __doPostBack(target) { document.getElementById('eventTarget').value = target; document.forms[0].submit(); }</script><form method="POST"><input type="hidden" id="eventTarget" name="__EVENTTARGET"><input id="ContentPlaceHolder1_txtjno" value="${job}"><input type="hidden" name="section" value="${section}">${controls}<button name="action" value="shipment">Shipment</button><button id="${section === 'general' ? 'ContentPlaceHolder1_tbJobCreation_TabPanel5_btnUpdate' : 'ContentPlaceHolder1_Shipment_TabPanelExch_btnUpdate'}" name="action" value="save">Update</button><button name="packingSave">Add Packing</button></form></body>`,
      });
    });
    const patch: any = {
      issues: [],
      operations: [
        ['general', 'general.consignee', 'NEW'],
        ['shipment', 'shipment.netWeight', '5888.600'],
        [
          'shipment',
          'shipment.marks',
          '(01 TO 1800 CARTONS) PRESERVED RODTEP DECLARATION',
        ],
        ['shipment', 'shipment.marksType', 'RODTEP'],
      ].map(([section, field, value]) => ({
        section,
        field,
        value,
        action: 'replace',
        evidence: [],
      })),
    };
    const record = runFixture({
      targetJobNo: target,
      sourceJobNo: source,
      sourceSnapshot: {
        ...runFixture().sourceSnapshot!,
        jobNo: source,
        fields: stores[source]!,
        packingRanges: [{ from: '1', to: '9', total: '9', unit: 'CTN' }],
      },
      exporterMaster: master,
      patch,
    });
    const session = { page, context: record.context },
      journal = new Journal(dir);
    await savePatch(session, target, patch, record, journal);
    expect(saves).toBe(2);
    expect(stores[target]!['shipment.marks']).toBe(
      '(01 TO 1800 CARTONS) PRESERVED RODTEP DECLARATION',
    );
    expect(stores[target]!['shipment.marksType']).toBe('RODTEP');
    await savePatch(session, target, patch, record, journal);
    expect(saves).toBe(2);
    expect(stores[target]!['general.consignee']).toBe('NEW');
    expect(stores[source]!['general.consignee']).toBe('OLD');
    expect(packingRequests).toBe(0);
    expect(sourceRequests).toBe(0);
    const unsafe = {
      ...patch,
      operations: [
        {
          section: 'shipment',
          field: 'shipment.packingFrom',
          action: 'clear',
          value: '',
          evidence: [],
        },
      ],
    };
    await expect(
      savePatch(session, target, unsafe as any, record, journal),
    ).rejects.toThrow('unsafe');
    expect(saves).toBe(2);
    expect(packingRequests).toBe(0);
    await expect(
      savePatch(session, source, patch, record, journal),
    ).rejects.toThrow('unsafe');
  } finally {
    await browser.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 15000);

test.each([
  'Already Same Invoice No exists!. Please Check. JobNo: EXP-2627-11',
  'Please choose Invoice Term',
  'Please select payment',
])(
  'savePatch rejects native validation: %s',
  async (warning) => {
    const browser = await chromium.launch({
      executablePath: '/usr/bin/chromium',
      chromiumSandbox: true,
    });
    const dir = await mkdtemp(join(tmpdir(), 'impex-save-warn-'));
    try {
      const page = await browser.newPage();
      const target = 'EXP-2627-12';
      const header =
        'VISHAL LOGISTICS SOLUTIONS Branch : DELHI Fin.Year :2026-2027';

      function html(job: string, isSave: boolean) {
        const controls = Object.entries(FIELDS)
          .filter(([, d]) => d.section === 'general' && d.kind !== 'packing')
          .map(([key, d]) =>
            key === 'general.buyerCountry'
              ? `<select name="${d.id}" id="${d.id}"><option value=""></option></select>`
              : `<input ${d.kind === 'check' ? 'type="checkbox"' : ''} name="${d.id}" id="${d.id}" value="${key === 'general.consignee' && isSave ? 'NEW' : 'OLD'}">`,
          )
          .join('');
        return `<body>${header}<form method="POST"><input id="ContentPlaceHolder1_txtjno" value="${job}"><span id="ContentPlaceHolder1_lblerrwarning">${isSave ? warning : ''}</span>${controls}<button id="ContentPlaceHolder1_tbJobCreation_TabPanel5_btnUpdate" name="action" value="save">Update</button></form></body>`;
      }

      await page.route(BASE_URL + '**', async (route) => {
        const data = new URLSearchParams(route.request().postData() ?? '');
        const isSave = data.get('action') === 'save';
        await route.fulfill({
          contentType: 'text/html',
          body: html(target, isSave),
        });
      });

      const session: any = {
        page,
        context: { branch: 'DELHI', financialYear: '2026-2027' },
      };
      await page.goto(BASE_URL + 'efrmJobDetails.aspx');
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
        ],
      };
      const record = runFixture({
        exporterMaster: { 'general.iec': 'OLD', 'general.exporter': 'OLD' },
        context: session.context,
        sourceJobNo: 'EXP-2627-11',
        targetJobNo: target,
        patch,
        sourceSnapshot: {
          ...runFixture().sourceSnapshot!,
          jobNo: 'EXP-2627-11',
        },
      });

      let saveErr: Error | null = null;
      try {
        await savePatch(session, target, patch, record, new Journal(dir));
      } catch (e: any) {
        saveErr = e;
      }
      expect(saveErr).not.toBeNull();
      expect(saveErr?.message).toContain(
        'Site rejected general save: ' + warning,
      );
    } finally {
      await browser.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
  15000,
);
