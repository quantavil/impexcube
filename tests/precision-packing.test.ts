import { expect, test } from 'bun:test';
import { mergeShipment } from '../src/policy/merge';
import { equivalent } from '../src/website/fill';

test('decimal readback preserves digits above floating point precision', () => {
  expect(equivalent('9007199254740992', '9007199254740993', 'decimal')).toBe(
    false,
  );
  expect(equivalent('00012.3400', '12.34', 'decimal')).toBe(true);
  expect(equivalent('garbage', 'garbage', 'decimal')).toBe(false);
});
test('numbered packing is always omitted despite documents and old ranges', () => {
  const f = (value: string): any => ({
    value,
    status: 'sourced',
    evidence: [],
  });
  const context: any = { branch: 'DELHI', financialYear: '2026-2027' };
  const p = mergeShipment(
    {
      context,
      jobNo: 'OLD-1',
      fields: { 'shipment.packingFrom': '5', 'shipment.packingTo': '6' },
      invoices: [{}],
      packingRanges: [
        { from: '1', to: '4', total: '4', unit: 'PLT' },
        { from: '5', to: '6', total: '2', unit: 'PLT' },
      ],
    },
    {
      context,
      fields: {
        'shipment.packages': f('8'),
        'shipment.packingFrom': f('1'),
        'shipment.packingTo': f('7'),
        'shipment.packageUnit': f('BOX'),
        'shipment.packingUnit': f('BOX'),
      },
      invoices: [{}],
    },
  );
  expect(p.operations.some((o) => o.field.startsWith('shipment.packing'))).toBe(
    false,
  );
  expect(p.issues.some((i) => /^packing_/.test(i.code))).toBe(false);
  expect(p.operations.find((o) => o.field === 'shipment.packages')?.value).toBe(
    '8',
  );
});
