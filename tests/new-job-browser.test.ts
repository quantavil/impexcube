import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { Journal } from '../src/journal';
import { FIELDS } from '../src/policy/fields';
import { resolveMasterRequest } from '../src/policy/merge';
import { createNewJob, previewNewJob } from '../src/website/create';
import { BASE_URL } from '../src/website/session';
import { runFixture, shipmentFixture } from './fixtures';

test.each([
  ['with previous reference and branch fallback', '', true],
  [
    'with previous reference and native required-field refusal',
    'Please select Consignee Country',
    true,
  ],
  ['without any previous exporter job', '', false],
  ['with lost preflight page', '', true],
  ['with changed preflight master', '', true],
] as const)(
  'native New Job %s',
  async (caseName, warning, reference) => {
    const browser = await chromium.launch({
      executablePath: '/usr/bin/chromium',
      chromiumSandbox: true,
    });
    const dir = await mkdtemp(join(tmpdir(), 'impex-native-new-'));
    try {
      const page = await browser.newPage();
      const journal = new Journal(dir);
      const shipment = shipmentFixture();
      shipment.fields['general.exporter'] = {
        value: 'NEW EXPORTER',
        status: 'sourced',
        evidence: [],
      };
      if (!reference)
        shipment.fields['general.iecBranch'] = {
          value: '1',
          status: 'default',
          evidence: [],
        };
      let saves = 0,
        newFormLoads = 0,
        masterPostbacks = 0;
      const master = {
        'general.iec': '001',
        'general.exporter': 'NEW EXPORTER',
        'general.gst': 'GST001',
        'general.iecBranch': '1',
        'general.exporterAddress': 'CURRENT REGISTERED ADDRESS',
      };
      const record = runFixture({
        sourceJobNo: reference ? runFixture().sourceJobNo : null,
        sourceSnapshot: reference
          ? {
              ...runFixture().sourceSnapshot!,
              fields: {
                ...master,
                'general.exporterAddress': 'PREVIOUS ADDRESS',
              },
            }
          : null,
        exporterMaster: master,
        shipment,
        patch: {
          issues: [],
          operations: [
            {
              section: 'general',
              field: 'general.consignee',
              action: 'replace',
              value: 'BUYER',
              evidence: [],
            },
          ],
        },
      });
      await journal.save(record);
      await page.route(BASE_URL + '**', async (route) => {
        const data = new URLSearchParams(route.request().postData() ?? '');
        if (
          route.request().method() === 'GET' &&
          route.request().url().includes('Mode=NewJob')
        )
          newFormLoads++;
        if (
          route.request().method() === 'POST' &&
          data.get('action') !== 'save'
        )
          masterPostbacks++;
        if (data.get('action') === 'save') {
          const before = await journal.load(record.runId);
          expect(before.state).toBe('creation_started');
          expect(before.targetJobNo).toBeNull();
          saves++;
          await route.fulfill({
            contentType: 'text/html',
            body: `<body>VISHAL LOGISTICS SOLUTIONS Branch : DELHI Fin.Year :2026-2027<span id="ContentPlaceHolder1_lblerrwarning">${warning}</span><input id="ContentPlaceHolder1_txtjno" value="${warning ? '' : 'VIDE-EXP-2627-11'}"></body>`,
          });
          return;
        }
        const exporter = data.get(FIELDS['general.exporter']!.id) ?? '';
        const branch = data.get(FIELDS['general.iecBranch']!.id) ?? '';
        const controls = Object.entries(FIELDS)
          .filter(([, d]) => d.section === 'general')
          .map(([key, d]) => {
            if (key === 'general.iecBranch')
              return `<select id="${d.id}" name="${d.id}" onchange="__doPostBack()">${exporter ? `<option value="">Choose</option><option value="0" ${branch === '0' ? 'selected' : ''}>DELHI | 0</option><option value="1" ${branch === '1' ? 'selected' : ''}>DELHI | 1</option>` : ''}</select>`;
            if (key === 'general.buyerCountry')
              return `<select id="${d.id}"><option value=""></option></select>`;
            const value =
              key === 'general.exporter'
                ? exporter
                : ['0', '1'].includes(branch)
                  ? (master[key as keyof typeof master] ?? '')
                  : '';
            return `<input id="${d.id}" name="${d.id}" value="${value}" ${d.kind === 'check' ? 'type="checkbox"' : ''} ${key === 'general.exporter' ? 'onchange="__doPostBack()"' : ''}>`;
          })
          .join('');
        await route.fulfill({
          contentType: 'text/html',
          body: `<body>VISHAL LOGISTICS SOLUTIONS Branch : DELHI Fin.Year :2026-2027<form method="POST"><input id="ContentPlaceHolder1_txtjno" value="">${controls}<button id="ContentPlaceHolder1_tbJobCreation_TabPanel5_btnsave" name="action" value="save">Save</button></form><script>function __doPostBack(){document.querySelector('form').requestSubmit()}</script></body>`,
        });
      });
      const session = { page, context: record.context };
      const preview = await previewNewJob(
        session,
        resolveMasterRequest(record.sourceSnapshot, shipment),
      );
      expect(preview['general.iec']).toBe('001');
      expect(saves).toBe(0);
      const { canonicalizePatch } = await import('../src/website/fill');
      // No prior job or invoice grid exists; only the unsaved General controls are needed.
      record.patch = await canonicalizePatch(session, null, record.patch);
      const preparedLookups = masterPostbacks;
      if (caseName.includes('changed preflight master')) {
        await page.locator('#' + FIELDS['general.iec']!.id).fill('999');
        await expect(createNewJob(session, record, journal)).rejects.toThrow(
          'Exporter master changed since preparation',
        );
        expect(saves).toBe(0);
        expect(newFormLoads).toBe(1);
        return;
      }
      if (caseName.includes('lost preflight page'))
        await page.goto(BASE_URL + 'efrmJobDetails.aspx');
      if (warning) {
        let failure: unknown;
        try {
          await createNewJob(session, record, journal);
        } catch (error) {
          failure = error;
        }
        expect(String(failure)).toContain(
          'Site rejected native New Job save: ' + warning,
        );
        expect(saves).toBe(1);
        expect(newFormLoads).toBe(1);
        expect(masterPostbacks).toBe(preparedLookups);
        expect(record.targetJobNo).toBeNull();
        expect((await journal.load(record.runId)).state).toBe(
          'creation_started',
        );
        await expect(createNewJob(session, record, journal)).rejects.toThrow();
        expect(saves).toBe(1);
        return;
      }
      expect(await createNewJob(session, record, journal)).toBe(
        'VIDE-EXP-2627-11',
      );
      expect(saves).toBe(1);
      expect(newFormLoads).toBe(
        caseName.includes('lost preflight page') ? 2 : 1,
      );
      expect(masterPostbacks).toBe(
        caseName.includes('lost preflight page')
          ? preparedLookups * 2
          : preparedLookups,
      );
      expect((await journal.load(record.runId)).targetJobNo).toBe(
        'VIDE-EXP-2627-11',
      );
      await expect(createNewJob(session, record, journal)).rejects.toThrow();
      expect(saves).toBe(1);
    } finally {
      await browser.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
  15000,
);

test('invoice initialization refuses a second Add after an uncertain creation without a visible row', async () => {
  const { initializeInvoices } = await import('../src/website/fill');
  const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    chromiumSandbox: true,
  });
  const dir = await mkdtemp(join(tmpdir(), 'impex-native-invoice-'));
  try {
    const page = await browser.newPage();
    let adds = 0;
    await page.route(BASE_URL + '**', async (route) => {
      const data = new URLSearchParams(route.request().postData() ?? '');
      if (data.get('action') === 'add') adds++;
      const invoice = data.get('action') === 'invoice';
      const controls = Object.entries(FIELDS)
        .filter(
          ([, d]) =>
            d.section === (invoice ? 'invoice' : 'general') &&
            d.kind !== 'packing',
        )
        .map(([key, d]) =>
          key === 'general.buyerCountry'
            ? `<select id="${d.id}"><option value=""></option></select>`
            : `<input id="${d.id}" value="${key === 'general.exporter' ? 'NEW EXPORTER' : key === 'general.iec' ? '001' : ''}">`,
        )
        .join('');
      await route.fulfill({
        contentType: 'text/html',
        body: `<body>VISHAL LOGISTICS SOLUTIONS Branch : DELHI Fin.Year :2026-2027<form method="POST"><input id="ContentPlaceHolder1_txtjno" value="VIDE-EXP-2627-11">${controls}<button name="action" value="invoice">Invoice</button><button id="ContentPlaceHolder1_tbInvoice_TabPanel1_btnAddInvoice" name="action" value="add">Add</button></form></body>`,
      });
    });
    const record = runFixture({
      exporterMaster: {
        'general.iec': '001',
        'general.exporter': 'NEW EXPORTER',
      },
      targetJobNo: 'VIDE-EXP-2627-11',
      state: 'uncertain',
      pendingInvoice: { index: 0, number: 'INV1', date: '2026-10-02' },
    });
    let failure: unknown;
    try {
      await initializeInvoices(
        { page, context: record.context },
        record,
        new Journal(dir),
      );
    } catch (error) {
      failure = error;
    }
    expect(String(failure)).toContain('uncertain');
    expect(adds).toBe(0);
  } finally {
    await browser.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('Invoice Add intent survives a failed response and resume identifies the saved row without another Add', async () => {
  const { initializeInvoices } = await import('../src/website/fill');
  const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    chromiumSandbox: true,
  });
  const dir = await mkdtemp(join(tmpdir(), 'impex-add-recovery-'));
  try {
    const page = await browser.newPage(),
      journal = new Journal(dir);
    const master = { 'general.iec': '001', 'general.exporter': 'NEW EXPORTER' };
    const record = runFixture({
      sourceSnapshot: {
        ...runFixture().sourceSnapshot!,
        invoices: [{}, {}, {}],
      },
      exporterMaster: master,
      targetJobNo: 'VIDE-EXP-2627-11',
      state: 'target_identified',
      patch: {
        issues: [],
        operations: [
          {
            section: 'invoice',
            field: 'invoice.number',
            action: 'replace',
            value: 'INV1',
            invoiceIndex: 0,
            evidence: [],
          },
          {
            section: 'invoice',
            field: 'invoice.date',
            action: 'replace',
            value: '2026-10-02',
            invoiceIndex: 0,
            evidence: [],
          },
        ],
      },
    });
    await journal.save(record);
    let adds = 0;
    const invoices: Record<string, string>[] = [];
    await page.route(BASE_URL + '**', async (route) => {
      const data = new URLSearchParams(route.request().postData() ?? '');
      const action = data.get('action'),
        section = data.get('section') ?? 'general';
      const invoice =
        action === 'invoice' ||
        action === 'new' ||
        action === 'select' ||
        action === 'add' ||
        section === 'invoice';
      if (action === 'add') {
        expect((await journal.load(record.runId)).pendingInvoice?.number).toBe(
          'INV1',
        );
        adds++;
        invoices.push(
          Object.fromEntries(
            Object.entries(FIELDS)
              .filter(([, d]) => d.section === 'invoice')
              .map(([key, d]) => [key, data.get(d.id) ?? '']),
          ),
        );
        await route.fulfill({
          status: 500,
          contentType: 'text/html',
          body: '<body>Uncertain response</body>',
        });
        return;
      }
      const values = action === 'select' ? (invoices[0] ?? {}) : {};
      const controls = Object.entries(FIELDS)
        .filter(
          ([, d]) =>
            d.section === (invoice ? 'invoice' : 'general') &&
            d.kind !== 'packing',
        )
        .map(([key, d]) =>
          key === 'general.buyerCountry'
            ? `<select id="${d.id}"><option value=""></option></select>`
            : `<input id="${d.id}" name="${d.id}" value="${invoice ? (values[key] ?? '') : (master[key as keyof typeof master] ?? '')}" ${d.kind === 'check' ? 'type="checkbox"' : ''}>`,
        )
        .join('');
      const grid = invoice
        ? `<table id="ContentPlaceHolder1_tbInvoice_TabPanel1_gvInvoiceDetails">${invoices.map(() => '<tr><td><button role="link" name="action" value="select">Select</button></td></tr>').join('')}</table>`
        : '';
      await route.fulfill({
        contentType: 'text/html',
        body: `<body>VISHAL LOGISTICS SOLUTIONS Branch : DELHI Fin.Year :2026-2027<form method="POST"><input id="ContentPlaceHolder1_txtjno" value="VIDE-EXP-2627-11"><input name="section" type="hidden" value="${invoice ? 'invoice' : 'general'}">${controls}${grid}<button name="action" value="invoice">Invoice</button><button id="ContentPlaceHolder1_tbInvoice_TabPanel1_btnNew" name="action" value="new">New</button><button id="ContentPlaceHolder1_tbInvoice_TabPanel1_btnAddInvoice" name="action" value="add">Add</button></form></body>`,
      });
    });
    const session = { page, context: record.context };
    let failure: unknown;
    try {
      await initializeInvoices(session, record, journal);
    } catch (error) {
      failure = error;
    }
    expect(String(failure)).toContain('postback');
    expect(record.pendingInvoice?.index).toBe(0);
    expect(adds).toBe(1);
    const recovered = await journal.load(record.runId);
    await initializeInvoices(session, recovered, journal);
    expect(recovered.pendingInvoice).toBeNull();
    expect(adds).toBe(1);
  } finally {
    await browser.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('first shipment save uses native Save when Update is absent', async () => {
  const { savePatch } = await import('../src/website/fill');
  const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    chromiumSandbox: true,
  });
  const dir = await mkdtemp(join(tmpdir(), 'impex-first-shipment-'));
  try {
    const page = await browser.newPage();
    let saves = 0;
    const target = 'VIDE-EXP-2627-11';
    const record = runFixture({
      sourceJobNo: null,
      sourceSnapshot: null,
      exporterMaster: {
        'general.iec': '001',
        'general.exporter': 'NEW EXPORTER',
      },
      targetJobNo: target,
      patch: {
        issues: [],
        operations: [
          {
            section: 'shipment',
            field: 'shipment.netWeight',
            action: 'replace',
            value: '204',
            evidence: [],
          },
        ],
      },
    });
    await page.route(BASE_URL + '**', async (route) => {
      const data = new URLSearchParams(route.request().postData() ?? '');
      const shipment =
        data.get('action') === 'shipment' || data.get('action') === 'save';
      if (data.get('action') === 'save') saves++;
      const controls = Object.entries(FIELDS)
        .filter(
          ([, d]) =>
            d.section === (shipment ? 'shipment' : 'general') &&
            d.kind !== 'packing',
        )
        .map(([key, d]) =>
          key === 'general.buyerCountry'
            ? `<select id="${d.id}"><option></option></select>`
            : `<input id="${d.id}" value="${record.exporterMaster[key] ?? ''}" ${d.kind === 'check' ? 'type="checkbox"' : ''}>`,
        )
        .join('');
      await route.fulfill({
        contentType: 'text/html',
        body: `<body>VISHAL LOGISTICS SOLUTIONS Branch : DELHI Fin.Year :2026-2027<form method="POST"><input id="ContentPlaceHolder1_txtjno" value="${target}">${controls}<button name="action" value="shipment">Shipment</button>${shipment ? '<button id="ContentPlaceHolder1_Shipment_TabPanelExch_btnSave" name="action" value="save">Save</button>' : ''}</form></body>`,
      });
    });
    await savePatch(
      { page, context: record.context },
      target,
      record.patch,
      record,
      new Journal(dir),
    );
    expect(saves).toBe(1);
  } finally {
    await browser.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('preflight selects the requested mode before validating dependent customs options', async () => {
  const { canonicalizePatch } = await import('../src/website/fill');
  const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    chromiumSandbox: true,
  });
  try {
    const page = await browser.newPage();
    let posts = 0;
    await page.route(BASE_URL + '**', async (route) => {
      const data = new URLSearchParams(route.request().postData() ?? '');
      if (route.request().method() === 'POST') posts++;
      const mode = data.get('mode') ?? 'L';
      await route.fulfill({
        contentType: 'text/html',
        body: `<body>VISHAL LOGISTICS SOLUTIONS Branch : DELHI Fin.Year :2026-2027<form method="POST"><select name="mode" id="${FIELDS['general.mode']!.id}" onchange="__doPostBack()"><option value="L" ${mode === 'L' ? 'selected' : ''}>Land ICD</option><option value="S" ${mode === 'S' ? 'selected' : ''}>Sea</option></select><select name="city" id="${FIELDS['general.customCity']!.id}" onchange="__doPostBack()"><option value="NOIDA" selected>NOIDA</option></select><select id="${FIELDS['general.customHouse']!.id}">${mode === 'L' ? '<option value="INDER6">Dadri</option>' : ''}</select></form><script>function __doPostBack(){document.querySelector('form').requestSubmit()}</script></body>`,
      });
    });
    await page.goto(BASE_URL + 'frmExportJobCreation.aspx?Mode=NewJob');
    let failure: unknown;
    try {
      await canonicalizePatch(
        { page, context: { branch: 'DELHI', financialYear: '2026-2027' } },
        null,
        {
          issues: [],
          operations: [
            ['general.mode', 'S'],
            ['general.customCity', 'NOIDA'],
            ['general.customHouse', 'INDER6'],
          ].map(([field, value]) => ({
            section: 'general' as const,
            field: field!,
            value: value!,
            action: 'replace' as const,
            evidence: [],
          })),
        },
      );
    } catch (error) {
      failure = error;
    }
    expect(String(failure)).toContain('INDER6');
    expect(posts).toBe(1);
  } finally {
    await browser.close();
  }
});

test.each([
  {
    label: 'one current invoice',
    invoiceCount: 1,
    existing: [],
    rejected: false,
    pending: false,
  },
  {
    label: 'two current invoices',
    invoiceCount: 2,
    existing: [],
    rejected: false,
    pending: false,
  },
  {
    label: 'insertion before an existing invoice',
    invoiceCount: 2,
    existing: [['INV2', '2026-10-02']],
    rejected: true,
    pending: false,
  },
  {
    label: 'changed existing invoice number',
    invoiceCount: 1,
    existing: [['OTHER', '2026-10-02']],
    rejected: true,
    pending: false,
  },
  {
    label: 'changed existing invoice date',
    invoiceCount: 1,
    existing: [['INV1', '2026-10-03']],
    rejected: true,
    pending: false,
  },
  {
    label: 'mismatched shipment preserves pending Add',
    invoiceCount: 1,
    existing: [['OTHER', '2026-10-02']],
    rejected: true,
    pending: true,
  },
  {
    label: 'normalized matching existing identity',
    invoiceCount: 1,
    existing: [['inv 1', '02/10/2026']],
    rejected: false,
    pending: false,
  },
])(
  'native invoice initialization: $label',
  async ({ invoiceCount, existing, rejected, pending }) => {
    const { initializeInvoices } = await import('../src/website/fill');
    const browser = await chromium.launch({
      executablePath: '/usr/bin/chromium',
      chromiumSandbox: true,
    });
    const dir = await mkdtemp(join(tmpdir(), 'impex-invoice-count-'));
    try {
      const page = await browser.newPage(),
        journal = new Journal(dir);
      const master = { 'general.iec': '001', 'general.exporter': 'ACME' },
        target = 'VIDE-EXP-2627-11';
      const shipment = shipmentFixture();
      shipment.invoices = Array.from(
        { length: invoiceCount },
        (_, index) => shipmentFixture('001', 'INV' + (index + 1)).invoices[0]!,
      );
      const record = runFixture({
        shipment,
        exporterMaster: master,
        targetJobNo: target,
        state: 'target_identified',
        pendingInvoice: pending
          ? { index: 0, number: 'OTHER', date: '2026-10-02' }
          : null,
        sourceSnapshot: {
          ...runFixture().sourceSnapshot!,
          invoices: invoiceCount === 1 ? [{}, {}, {}] : [{}],
        },
        patch: {
          issues: [],
          operations: shipment.invoices.flatMap((invoice, invoiceIndex) =>
            ['invoice.number', 'invoice.date'].map((field) => ({
              section: 'invoice' as const,
              field,
              invoiceIndex,
              value: invoice[field]!.value!,
              action: 'replace' as const,
              evidence: [],
            })),
          ),
        },
      });
      let adds = 0;
      const invoices: Record<string, string>[] = existing.map(
        ([number, date]) => ({
          'invoice.number': number!,
          'invoice.date': date!,
        }),
      );
      await page.route(BASE_URL + '**', async (route) => {
        const data = new URLSearchParams(route.request().postData() ?? ''),
          action = data.get('action') ?? '';
        const isInvoice =
          action === 'invoice' ||
          action === 'new' ||
          action === 'add' ||
          action.startsWith('select:') ||
          data.get('section') === 'invoice';
        if (action === 'add') {
          const pending = (await journal.load(record.runId)).pendingInvoice;
          expect(pending?.index).toBe(adds);
          expect(pending?.number).toBe('INV' + (adds + 1));
          adds++;
          invoices.push(
            Object.fromEntries(
              Object.entries(FIELDS)
                .filter(([, d]) => d.section === 'invoice')
                .map(([key, d]) => [key, data.get(d.id) ?? '']),
            ),
          );
        }
        const selected = action.startsWith('select:')
          ? invoices[Number(action.split(':')[1])]
          : {};
        const values = isInvoice ? (selected ?? {}) : master;
        const controls = Object.entries(FIELDS)
          .filter(
            ([, d]) =>
              d.section === (isInvoice ? 'invoice' : 'general') &&
              d.kind !== 'packing',
          )
          .map(([key, d]) =>
            key === 'general.buyerCountry'
              ? `<select id="${d.id}"><option value=""></option></select>`
              : `<input id="${d.id}" name="${d.id}" value="${(values as Record<string, string>)[key] ?? ''}" ${d.kind === 'check' ? 'type="checkbox"' : ''}>`,
          )
          .join('');
        const grid = isInvoice
          ? `<table id="ContentPlaceHolder1_tbInvoice_TabPanel1_gvInvoiceDetails">${invoices.map((_, i) => `<tr><td><button name="action" value="select:${i}" role="link">Select</button></td></tr>`).join('')}</table>`
          : '';
        await route.fulfill({
          contentType: 'text/html',
          body: `<body>VISHAL LOGISTICS SOLUTIONS Branch : DELHI Fin.Year :2026-2027<form method="POST"><input id="ContentPlaceHolder1_txtjno" value="${target}"><input type="hidden" name="section" value="${isInvoice ? 'invoice' : 'general'}">${controls}${grid}<button name="action" value="invoice">Invoice</button><button id="ContentPlaceHolder1_tbInvoice_TabPanel1_btnNew" name="action" value="new">New</button><button id="ContentPlaceHolder1_tbInvoice_TabPanel1_btnAddInvoice" name="action" value="add">Add</button></form></body>`,
        });
      });
      const session = { page, context: record.context };
      if (rejected) {
        let failure: unknown;
        try {
          await initializeInvoices(session, record, journal);
        } catch (error) {
          failure = error;
        }
        expect(String(failure)).toContain(
          'manual invoice-layout reconciliation',
        );
        expect(adds).toBe(0);
        expect(record.pendingInvoice).toEqual(
          pending ? { index: 0, number: 'OTHER', date: '2026-10-02' } : null,
        );
        return;
      }
      await initializeInvoices(session, record, journal);
      expect(invoices).toHaveLength(invoiceCount);
      expect(adds).toBe(invoiceCount - existing.length);
      expect(record.pendingInvoice).toBeNull();
      await initializeInvoices(session, record, journal);
      expect(adds).toBe(invoiceCount - existing.length);
    } finally {
      await browser.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
  15000,
);
