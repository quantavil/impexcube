import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { readSnapshot } from '../src/browser/read';
import { BASE_URL } from '../src/browser/session';
import { verifyPatch } from '../src/browser/verify';
import { SAVE_IDS, savePatch } from '../src/browser/write';
import { FIELDS } from '../src/policy/fields';
import { executeRun } from '../src/runs/execute';
import { Journal } from '../src/runs/journal';
import { runFixture } from './fixtures';

test('a silently unpersisted field is detected only after all section saves at final verification', async () => {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    chromiumSandbox: true,
  });
  const dir = await mkdtemp(join(tmpdir(), 'impex-end-verification-'));
  try {
    const page = await browser.newPage(),
      source = 'EXP-2627-11',
      target = 'EXP-2627-12';
    const defaults = {
      'general.consignee': 'OLD',
      'shipment.netWeight': '1',
      'invoice.currency': 'USD',
      'invoice.amount': '1',
      'invoice.exchangeRate': '2',
      'invoice.amountINR': '2',
      'charges.productAmount': '1',
    };
    const stores: Record<string, Record<string, string>> = {
      [source]: { ...defaults },
      [target]: { ...defaults },
    };
    const saves: string[] = [];
    function html(job: string, section: string) {
      const controls = (sec: string) =>
        Object.entries(FIELDS)
          .filter(([, d]) => d.section === sec && d.kind !== 'packing')
          .map(([k, d]) =>
            k === 'general.buyerCountry'
              ? `<select id="${d.id}" name="${d.id}"><option value=""></option></select>`
              : `<input id="${d.id}" name="${d.id}" ${d.kind === 'check' ? 'type="checkbox"' : ''} value="${stores[job]?.[k] ?? ''}">`,
          )
          .join('');
      const invoice = ['invoice', 'charges', 'thirdParty'].includes(section);
      return `<body>VISHAL LOGISTICS SOLUTIONS Branch : DELHI Fin.Year :2026-2027<form method="POST"><input id="ContentPlaceHolder1_txtjno" value="${job}"><input name="section" value="${section}" type="hidden"><button name="action" value="shipment">Shipment</button><button name="action" value="invoice">Invoice</button>${invoice ? `<table id="ContentPlaceHolder1_tbInvoice_TabPanel1_gvInvoiceDetails"><tr><td><button name="action" value="select" role="link">Select</button></td></tr></table><a href="#" onclick="show('charges')">F&amp;I</a><a href="#" onclick="show('thirdParty')">Third Party Details</a>${['invoice', 'charges', 'thirdParty'].map((sec) => `<div data-tab="${sec}" ${sec === 'invoice' ? '' : 'hidden'}>${controls(sec)}</div>`).join('')}<script>function show(s){document.querySelectorAll('[data-tab]').forEach(e=>e.hidden=e.dataset.tab!==s)}</script>` : controls(section)}<button name="action" value="save" id="${SAVE_IDS[section as keyof typeof SAVE_IDS]}">Update</button></form></body>`;
    }
    await page.route(BASE_URL + '**', async (route) => {
      const req = route.request(),
        job = new URL(req.url()).searchParams.get('JobNo')!,
        data = new URLSearchParams(req.postData() ?? '');
      let section = 'general';
      if (req.method() === 'POST') {
        const action = data.get('action');
        section =
          action === 'shipment'
            ? 'shipment'
            : action === 'invoice' || action === 'select'
              ? 'invoice'
              : (data.get('section') ?? 'general');
        if (action === 'save') {
          saves.push(section);
          for (const [k, d] of Object.entries(FIELDS))
            if (
              d.section === section &&
              data.has(d.id) &&
              k !== 'general.consignee'
            )
              stores[job]![k] = data.get(d.id)!;
        }
      }
      await route.fulfill({
        body: html(job, section),
        contentType: 'text/html',
      });
    });
    const s = {
        page,
        context: { branch: 'DELHI' as const, financialYear: '2026-2027' },
      },
      journal = new Journal(dir);
    const sourceSnapshot = await readSnapshot(s, source);
    const patch = {
      issues: [],
      operations: [
        {
          section: 'general' as const,
          field: 'general.consignee',
          action: 'replace' as const,
          value: 'NEW',
          evidence: [],
        },
        {
          section: 'shipment' as const,
          field: 'shipment.netWeight',
          action: 'replace' as const,
          value: '99',
          evidence: [],
        },
      ],
    };
    const record = runFixture({
      context: s.context,
      sourceJobNo: source,
      targetJobNo: target,
      state: 'target_identified',
      sourceSnapshot,
      patch,
      expectedRates: { USD: '2' },
      productPreservationConfirmedForTarget: target,
    });
    await executeRun(record, journal, {
      copy: async () => {
        throw new Error('Must reuse target');
      },
      checkTarget: async () => {},
      save: () => savePatch(s, target, patch, record, journal),
      verify: () => verifyPatch(s, target, patch, record),
    });
    expect(saves).toEqual(['general', 'shipment']);
    expect(record.savedSections).toEqual(['general:0', 'shipment:0']);
    expect(record.state).toBe('needs_input');
    expect(
      record.issues.some(
        (i) => i.code === 'readback' && i.field === 'general.consignee',
      ),
    ).toBe(true);
    expect(record.issues.some((i) => i.code === 'operation_failed')).toBe(
      false,
    );
  } finally {
    await browser.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 15000);
