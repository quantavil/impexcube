import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { fingerprint, Journal } from '../src/journal';
import { FIELDS } from '../src/policy/fields';
import { BASE_URL } from '../src/website/session';
import {
  extractShipment,
  hashInputs,
  loadShipment,
  prepareRun,
} from '../src/workflow';
import { runFixture } from './fixtures';

const context = { branch: 'MORADABAD' as const, financialYear: '2026-2027' };

async function inputFixture(root: string, journal: Journal) {
  const folder = join(root, 'INMBD6_001');
  await mkdir(folder);
  await writeFile(join(folder, 'invoice.txt'), 'Example Exporter INV123 FOB');
  const handoff = await extractShipment(folder, context, journal);
  const path = handoff.artifactPath,
    artifact = await Bun.file(path).json();
  const field = (value: string, status = 'sourced') => ({
    value,
    status,
    evidence: [{ file: 'invoice.txt', page: 1, raw: value }],
  });
  artifact.shipment.fields = { 'general.exporter': field('Example Exporter') };
  artifact.shipment.invoices = [
    {
      'invoice.number': field('INV123'),
      'invoice.terms': field('FOB', 'conflict'),
    },
  ];
  await writeFile(path, JSON.stringify(artifact));
  return { folder, runId: handoff.input.runId };
}

test('unchanged prepared data reuses its recorded source without browser discovery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'impex-prepare-')),
    journal = new Journal(join(root, 'runs'));
  try {
    const { folder, runId } = await inputFixture(root, journal),
      loaded = await loadShipment(folder, context, journal);
    const r = runFixture({
      runId,
      context,
      inputFolder: folder,
      inputHash: loaded.inputHash,
      shipment: loaded.shipment,
      sourceSnapshot: {
        context,
        jobNo: 'VIDE-EXP-2627-10',
        fields: {},
        invoices: [],
      },
    });
    await journal.save(r);
    const actual = await prepareRun(
      folder,
      context,
      null as any,
      journal,
      true,
    );
    expect(actual.runId).toBe(runId);
    expect(actual.sourceJobNo).toBe('VIDE-EXP-2627-10');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test.each(['inputs', 'policy'])(
  'changed %s re-merges on the same target even with different previous invoice count',
  async (changed) => {
    const root = await mkdtemp(join(tmpdir(), 'impex-remerge-')),
      journal = new Journal(join(root, 'runs'));
    const browser = await chromium.launch({
      executablePath: '/usr/bin/chromium',
      chromiumSandbox: true,
    });
    try {
      const { folder, runId } = await inputFixture(root, journal),
        loaded = await loadShipment(folder, context, journal);
      await journal.save(
        runFixture({
          runId,
          context,
          inputFolder: folder,
          shipment: loaded.shipment,
          state: 'verified',
          targetJobNo: 'EXP-2627-101',
          inputHash: changed === 'inputs' ? 'old' : loaded.inputHash,
          policyHash:
            changed === 'policy'
              ? fingerprint(FIELDS)
              : runFixture().policyHash,
          sourceSnapshot: {
            context,
            jobNo: 'VIDE-EXP-2627-10',
            fields: {
              'general.exporter': 'Example Exporter',
              'general.iec': '001',
              'general.iecBranch': 'B1',
            },
            invoices: [
              { 'invoice.number': 'OLD1' },
              { 'invoice.number': 'OLD2' },
            ],
          },
          exporterMaster: {
            'general.exporter': 'Example Exporter',
            'general.iec': '001',
            'general.iecBranch': 'B1',
          },
        }),
      );
      const page = await browser.newPage();
      let saves = 0;
      await page.route(BASE_URL + '**', async (route) => {
        const request = route.request();
        if (!request.url().includes('Mode=NewJob'))
          throw new Error('Unexpected source discovery or target navigation');
        const posted = request.method() === 'POST';
        if (posted && new URLSearchParams(request.postData() ?? '').has('save'))
          saves++;
        const controls = Object.entries(FIELDS)
          .filter(([, d]) => d.section === 'general')
          .map(([key, d]) => {
            const value =
              key === 'general.exporter'
                ? posted
                  ? 'Example Exporter'
                  : ''
                : key === 'general.iec'
                  ? '001'
                  : key === 'general.iecBranch'
                    ? 'B1'
                    : key === 'general.mode'
                      ? 'L'
                      : key === 'general.customCity'
                        ? 'MORADABAD'
                        : key === 'general.customHouse'
                          ? 'INMBD6'
                          : '';
            if (d.kind === 'select')
              return `<select id="${d.id}"><option value="${value}">${key === 'general.mode' ? 'Land ICD' : value}</option></select>`;
            return `<input id="${d.id}" ${key === 'general.exporter' ? 'name="exporter" onchange="__doPostBack()"' : ''} ${d.kind === 'check' ? 'type="checkbox"' : ''} value="${value}">`;
          })
          .join('');
        await route.fulfill({
          contentType: 'text/html',
          body: `<body>VISHAL LOGISTICS SOLUTIONS Branch : MORADABAD Fin.Year :2026-2027<form method="POST"><input id="ContentPlaceHolder1_txtjno" value="">${controls}<button name="save">Save</button></form><script>function __doPostBack(){document.querySelector('form').submit()}</script></body>`,
        });
      });
      await page.goto(BASE_URL + 'frmExportJobCreation.aspx?Mode=NewJob');
      const r = await prepareRun(folder, context, { page, context }, journal);
      expect(r.targetJobNo).toBe('EXP-2627-101');
      expect(r.sourceJobNo).toBe('VIDE-EXP-2627-10');
      expect(r.shipment.invoices).toHaveLength(1);
      expect(r.sourceSnapshot!.invoices).toHaveLength(2);
      expect(r.patch.issues.some((i) => i.code === 'invoice_count')).toBe(
        false,
      );
      expect((await journal.load(runId)).targetJobNo).toBe('EXP-2627-101');
      const final = await Bun.file(
        join(journal.runFolder(runId), 'final.json'),
      ).json();
      expect(final.invoiceCount).toBe(1);
      expect(
        final.operations.some((o: any) => o.field === 'shipment.packingFrom'),
      ).toBe(false);
      expect(saves).toBe(0);
      expect(await hashInputs(folder, context, journal)).toBe(r.inputHash);
    } finally {
      await browser.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  30000,
);
