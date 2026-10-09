import type { Field, Shipment } from '../src/domain/model';
import type { RunRecord } from '../src/runs/journal';
export const fieldFixture = (value: string): Field => ({
  value,
  status: 'sourced',
  evidence: [{ file: 'invoice.pdf', page: 1, raw: value }],
});
export function shipmentFixture(
  iec = '001',
  invoice = 'INV1',
  date = '2026-10-02',
): Shipment {
  return {
    context: { branch: 'DELHI', financialYear: '2026-2027' },
    fields: { 'general.iec': fieldFixture(iec) },
    invoices: [
      {
        'invoice.number': fieldFixture(invoice),
        'invoice.date': fieldFixture(date),
      },
    ],
  };
}
export function runFixture(overrides: Partial<RunRecord> = {}): RunRecord {
  const shipment = shipmentFixture();
  return {
    runId: 'r1',
    shipment,
    state: 'prepared',
    context: shipment.context,
    sourceJobNo: 'VIDE-EXP-2627-10',
    sourceSnapshot: {
      context: shipment.context,
      jobNo: 'VIDE-EXP-2627-10',
      fields: {},
      invoices: [{}],
      productFingerprint: null,
    },
    targetJobNo: null,
    inputFolder: '/tmp/test-shipment',
    inputHash: 'abc',
    reason: 'same_consignee',
    expectedRates: {},
    savedSections: [],
    issues: [],
    patch: { operations: [], issues: [] },
    transitions: [],
    ...overrides,
  };
}
