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
test('cancelled and other branch/IEC jobs cannot win when same branch candidate exists', () => {
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
test('falls back to eligible exporter candidate from another branch when target branch has none', () => {
  const r: any = selectSource(
    [
      c('EXP-2627-11', '01/09/2026', 'BUYER A', {
        context: { ...context, branch: 'MORADABAD' },
      }),
    ],
    {
      ...shipment,
      context: { branch: 'DELHI', financialYear: '2026-2027' },
    },
  );
  expect(r.source.jobNo).toBe('EXP-2627-11');
});
test('malformed latest dates and ambiguous names block selection', () => {
  expect(
    Array.isArray(
      selectSource([c('VIDE-EXP-2627-9', 'nonsense', 'BUYER A')], shipment),
    ),
  ).toBe(true);
});

test.each([undefined, null, ''])(
  'missing consignee %s uses latest exporter reference rather than matching old blanks',
  (value) => {
    const input = {
      ...shipment,
      fields: {
        ...shipment.fields,
        'general.consignee':
          value === undefined
            ? undefined
            : { value, status: value === null ? 'unknown' : 'sourced' },
      },
    };
    const r: any = selectSource(
      [
        c('VIDE-EXP-2627-9', '01/07/2026', ''),
        c('VIDE-EXP-2627-10', '01/08/2026', 'BUYER B'),
      ],
      input,
    );
    expect(r.source?.jobNo).toBe('VIDE-EXP-2627-10');
    expect(r.reason).toBe('exporter_fallback');
  },
);

test('missing exporter still blocks reference selection when IEC is present', () => {
  const r = selectSource([c('VIDE-EXP-2627-10', '01/08/2026', 'BUYER A')], {
    ...shipment,
    fields: {
      ...shipment.fields,
      'general.exporter': { value: null, status: 'unknown' },
    },
  });
  expect(
    Array.isArray(r) && r.some((i) => i.code === 'identity' && i.blocking),
  ).toBe(true);
});
