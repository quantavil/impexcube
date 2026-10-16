import { expect, test } from 'bun:test';
import { ingestExtraction, invoiceNumberOf } from '../src/documents/evidence';

import { InstructionsSchema } from '../src/schemas';

const docs: any = [
  {
    file: 'a.pdf',
    role: 'invoice',
    pages: [{ page: 1, text: 'Exporter ACME Invoice 001' }],
    needsVisual: false,
  },
];
test('retired Product fields and instructions are rejected rather than translated', () => {
  expect(() =>
    InstructionsSchema.parse({ 'product[0].RITCCode': '85051110' }),
  ).toThrow();
  expect(() =>
    ingestExtraction(
      {
        context: { branch: 'DELHI', financialYear: '2026-2027' },
        fields: {},
        invoices: [],
        products: [],
      },
      [],
    ),
  ).toThrow();
});

test('AI handoff rejects missing files, reference sources and invented quotes', () => {
  for (const [source, evidence] of [
    [docs, { file: 'missing.pdf', page: 1, raw: 'ACME' }],
    [
      [{ ...docs[0], role: 'reference' }],
      { file: 'a.pdf', page: 1, raw: 'ACME' },
    ],
    [docs, { file: 'a.pdf', page: 2, raw: 'ACME' }],
    [docs, { file: 'a.pdf', page: 1, raw: 'OTHER EXPORTER' }],
  ]) {
    expect(() =>
      ingestExtraction(
        {
          context: { branch: 'DELHI', financialYear: '2026-2027' },
          fields: {
            'general.exporter': {
              value: 'ACME',
              status: 'sourced',
              evidence: [evidence],
            },
          },
          invoices: [],
        },
        source,
      ),
    ).toThrow();
  }
});
test('explicit override can resolve conflict after evidence validation', () => {
  const raw: any = {
    context: { branch: 'DELHI', financialYear: '2026-2027' },
    fields: {
      'general.exporter': {
        value: 'ACME',
        status: 'conflict',
        evidence: [{ file: 'a.pdf', page: 1, raw: 'ACME' }],
      },
    },
    invoices: [],
  };
  expect(
    ingestExtraction(raw, docs, { 'general.exporter': 'ACME' }).fields[
      'general.exporter'
    ]?.status,
  ).toBe('default');
});
test('anydoc Markdown evidence uses exact generated line and rejects invented coordinates', () => {
  const document: any = {
    file: 'invoice.xls',
    role: 'invoice',
    reader: 'anydoc',
    markdown: '## Invoice\n| TOTAL | 10685 |',
    lines: [
      { line: 1, text: '## Invoice' },
      { line: 2, text: '| TOTAL | 10685 |' },
    ],
    needsVisual: false,
  };
  const field: any = {
    value: '10685',
    status: 'sourced',
    evidence: [{ file: 'invoice.xls', line: 2, raw: '10685' }],
  };
  const shipment: any = {
    context: { branch: 'DELHI', financialYear: '2026-2027' },
    fields: {},
    invoices: [{ 'invoice.amount': field }],
  };
  expect(
    ingestExtraction(shipment, [document]).invoices[0]?.['invoice.amount']
      ?.value,
  ).toBe('10685');
  field.evidence = [
    { file: 'invoice.xls', sheet: 'Invoice', cell: 'B1', raw: '10685' },
  ];
  expect(() => ingestExtraction(shipment, [document])).toThrow();
});

test('xlsx cells containing commas stay in a single Markdown column', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const XLSX = await import('xlsx');
  const { readSingleDocument } = await import('../src/documents/read');
  const dir = await mkdtemp(join(tmpdir(), 'impex-xlsx-comma-'));
  try {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['Description', 'Amount'],
      ["ABIDJAN, CÔTE D'IVOIRE", '52,000.00'],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'Invoice');
    const file = join(dir, 'INV-001.xlsx');
    XLSX.writeFile(wb, file);
    const doc = await readSingleDocument(file, 'invoice');
    expect(doc.reader).toBe('xlsx');
    expect(doc.markdown).toContain('| 52,000.00 |');
    expect(doc.markdown).toContain("| ABIDJAN, CÔTE D'IVOIRE |");
    expect(doc.markdown).not.toContain('| "52 |');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('malformed AI evidence is rejected with a contextual shape error', () => {
  const raw: any = {
    context: { branch: 'DELHI', financialYear: '2026-2027' },
    fields: {
      'general.exporter': {
        value: 'ACME',
        status: 'sourced',
        evidence: [null],
      },
    },
    invoices: [],
  };
  expect(() => ingestExtraction(raw, docs)).toThrow('shape: general.exporter');
});

test('shipment fixture validates current document evidence without legacy inputs', async () => {
  const { readSingleDocument } = await import('../src/documents/read');
  const { readdir } = await import('node:fs/promises');
  const folder = 'tests/fixtures/INTKD6_001';
  const documents = [];
  for (const name of (await readdir(folder)).filter((name) =>
    name.endsWith('.txt'),
  )) {
    const doc = await readSingleDocument(folder + '/' + name, 'document');
    documents.push({ ...doc, file: name });
  }
  const shipment = ingestExtraction(
    await Bun.file(folder + '/shipment-data.json').json(),
    documents,
  );
  expect(shipment.invoices).toHaveLength(1);
  expect(shipment.invoices[0]!['invoice.number']!.value).toBe(
    'UT/1112370/26-27',
  );
});

test('docx document extracts clean markdown and lines via xberg', async () => {
  const { readSingleDocument } = await import('../src/documents/read');
  const doc = await readSingleDocument(
    'tests/fixtures/documents/sample.docx',
    'packing',
  );
  expect(doc.reader).toBe('xberg');
  expect(doc.markdown).toContain('DELTA ELECTRONICS');
  expect(doc.markdown).toContain('SERCOM AON GROUP');
  expect(doc.markdown).toContain('UT/1118644/26-27');
  expect(doc.lines?.length).toBeGreaterThan(5);
  expect(doc.needsVisual).toBe(false);
});

test('ingestion orders real invoice headers numerically rather than lexicographically', () => {
  const evidence = [
    { file: 'a.pdf', page: 1, raw: 'Exporter ACME Invoice 001' },
  ];
  const field = (value: string) => ({ value, status: 'sourced', evidence });
  const shipment = {
    context: { branch: 'DELHI', financialYear: '2026-2027' },
    fields: {},
    invoices: [
      { 'invoice.number': field('INV-10') },
      { 'invoice.number': field('INV-2') },
      { 'invoice.number': field('INV-1') },
    ],
  };
  const out = ingestExtraction(shipment, docs);
  expect(out.invoices.map(invoiceNumberOf)).toEqual([
    'INV-1',
    'INV-2',
    'INV-10',
  ]);
});
