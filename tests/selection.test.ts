import { expect, test } from 'bun:test';
import { selectSource } from '../src/policy/select';

const context: any = { branch: 'DELHI', financialYear: '2026-2027' };
const shipment: any = {
  context,
  fields: {
    'general.exporter': { value: 'ACME' },
    'general.iec': { value: '0502032324' },
    'general.consignee': { value: 'BUYER A' },
  },
  invoices: [],
};
const c = (no: string, date: string, buyer: string, extra: any = {}): any => ({
  jobNo: no,
  jobDate: date,
  context,
  exporterName: 'ACME',
  iec: '0502032324',
  consigneeName: buyer,
  cancelled: false,
  mode: 'L',
  customHouse: 'INTKD6',
  ...extra,
});
test('prefers same consignee even when exporter has a newer different buyer', () => {
  const r: any = selectSource(
    [
      c('VIDE-EXP-2627-9', '01/07/2026', 'BUYER A'),
      c('VIDE-EXP-2627-10', '01/08/2026', 'BUYER B'),
    ],
    shipment,
  );
  expect(r.source.jobNo).toBe('VIDE-EXP-2627-9');
});
test('falls back to latest exporter and numeric suffix resolves equal dates', () => {
  const r: any = selectSource(
    [
      c('VIDE-EXP-2627-9', '01/07/2026', 'B'),
      c('VIDE-EXP-2627-10', '01/07/2026', 'C'),
    ],
    shipment,
  );
  expect(r.source.jobNo).toBe('VIDE-EXP-2627-10');
  expect(r.reason).toBe('exporter_fallback');
});
test('cancelled and other branch/IEC jobs cannot win', () => {
  const r: any = selectSource(
    [
      c('VIDE-EXP-2627-9', '01/07/2026', 'BUYER A'),
      c('VIDE-EXP-2627-10', '01/08/2026', 'BUYER A', { cancelled: true }),
      c('EXP-2627-11', '01/09/2026', 'BUYER A', {
        context: { ...context, branch: 'MORADABAD' },
      }),
      c('VIDE-EXP-2627-12', '01/09/2026', 'BUYER A', { iec: 'different' }),
    ],
    shipment,
  );
  expect(r.source.jobNo).toBe('VIDE-EXP-2627-9');
});
test('malformed latest dates and ambiguous names block selection', () => {
  expect(
    Array.isArray(
      selectSource([c('VIDE-EXP-2627-9', 'nonsense', 'BUYER A')], shipment),
    ),
  ).toBe(true);
});

test('respects explicitly preferred job number when available in eligible pool', () => {
  const r: any = selectSource(
    [
      c('VIDE-EXP-2627-9', '01/07/2026', 'BUYER B'),
      c('VIDE-EXP-2627-10', '01/08/2026', 'BUYER C'),
    ],
    shipment,
    'VIDE-EXP-2627-9',
  );
  expect(r.source.jobNo).toBe('VIDE-EXP-2627-9');
});
