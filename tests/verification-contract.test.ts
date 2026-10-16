import { expect, test } from 'bun:test';
import {
  verifyInvoiceConversion,
  verifySnapshotContract,
} from '../src/website/verify';

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
test('wrong exporter and changed source block header verification', () => {
  const source: any = {
    context: { branch: 'DELHI', financialYear: '2026-2027' },
    jobNo: 'EXP-2627-1',
    fields: { 'general.iec': '001', 'general.exporter': 'ACME' },
    invoices: [],
  };
  const target = {
    ...source,
    jobNo: 'EXP-2627-2',
    fields: { ...source.fields, 'general.iec': '999' },
  };
  const issues = verifySnapshotContract(
    { ...source, fields: { ...source.fields, 'general.exporter': 'CHANGED' } },
    target,
    { sourceSnapshot: source, exporterMaster: source.fields } as any,
  );
  expect(issues.some((i) => i.code === 'identity' && i.blocking)).toBe(true);
  expect(issues.some((i) => i.code === 'source_changed' && i.blocking)).toBe(
    true,
  );
});

test('target identity uses the resolved master while preserving the previous reference independently', () => {
  const reference: any = {
    context: { branch: 'DELHI', financialYear: '2026-2027' },
    jobNo: 'EXP-2627-1',
    fields: {
      'general.iec': '001',
      'general.exporter': 'ACME',
      'general.exporterAddress': 'OLD ADDRESS',
    },
    invoices: [],
  };
  const master = {
    ...reference.fields,
    'general.exporterAddress': 'CURRENT ADDRESS',
  };
  const target = { ...reference, jobNo: 'EXP-2627-2', fields: master };
  expect(
    verifySnapshotContract(reference, target, {
      sourceSnapshot: reference,
      exporterMaster: master,
    } as any),
  ).toEqual([]);
});
