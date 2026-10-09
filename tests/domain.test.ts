import { expect, test } from 'bun:test';
import {
  normalizeDate,
  normalizeDecimal,
  validateShipment,
} from '../src/domain/validate';
import { parseManifest, resolveInputPath } from '../src/inputs/load';

test('Indian date is canonical and impossible dates fail', () => {
  expect(normalizeDate('16/07/2026')).toBe('2026-07-16');
  expect(() => normalizeDate('31/02/2026')).toThrow();
});
test('ambiguous numbers need locale; exact decimal strings survive', () => {
  expect(() => normalizeDecimal('1,234')).toThrow();
  expect(normalizeDecimal('1,234.50', 'en-IN')).toBe('1234.50');
  expect(normalizeDecimal('0.00')).toBe('0.00');
});
test('branch cannot be inferred and input cannot escape folder', () => {
  expect(() => parseManifest({ shipmentId: 'a', files: [] })).toThrow();
  expect(() => resolveInputPath('/tmp/job', '../other')).toThrow();
});
test('unknown is not explicit zero and IEC must be text', () => {
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

test('configured branch default fills only an omitted manifest branch', () => {
  const prior = process.env.IMPEX_DEFAULT_BRANCH;
  try {
    process.env.IMPEX_DEFAULT_BRANCH = 'MORADABAD';
    const base = {
      shipmentId: 'a',
      context: { financialYear: '2026-2027' },
      files: [{ path: 'invoice.pdf', role: 'invoice' }],
    };
    expect(parseManifest(base).context.branch).toBe('MORADABAD');
    expect(
      parseManifest({ ...base, context: { ...base.context, branch: 'DELHI' } })
        .context.branch,
    ).toBe('DELHI');
    expect(() =>
      parseManifest({
        ...base,
        context: { ...base.context, branch: 'MORADABD' },
      }),
    ).toThrow();
    process.env.IMPEX_DEFAULT_BRANCH = 'INVALID';
    expect(() => parseManifest(base)).toThrow();
    delete process.env.IMPEX_DEFAULT_BRANCH;
    expect(() => parseManifest(base)).toThrow();
    expect(base.context).toEqual({ financialYear: '2026-2027' });
  } finally {
    if (prior === undefined) delete process.env.IMPEX_DEFAULT_BRANCH;
    else process.env.IMPEX_DEFAULT_BRANCH = prior;
  }
});
