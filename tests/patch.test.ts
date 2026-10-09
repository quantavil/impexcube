import { expect, test } from 'bun:test';
import { buildPatch, isAllowed } from '../src/policy/patch';

const f = (value: string, status = 'sourced'): any => ({
  value,
  status,
  evidence: [{ file: 'a.pdf', page: 1, raw: value }],
});
const source: any = {
  context: { branch: 'DELHI', financialYear: '2026-2027' },
  jobNo: 'VIDE-EXP-2627-10',
  fields: {
    'general.iec': '0502032324',
    'general.consignee': 'OLD',
    'shipment.mbl': 'OLD-BL',
  },
  invoices: [{ 'invoice.number': 'OLD' }],
  productFingerprint: null,
};
test('never permits product edits or excluded section writes', () => {
  expect(
    isAllowed({
      section: 'product',
      field: 'product.rate',
      action: 'replace',
      value: '1',
    } as any),
  ).toBe(false);
  expect(
    isAllowed({
      section: 'shipment',
      field: 'container.number',
      action: 'replace',
      value: '1',
    } as any),
  ).toBe(false);
});
test('replaces consignee, clears old transport and resets old SB identifiers', () => {
  const p = buildPatch(source, {
    context: source.context,
    fields: { 'general.consignee': f('NEW') },
    invoices: [{ 'invoice.number': f('NEW-INV') }],
  });
  expect(
    p.operations.some(
      (o) => o.field === 'general.consignee' && o.value === 'NEW',
    ),
  ).toBe(true);
  expect(
    p.operations.some(
      (o) => o.field === 'shipment.mbl' && o.action === 'clear',
    ),
  ).toBe(true);
  expect(
    p.operations.some((o) => o.field === 'general.sbNumber' && o.value === '0'),
  ).toBe(true);
});
test('invoice count change and unknown charges block preflight', () => {
  const p = buildPatch(source, {
    context: source.context,
    fields: {},
    invoices: [],
  });
  expect(p.issues.some((i) => i.code === 'invoice_count' && i.blocking)).toBe(
    true,
  );
  expect(p.issues.some((i) => i.code === 'required')).toBe(true);
});
test('refuses unknown field names and mismatched exporter IEC', () => {
  const p = buildPatch(source, {
    context: source.context,
    fields: { 'general.iec': f('999'), 'product.rate': f('1') },
    invoices: [{}],
  });
  expect(p.issues.some((i) => i.code === 'identity')).toBe(true);
  expect(p.issues.some((i) => i.code === 'excluded')).toBe(true);
});
test('mandatory blank identifiers and amounts block preflight', () => {
  const p = buildPatch(source, {
    context: source.context,
    fields: { 'shipment.grossWeight': f(' ') },
    invoices: [{ 'invoice.number': f(''), 'invoice.date': f('') }],
  });
  for (const field of [
    'shipment.grossWeight',
    'invoice.number',
    'invoice.date',
  ])
    expect(
      p.issues.some((i) => i.code === 'required' && i.field === field),
    ).toBe(true);
});
test('carton range updates preserve copied declarations and refresh total cartons', () => {
  const old =
    'TOTAL 517 CARTONS, (LUT ARN NO. AD090426004649U), WE INTEND TO CLAIM RODTEP.';
  const p = buildPatch(
    { ...source, fields: { ...source.fields, 'shipment.marks': old } },
    {
      context: source.context,
      fields: {
        'shipment.marks': f('1-999'),
        'shipment.packages': f('999'),
        'shipment.packageUnit': f('CTN'),
      },
      invoices: [{}],
    },
  );
  expect(p.operations.find((o) => o.field === 'shipment.marks')?.value).toBe(
    'TOTAL 999 CARTONS, (LUT ARN NO. AD090426004649U), WE INTEND TO CLAIM RODTEP. CARTON NOS. 1-999',
  );
});
test('ambiguous inherited marks require review; explicit replacement remains possible', () => {
  const s = {
    ...source,
    fields: { ...source.fields, 'shipment.marks': 'OLD BUYER / CARTONS 10-20' },
  };
  const shipment = {
    context: source.context,
    fields: {
      'shipment.marks': f('1-999'),
      'shipment.packages': f('999'),
      'shipment.packageUnit': f('CTN'),
    },
    invoices: [{}],
  };
  expect(
    buildPatch(s, shipment).issues.some(
      (i) => i.code === 'marks_review' && i.blocking,
    ),
  ).toBe(true);
  shipment.fields['shipment.marks'] = f('EXPLICIT NEW MARKS', 'default');
  expect(
    buildPatch(s, shipment).operations.find((o) => o.field === 'shipment.marks')
      ?.value,
  ).toBe('EXPLICIT NEW MARKS');
});
