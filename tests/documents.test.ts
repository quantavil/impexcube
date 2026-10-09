import { expect, test } from 'bun:test';
import { ingestExtraction } from '../src/documents/handoff';

const docs: any = [
  {
    file: 'a.pdf',
    role: 'invoice',
    pages: [{ page: 1, text: 'Exporter ACME Invoice 001' }],
    needsVisual: false,
  },
];
test('AI handoff rejects unsupported evidence and reference sources', () => {
  expect(() =>
    ingestExtraction(
      {
        context: { branch: 'DELHI', financialYear: '2026-2027' },
        fields: {
          'general.exporter': {
            value: 'ACME',
            status: 'sourced',
            evidence: [{ file: 'missing.pdf', page: 1, raw: 'ACME' }],
          },
        },
        invoices: [],
      },
      docs,
    ),
  ).toThrow();
});
test('AI handoff keeps sourced identifiers as strings', () => {
  const r = ingestExtraction(
    {
      context: { branch: 'DELHI', financialYear: '2026-2027' },
      fields: {
        'general.exporter': {
          value: 'ACME',
          status: 'sourced',
          evidence: [{ file: 'a.pdf', page: 1, raw: 'ACME' }],
        },
      },
      invoices: [],
    },
    docs,
  );
  expect(r.fields['general.exporter']?.value).toBe('ACME');
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

test('INTKD6_001 validates cleanly and ingests product instructions', async () => {
  const { loadShipment } = await import('../src/runs/prepare');
  const { shipment } = await loadShipment('tests/fixtures/INTKD6_001');
  expect(shipment.invoices.length).toBe(1);
  expect(shipment.products?.length).toBe(3);
  expect(shipment.products?.[0].fields['EndUse']?.value).toBe('GNX200');
  expect(shipment.products?.[0].fields['CountryDestination']?.value).toBe('CI');
});

test('docx document extracts clean markdown and lines via mammoth', async () => {
  const { readSingleDocument } = await import('../src/documents/extract');
  const doc = await readSingleDocument(
    'tests/fixtures/documents/sample.docx',
    'packing',
  );
  expect(doc.reader).toBe('mammoth');
  expect(doc.markdown).toContain('DELTA ELECTRONICS');
  expect(doc.markdown).toContain('SERCOM AON GROUP');
  expect(doc.markdown).toContain('UT/1118644/26-27');
  expect(doc.lines?.length).toBeGreaterThan(10);
  expect(doc.needsVisual).toBe(false);
});
