import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  generateProductExcel,
  processProductsFolder,
  reconcileProducts,
} from '../src/documents/products';

const fixturesDir = resolve('tests/fixtures/products');
const sourceXlsx = join(fixturesDir, '173 INVOICE PACKING.XLSX');
const templateXlsx = join(fixturesDir, 'ProductFormat.xlsx');
const groundTruthXlsx = join(fixturesDir, 'ProductFormat-_updated.xlsx');

test('reconcileProducts extracts items, matches packing, ranks materials and applies compliance', async () => {
  const result = await reconcileProducts(sourceXlsx);

  expect(result.invoice_no).toBe('2026-27/173');
  expect(result.total_items).toBe(8);
  expect(result.total_quantity).toBe(461);
  expect(result.total_cartons).toBe(461);
  expect(result.total_amount).toBe(16829.5);
  expect(result.total_net_weight).toBe(2938.4);
  expect(result.items.length).toBe(8);

  // Check Item 1: Mango Wood
  const item1 = result.items[0];
  expect(item1.ItemSNo).toBe('1');
  expect(item1.Description).toBe(
    'OTHER FURNITURE ARTICLES OF MANGO WOOD ARTWARE - COFFEE TABLE SMALL',
  );
  expect(item1.Quantity).toBe('49');
  expect(item1.UnitPrice).toBe('26.5');
  expect(item1.ProductAmount).toBe('1298.5');

  // Check Item 8: Dual material S.Steel > Jute
  const item8 = result.items[7];
  expect(item8.ItemSNo).toBe('8');
  expect(item8.Description).toBe(
    'OTHER FURNITURE ARTICLES OF STAINLESS STEEL / JUTE ARTWARE - COFFEE TABLE',
  );
  expect(item8.Quantity).toBe('25');
  expect(item8.UnitPrice).toBe('89');
  expect(item8.ProductAmount).toBe('2225');
  expect(item8._materials).toBeDefined();
  expect(item8._materials?.length).toBe(2);
  expect(item8._materials?.[0].name).toBe('S.Steel');
  expect(item8._materials?.[1].name).toBe('JUTE');
  expect(item8._net_weight).toBe(232.5);

  // Check sum of net weights matches declared total
  const sumWeights = result.items.reduce(
    (acc, it) => acc + (it._net_weight ?? 0),
    0,
  );
  expect(Math.round(sumWeights * 100) / 100).toBe(2938.4);

  // Check compliance fields across all items
  for (const it of result.items) {
    expect(it.InvoiceNo).toBe('2026-27/173');
    expect(it.EndUse).toBe('GNX100');
    expect(it.RewardItem).toBe('Yes');
    expect(it.IGST_PaymentStatus).toBe('LUT');
    expect(it.RITCCode).toBe('94038900');
    expect(it.ApplicableExpSchemes).toBe('19-Drawback (DBK)');
    expect(it.QuantityUnit).toBe('PCS');
    expect(it.SQCQTY).toBe(it.Quantity);
    expect(it.SQCUnit).toBe('NOS');
    expect(it.Per).toBe('1');
    expect(it.PerUnit).toBe('PCS');
    expect(it.drawback_schno).toBe('940399B');
    expect(it.dbk_qty).toBe(it.Quantity);
    expect(it.dbk_rate).toBe('1.2');
    expect(it.dbk_unit).toBe('PCS');
    expect(it.CountryDestination).toBe('ES');
    expect(it.FTACode).toBe('NCPTI');
    expect(it.StateOrigin).toBe('09');
    expect(it.DistrictOrigin).toBe('171');
    expect(it.Taxable_Value).toBe('0');
    expect(it.IGST_Rate).toBe('0');
    expect(it.IGST_Amount).toBe('0');
    expect(it.RODTEP).toBe('Yes');
    expect(it.RoDTEPQty).toBe(it.Quantity);
  }
});

