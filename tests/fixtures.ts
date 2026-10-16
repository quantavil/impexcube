import type { RunRecord } from '../src/journal';
import type { Field, Shipment } from '../src/schemas';
import { policyFingerprint } from '../src/workflow';

const fieldFixture = (value: string): Field => ({
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
    workflowVersion: 1,
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
    },
    targetJobNo: null,
    exporterMaster: {
      'general.iec': '001',
      'general.exporter': 'Example Exporter',
    },
    pendingInvoice: null,
    inputFolder: '/tmp/test-shipment',
    inputHash: 'abc',
    policyHash: policyFingerprint(),
    reason: 'same_consignee',
    expectedRates: {},
    savedSections: [],
    issues: [],
    patch: { operations: [], issues: [] },
    transitions: [],
    ...overrides,
  };
}
