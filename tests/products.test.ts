import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as XLSX from 'xlsx';
import {
  buildProductsFromExtracted,
  generateProductExcel,
  processProductsFolder,
  reconcileProducts,
  standardizeProductDescription,
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
    const result = await processProductsFolder(
      'tests/fixtures/INTKD6_001',
      outPath,
    );
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

test('standardizeProductDescription formats Artware, Furniture, and Industrial descriptions correctly', () => {
  // Artware mirror with ranked materials high to low
  const artwareDesc = standardizeProductDescription(
    [
      { name: 'ALUMINIUM', weight: 5.8 },
      { name: 'GLASS', weight: 4.8 },
      { name: 'MDF', weight: 1.0 },
    ],
    'CAST ALUMINIUM ROUND WALL MIRROR W/ CLEAR GLASS W/ TEXTURE FRAME',
  );
  expect(artwareDesc).toBe(
    'OTHER ARTICLES OF ALUMINIUM / GLASS / MDF ARTWARE - CAST ALUMINIUM ROUND WALL MIRROR W/ CLEAR GLASS W/ TEXTURE FRAME',
  );

  // Furniture artware table using config template
  const furnitureDesc = standardizeProductDescription(
    [{ name: 'MANGO WOOD', weight: 10.0 }],
    'COFFEE TABLE SMALL',
  );
  expect(furnitureDesc).toBe(
    'OTHER FURNITURE ARTICLES OF MANGO WOOD ARTWARE - COFFEE TABLE SMALL',
  );

  // Industrial item retaining raw commercial uppercase without prefix
  const industrialDesc = standardizeProductDescription(
    [],
    'DIPPRA7TYI-002-TPS PP ORION T DPR4K',
    undefined,
    false,
  );
  expect(industrialDesc).toBe('DIPPRA7TYI-002-TPS PP ORION T DPR4K');
});

test('buildProductsFromExtracted leaves Taxable_Value blank by default and resolves SQCUnit/SQCQTY based on duty', async () => {
  const dummyExtracted = {
    invoices: [{ 'invoice.number': { value: 'INV-100' } }],
    products: [
      {
        itemId: '1',
        fields: {
          Description: {
            value:
              'OTHER ARTICLES OF ALUMINIUM / GLASS / MDF ARTWARE - CAST ALUMINIUM ROUND WALL MIRROR W/ CLEAR GLASS W/ TEXTURE FRAME',
          },
          Quantity: { value: '44' },
          QuantityUnit: { value: 'PCS' },
          UnitPrice: { value: '52.50' },
          ProductAmount: { value: '2310.00' },
          RITCCode: { value: '70099200' },
          NetWeight: { value: '510.400' },
        },
      },
    ],
  };

  const result = await buildProductsFromExtracted(dummyExtracted);
  expect(result.total_items).toBe(1);
  const item1 = result.items[0];
  expect(item1.Description).toBe(
    'OTHER ARTICLES OF ALUMINIUM / GLASS / MDF ARTWARE - CAST ALUMINIUM ROUND WALL MIRROR W/ CLEAR GLASS W/ TEXTURE FRAME',
  );
  expect(item1.Taxable_Value).toBeNull();
  expect(item1.SQCUnit).toBe('KGS');
  expect(item1.SQCQTY).toBe('510.400');
  expect(item1.RoDTEPQty).toBe('510.400');
  expect(item1.drawback_schno).toBe('700999B');
  expect(item1.dbk_rate).toBe('1.2');
  expect(item1.ApplicableExpSchemes).toBe('19');
});

test('processProductsFolder for INMBD6_001 generates 37-column Excel with blank Taxable_Value and KGS SQC', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'inmbd-test-'));
  const outPath = join(tmpDir, 'ProductFormat_generated.xlsx');
  try {
    const result = await processProductsFolder('incoming/INMBD6_001', outPath);
    expect(result.total_items).toBe(7);
    expect(result.total_quantity).toBe(308);
    expect(result.total_amount).toBe(12227.6);

    const wb = XLSX.readFile(outPath);
    const sheet = wb.Sheets[wb.SheetNames[0]];

    // Item 1 verification
    expect(sheet['D2']?.v).toBe(
      'OTHER ARTICLES OF ALUMINIUM / GLASS / MDF ARTWARE - CAST ALUMINIUM ROUND WALL MIRROR W/ CLEAR GLASS W/ TEXTURE FRAME',
    );
    expect(sheet['M2']?.v).toBe(44);
    expect(sheet['O2']?.v).toBe(510.4);
    expect(sheet['P2']?.v).toBe('KGS');
    expect(sheet['AF2']).toBeUndefined(); // Blank Taxable_Value cell

    // Item 4 verification
    expect(sheet['D5']?.v).toBe(
      'OTHER ARTICLES OF GLASS / ALUMINIUM / MDF ARTWARE - CAST ALUMINIUM ORGANIC WALL MIRROR',
    );
    expect(sheet['O5']?.v).toBe(332.64);
    expect(sheet['P5']?.v).toBe('KGS');
    expect(sheet['AF5']).toBeUndefined(); // Blank Taxable_Value cell
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