test('generateProductExcel produces 37-column workbook matching ground truth line-by-line', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'product-excel-test-'));
  const outPath = join(tmpDir, 'Generated_ProductFormat.xlsx');

  try {
    const genResult = await generateProductExcel(
      sourceXlsx,
      templateXlsx,
      outPath,
    );
    expect(genResult.status).toBe('ok');
    expect(genResult.items).toBe(8);

    // Compare line-by-line against ground truth using XLSX
    const XLSX = (await import('xlsx')).default || (await import('xlsx'));
    const { COLUMN_LETTERS } = await import('../src/documents/products');
    const genWb = XLSX.readFile(outPath);
    const gtWb = XLSX.readFile(groundTruthXlsx);

    const genWs = genWb.Sheets['Sheet1'];
    const gtWs = gtWb.Sheets['Sheet1'];

    const mismatches: string[] = [];
    for (let rIdx = 1; rIdx <= 9; rIdx++) {
      for (const c of COLUMN_LETTERS) {
        const gv = String(genWs[`${c}${rIdx}`]?.v ?? '');
        const tv = String(gtWs[`${c}${rIdx}`]?.v ?? '');
        if (gv !== tv) {
          mismatches.push(
            `Row ${rIdx} Col ${c}: GT=${JSON.stringify(tv)} vs Gen=${JSON.stringify(gv)}`,
          );
        }
      }
    }
    expect(mismatches).toEqual([]);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('CLI generate-products executes without error and generates workbook', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'product-cli-test-'));
  const outPath = join(tmpDir, 'CLI_ProductFormat.xlsx');

  try {
    const proc = Bun.spawn(
      ['bun', 'src/cli.ts', 'generate-products', fixturesDir, outPath],
      {
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const [out, _err, exit] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exit).toBe(0);
    expect(out).toContain('Generated 37-column product Excel');
    expect(await Bun.file(outPath).exists()).toBe(true);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('processProductsFolder works dynamically on custom folder without 173 naming', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'custom-folder-test-'));
  const customXlsx = join(tmpDir, 'SHIPMENT_INVOICE_PACKING.xlsx');
  const customTmpl = join(tmpDir, 'ProductFormat.xlsx');
  const outPath = join(tmpDir, 'Custom_ProductFormat.xlsx');

  try {
    await Bun.write(customXlsx, await Bun.file(sourceXlsx).arrayBuffer());
    await Bun.write(customTmpl, await Bun.file(templateXlsx).arrayBuffer());

    const result = await processProductsFolder(tmpDir, outPath);
    expect(result.invoice_no).toBe('2026-27/173');
    expect(result.total_items).toBe(8);
    expect(result.total_quantity).toBe(461);
    expect(result.total_net_weight).toBe(2938.4);
    expect(await Bun.file(outPath).exists()).toBe(true);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('CLI prepare-data runs offline preparation with human review gate', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'prepare-data-test-'));
  const customXlsx = join(tmpDir, 'COMMERCIAL_INVOICE_PACKING.xlsx');
  const customTmpl = join(tmpDir, 'ProductFormat.xlsx');
  const manifestPath = join(tmpDir, 'manifest.json');

  try {
    await Bun.write(customXlsx, await Bun.file(sourceXlsx).arrayBuffer());
    await Bun.write(customTmpl, await Bun.file(templateXlsx).arrayBuffer());
    await Bun.write(
      manifestPath,
      JSON.stringify(
        {
          shipmentId: 'INMBD6_001',
          context: { branch: 'MORADABAD', financialYear: '2026-2027' },
          referenceOnly: false,
          files: [{ path: 'COMMERCIAL_INVOICE_PACKING.xlsx', role: 'invoice' }],
        },
        null,
        2,
      ),
    );

    const proc = Bun.spawn(['bun', 'src/cli.ts', 'prepare-data', tmpDir], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [out, _err, exit] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exit).toBe(0);
    expect(out).toContain('[Human Review Gate]');
    expect(out).toContain('Review/edit ProductFormat_generated.xlsx');
    expect(await Bun.file(join(tmpDir, 'sources.json')).exists()).toBe(true);
    expect(
      await Bun.file(join(tmpDir, 'extraction-template.json')).exists(),
    ).toBe(true);
    expect(await Bun.file(join(tmpDir, 'ai-instructions.md')).exists()).toBe(
      true,
    );
    expect(
      await Bun.file(join(tmpDir, 'ProductFormat_generated.xlsx')).exists(),
    ).toBe(true);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('processProductsFolder generates 37-column excel from extracted.json when no source xlsx exists', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'extracted-prod-test-'));
  const outPath = join(tmpDir, 'ProductFormat_generated.xlsx');
  try {
    const result = await processProductsFolder('incoming/INTKD6_001', outPath);
    expect(result.total_items).toBe(3);
    expect(result.total_amount).toBe(89888);
    expect(result.items[0].EndUse).toBe('GNX200');
    expect(result.items[0].CountryDestination).toBe('CI');
    expect(result.items[0].StateOrigin).toBe('05');
    expect(await Bun.file(outPath).exists()).toBe(true);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
