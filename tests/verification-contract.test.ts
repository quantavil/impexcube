import { expect, test } from 'bun:test';
import {
  verifyInvoiceConversion,
  verifySnapshotContract,
} from '../src/browser/verify';

test('updated exchange rate must recalculate saved INR invoice amount', () => {
  const invoice = {
    'invoice.amount': '29097.40',
    'invoice.exchangeRate': '95.250000',
    'invoice.amountINR': '2771527.35',
  };
  expect(verifyInvoiceConversion(invoice)).toEqual([]);
  expect(
    verifyInvoiceConversion({
      ...invoice,
      'invoice.amountINR': '2758433.52',
    }).some((i) => i.code === 'exchange_conversion' && i.blocking),
  ).toBe(true);
  expect(
    verifyInvoiceConversion({ ...invoice, 'invoice.amountINR': '' }).length,
  ).toBe(1);
});
test('INR conversion uses exact decimals and rounds cents without floating point loss', () => {
  expect(
    verifyInvoiceConversion({
      'invoice.amount': '9007199254740993.01',
      'invoice.exchangeRate': '1',
      'invoice.amountINR': '9007199254740993.01',
    }),
  ).toEqual([]);
  expect(
    verifyInvoiceConversion({
      'invoice.amount': '1.005',
      'invoice.exchangeRate': '1',
      'invoice.amountINR': '1.01',
    }),
  ).toEqual([]);
});
test('wrong exporter, changed source and missing copied Products block verification', () => {
  const source: any = {
    context: { branch: 'DELHI', financialYear: '2026-2027' },
    jobNo: 'EXP-2627-1',
    fields: { 'general.iec': '001', 'general.exporter': 'ACME' },
    invoices: [],
    productFingerprint: 'rows-a',
  };
  const target = {
    ...source,
    jobNo: 'EXP-2627-2',
    fields: { ...source.fields, 'general.iec': '999' },
    productFingerprint: null,
  };
  expect(typeof verifySnapshotContract).toBe('function');
  const issues = verifySnapshotContract(
    { ...source, fields: { ...source.fields, 'general.exporter': 'CHANGED' } },
    target,
    { sourceSnapshot: source } as any,
  );
  expect(issues.some((i) => i.code === 'identity' && i.blocking)).toBe(true);
  expect(issues.some((i) => i.code === 'source_changed' && i.blocking)).toBe(
    true,
  );
  expect(
    issues.some((i) => i.code === 'product_preservation' && i.blocking),
  ).toBe(true);
});
test('manual Product-preservation confirmation is bound to exact target', () => {
  const source: any = {
    jobNo: 'EXP-2627-1',
    fields: { 'general.iec': '001' },
    invoices: [],
    productFingerprint: null,
  };
  const target = { ...source, jobNo: 'EXP-2627-2' };
  expect(
    verifySnapshotContract(source, target, {
      sourceSnapshot: source,
      productPreservationConfirmedForTarget: 'EXP-2627-3',
    } as any).some((i) => i.code === 'product_preservation'),
  ).toBe(true);
  expect(
    verifySnapshotContract(source, target, {
      sourceSnapshot: source,
      productPreservationConfirmedForTarget: target.jobNo,
    } as any),
  ).toEqual([]);
});
