import { expect, test } from 'bun:test';
import { equivalent } from '../src/browser/write';
import { buildPatch } from '../src/policy/patch';

test('decimal readback preserves digits above floating point precision', () => {
  expect(equivalent('9007199254740992', '9007199254740993', 'decimal')).toBe(
    false,
  );
  expect(equivalent('00012.3400', '12.34', 'decimal')).toBe(true);
  expect(equivalent('garbage', 'garbage', 'decimal')).toBe(false);
});
test('packing range must reconcile with total and multiple old ranges block', () => {
  const f = (value: string): any => ({
    value,
    status: 'sourced',
    evidence: [],
  });
  const s: any = {
    context: { branch: 'DELHI', financialYear: '2026-2027' },
    fields: {},
    invoices: [{}],
    packingRanges: [
      { from: '1', to: '4', total: '4', unit: 'PLT' },
      { from: '5', to: '6', total: '2', unit: 'PLT' },
    ],
  };
  const p = buildPatch(s, {
    context: s.context,
    fields: {
      'shipment.packages': f('8'),
      'shipment.packingFrom': f('1'),
      'shipment.packingTo': f('7'),
      'shipment.packageUnit': f('BOX'),
      'shipment.packingUnit': f('BOX'),
    },
    invoices: [{}],
  });
  expect(p.issues.some((i) => i.code === 'packing_count')).toBe(true);
  expect(p.issues.some((i) => i.code === 'packing_ranges')).toBe(true);
});

test('empty copied packing list accepts a new reconciled range', () => {
  const f = (value: string): any => ({
    value,
    status: 'sourced',
    evidence: [],
  });
  const source: any = {
    context: { branch: 'MORADABAD', financialYear: '2026-2027' },
    fields: {},
    invoices: [{}],
    packingRanges: [],
  };
  const patch = buildPatch(source, {
    context: source.context,
    fields: {
      'shipment.packages': f('999'),
      'shipment.packingFrom': f('1'),
      'shipment.packingTo': f('999'),
      'shipment.packageUnit': f('CTN'),
      'shipment.packingUnit': f('CTN'),
    },
    invoices: [{}],
  });
  expect(patch.issues.some((i) => i.code === 'packing_ranges')).toBe(false);
  expect(patch.issues.some((i) => i.code === 'packing_count')).toBe(false);
});
