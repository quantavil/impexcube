import { expect, test } from 'bun:test';
import {
  normalizeDate,
  normalizeDecimal,
  validateShipment,
} from '../src/values';

test('Indian date is canonical and impossible dates fail', () => {
  expect(normalizeDate('16/07/2026')).toBe('2026-07-16');
  expect(() => normalizeDate('31/02/2026')).toThrow();
});
test('ambiguous numbers need locale; exact decimal strings survive', () => {
  expect(() => normalizeDecimal('1,234')).toThrow();
  expect(normalizeDecimal('1,234.50', 'en-IN')).toBe('1234.50');
  expect(normalizeDecimal('0.00')).toBe('0.00');
});
test('numeric IEC is rejected to protect identifier formatting', () => {
  const s: any = {
    context: { branch: 'DELHI', financialYear: '2026-2027' },
    fields: {
      'general.exporter': { value: 'ABC', status: 'sourced', evidence: [] },
      'general.iec': { value: 501, status: 'sourced', evidence: [] },
    },
    invoices: [],
  };
  expect(validateShipment(s).some((i) => i.code === 'identifier')).toBe(true);
});
test('malformed invoices and evidence produce shape issues', () => {
  const base: any = {
    context: { branch: 'DELHI', financialYear: '2026-2027' },
    fields: {},
    invoices: [null],
  };
  expect(validateShipment(base).some((i) => i.code === 'shape')).toBe(true);
  base.invoices = [];
  base.fields.a = { value: 'x', status: 'sourced', evidence: [null] };
  expect(validateShipment(base).some((i) => i.code === 'shape')).toBe(true);
});
