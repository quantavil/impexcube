import { expect, test } from 'bun:test';
import { isAllowed, mergeShipment } from '../src/policy/merge';

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
  const p = mergeShipment(source, {
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
test.each([1, 3])(
  'new invoice count %i wins over a two-invoice reference without cloning fallback',
  (count) => {
    const p = mergeShipment(
      {
        ...source,
        invoices: [
          {
            'invoice.number': 'OLD-1',
            'invoice.payment': 'DP',
            'charges.freight': '12',
          },
          {
            'invoice.number': 'OLD-2',
            'invoice.payment': 'DA',
            'charges.freight': '24',
          },
        ],
      },
      {
        context: source.context,
        fields: {},
        invoices: Array.from({ length: count }, (_, n) => ({
          'invoice.number': f(`NEW-${n + 1}`),
        })),
      },
    );
    expect(p.issues.some((i) => i.code === 'invoice_count')).toBe(false);
    expect(
      p.operations
        .filter((o) => o.field === 'invoice.number')
        .map((o) => o.value),
    ).toEqual(count === 1 ? ['NEW-1'] : ['NEW-1', 'NEW-2', 'NEW-3']);
    expect(
      p.operations
        .filter((o) => o.field === 'invoice.payment')
        .map((o) => o.value),
    ).toEqual(count === 1 ? ['DP'] : ['DP', 'DA', '']);
    expect(
      p.operations
        .filter((o) => o.field === 'charges.freight')
        .map((o) => o.value),
    ).toEqual(count === 1 ? ['12'] : ['12', '24', '']);
  },
);
test('refuses unknown field names and mismatched exporter IEC', () => {
  const p = mergeShipment(source, {
    context: source.context,
    fields: { 'general.iec': f('999'), 'product.rate': f('1') },
    invoices: [{}],
  });
  expect(p.issues.some((i) => i.code === 'identity')).toBe(true);
  expect(p.issues.some((i) => i.code === 'excluded')).toBe(true);
});
test('explicit blank native-required headers stay blank for the website boundary', () => {
  const p = mergeShipment(source, {
    context: source.context,
    fields: { 'shipment.grossWeight': f('') },
    invoices: [{ 'invoice.number': f(''), 'invoice.date': f('') }],
  });
  for (const key of [
    'shipment.grossWeight',
    'invoice.number',
    'invoice.date',
  ]) {
    expect(p.operations.find((o) => o.field === key)?.value).toBe('');
    expect(p.issues.some((i) => i.field === key && i.blocking)).toBe(false);
  }
});
test('carton range updates preserve copied declarations and refresh total cartons', () => {
  const old =
    'TOTAL 517 CARTONS, (LUT ARN NO. AD090426004649U), WE INTEND TO CLAIM RODTEP.';
  const p = mergeShipment(
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
    'TOTAL 999 CARTONS, (LUT ARN NO. AD090426004649U), WE INTEND TO CLAIM RODTEP.',
  );
});
test('ambiguous inherited marks require review; explicit replacement remains possible', () => {
  const s = {
    ...source,
    fields: {
      ...source.fields,
      'shipment.marks': 'OLD BUYER / CARTONS 10-20 / BOXES 30-40',
    },
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
    mergeShipment(s, shipment).issues.some(
      (i) => i.code === 'marks_review' && i.blocking,
    ),
  ).toBe(true);
  shipment.fields['shipment.marks'] = f('EXPLICIT NEW MARKS', 'default');
  expect(
    mergeShipment(s, shipment).operations.find(
      (o) => o.field === 'shipment.marks',
    )?.value,
  ).toBe('EXPLICIT NEW MARKS');
});

test('mergeShipment catches netWeight > grossWeight on large/formatted decimals and accepts 53.000 in packages', () => {
  const baseShipment = {
    context: source.context,
    fields: {
      'shipment.grossWeight': f('1000000000000000.12345'),
      'shipment.grossUnit': f('KGS'),
      'shipment.netWeight': f('1000000000000000.12346'),
      'shipment.netUnit': f('KGS'),
      'shipment.packingFrom': f('1'),
      'shipment.packingTo': f('53'),
      'shipment.packages': f('53.000'),
    },
    invoices: [{}],
  };
  const patch = mergeShipment(source, baseShipment);
  expect(patch.issues.some((i) => i.code === 'weight')).toBe(true);
  expect(patch.issues.some((i) => i.code === 'packing_count')).toBe(false);
});

test('previous invoice fallback uses ascending numeric-aware invoice order without mutating the reference', () => {
  const previous = {
    ...source,
    invoices: [
      { 'invoice.number': 'OLD-10', 'invoice.payment': 'DA' },
      { 'invoice.number': 'OLD-2', 'invoice.payment': 'DP' },
    ],
  };
  const p = mergeShipment(previous, {
    context: source.context,
    fields: {},
    invoices: [
      { 'invoice.number': f('NEW-1') },
      { 'invoice.number': f('NEW-2') },
    ],
  });
  expect(
    p.operations
      .filter((o) => o.field === 'invoice.payment')
      .map((o) => o.value),
  ).toEqual(['DP', 'DA']);
  expect(previous.invoices[0]['invoice.number']).toBe('OLD-10');
});

test('locked and numbered packing controls cannot bypass the allowlist', () => {
  for (const field of [
    'invoice.exchangeRate',
    'charges.insuranceRate',
    'shipment.packingFrom',
  ])
    expect(
      isAllowed({
        section: field.startsWith('shipment.')
          ? 'shipment'
          : field.startsWith('charges.')
            ? 'charges'
            : 'invoice',
        field,
        action: 'replace',
        value: '1',
        evidence: [],
      }),
    ).toBe(false);
});

test.each(['2026-10-01', '2026-10-02'])(
  'normalized duplicate current invoice numbers block even when second date is %s',
  (date) => {
    const patch = mergeShipment(source, {
      context: source.context,
      fields: {},
      invoices: [
        { 'invoice.number': f('INV 1'), 'invoice.date': f('2026-10-01') },
        { 'invoice.number': f('inv1'), 'invoice.date': f(date) },
      ],
    });
    expect(
      patch.issues.some(
        (i) =>
          i.code === 'duplicate_invoice' &&
          i.blocking &&
          i.field === 'invoice[1].invoice.number',
      ),
    ).toBe(true);
  },
);

test('distinct current invoice numbers and unavailable numbers do not create duplicate identity errors', () => {
  const patch = mergeShipment(source, {
    context: source.context,
    fields: {},
    invoices: [
      { 'invoice.number': f('INV 1') },
      { 'invoice.number': f('INV2') },
      { 'invoice.number': f('') },
      {},
    ],
  });
  expect(patch.issues.some((i) => i.code === 'duplicate_invoice')).toBe(false);
});

const declaration =
  'WE INTEND TO CLAIM REWARDS UNDER THE REMISSION OF DUTIES AND TAXES ON EXPORTED PRODUCTS (RODTEP) SCHEME AS APPLICABLE.';
const marksPatch = (previous: string, fields: Record<string, any>) =>
  mergeShipment(
    { ...source, fields: { ...source.fields, 'shipment.marks': previous } },
    { context: source.context, fields, invoices: [{}] },
  );
test('default marks refresh preserves the exact previous declaration and leading zero', () => {
  const old = `(01 TO 4000 CARTONS), ${declaration}`;
  for (const marks of ['1-1800', undefined]) {
    const patch = marksPatch(old, {
      ...(marks ? { 'shipment.marks': f(marks) } : {}),
      'shipment.packages': f('1800'),
      'shipment.packageUnit': f('CTN'),
    });
    const operation = patch.operations.find(
      (o) => o.field === 'shipment.marks',
    );
    expect(operation?.value).toBe(`(01 TO 1800 CARTONS), ${declaration}`);
    expect(operation?.evidence).toContainEqual({
      file: 'previous-job',
      raw: old,
    });
    expect(operation?.evidence).toContainEqual({
      file: 'a.pdf',
      page: 1,
      raw: '1800',
    });
    expect(patch.issues.some((i) => i.code === 'marks_review')).toBe(false);
  }
});
test.each(['CARTONS', 'CTNS', 'PACKAGES', 'PKGS', 'BOXES'])(
  'total-only marks refresh recognizes %s without rewriting declaration identifiers',
  (unit) => {
    const old = `TOTAL 4000 ${unit}, LUT ARN AD090426004649U DATED 01-04-2026; ${declaration}`;
    const patch = marksPatch(old, {
      'shipment.packages': f('1800'),
      'shipment.packageUnit': f('BOX'),
    });
    expect(
      patch.operations.find((o) => o.field === 'shipment.marks')?.value,
    ).toBe(old.replace('TOTAL 4000', 'TOTAL 1800'));
  },
);
test('range/total disagreement and multiple package ranges require review', () => {
  for (const [old, marks] of [
    ['(01 TO 4000 CARTONS), LUT', '1-1801'],
    ['CARTONS 1-4000 / BOXES 1-20, LUT', '1-1800'],
  ]) {
    const patch = marksPatch(old!, {
      'shipment.marks': f(marks!),
      'shipment.packages': f('1800'),
      'shipment.packageUnit': f('CTN'),
    });
    expect(
      patch.issues.some((i) => i.code === 'marks_review' && i.blocking),
    ).toBe(true);
  }
});
test('package totals do not reinterpret unrelated numbers or explicit blank marks', () => {
  const old = 'LUT ARN AD090426004649U DATED 01-04-2026; BUYER 4000';
  const fields = {
    'shipment.packages': f('1800'),
    'shipment.packageUnit': f('CTN'),
  };
  expect(
    marksPatch(old, fields).operations.find((o) => o.field === 'shipment.marks')
      ?.value,
  ).toBe(old);
  expect(
    marksPatch(old, { ...fields, 'shipment.marks': f('') }).operations.find(
      (o) => o.field === 'shipment.marks',
    )?.value,
  ).toBe('');
});

test('marks updates a coherent total and range together without changing other numbers', () => {
  const old = 'TOTAL 4000 CTN; CTN NOS. 01 TO 4000; LUT ARN 1234000';
  const patch = marksPatch(old, {
    'shipment.packages': f('1800'),
    'shipment.packageUnit': f('PKG'),
  });
  expect(
    patch.operations.find((o) => o.field === 'shipment.marks')?.value,
  ).toBe('TOTAL 1800 CTN; CTN NOS. 01 TO 1800; LUT ARN 1234000');
});
test('pieces do not authorize a package-count rewrite', () => {
  const old = 'TOTAL 4000 CARTONS, LUT ARN 1234000';
  const patch = marksPatch(old, {
    'shipment.packages': f('1800'),
    'shipment.packageUnit': f('PCS'),
  });
  expect(
    patch.operations.find((o) => o.field === 'shipment.marks')?.value,
  ).toBe(old);
});

test.each(['1800 CTNS', 'TOTAL 1800 BOXES', 'PACKAGES 1800'])(
  'count-only current marks %s update inherited range and preserve RODTEP',
  (marks) => {
    const old = `(01 TO 4000 CARTONS), ${declaration}`;
    const patch = marksPatch(old, {
      'shipment.marks': f(marks),
      'shipment.packages': f('1800'),
      'shipment.packageUnit': f('CTN'),
    });
    expect(
      patch.operations.find((o) => o.field === 'shipment.marks')?.value,
    ).toBe(`(01 TO 1800 CARTONS), ${declaration}`);
    expect(patch.issues.some((i) => i.code === 'marks_review')).toBe(false);
  },
);
test('count-only current marks must agree with the package total', () => {
  const old = `(01 TO 4000 CARTONS), ${declaration}`;
  const patch = marksPatch(old, {
    'shipment.marks': f('TOTAL 1801 BOXES'),
    'shipment.packages': f('1800'),
    'shipment.packageUnit': f('CTN'),
  });
  expect(
    patch.issues.some((i) => i.code === 'marks_review' && i.blocking),
  ).toBe(true);
});

test('partial marks instructions retain declarations; only complete instructions or blanks replace them', () => {
  const old = `(01 TO 4000 CARTONS), ${declaration}`;
  for (const marks of ['1-1800', '1800 BOXES']) {
    const patch = marksPatch(old, {
      'shipment.marks': f(marks, 'default'),
      'shipment.packages': f('1800'),
      'shipment.packageUnit': f('CTN'),
    });
    expect(
      patch.operations.find((o) => o.field === 'shipment.marks')?.value,
    ).toBe(`(01 TO 1800 CARTONS), ${declaration}`);
  }
  for (const marks of ['COMPLETE REPLACEMENT DECLARATION', '']) {
    const patch = marksPatch(old, {
      'shipment.marks': f(marks, 'default'),
      'shipment.packages': f('1800'),
      'shipment.packageUnit': f('CTN'),
    });
    expect(
      patch.operations.find((o) => o.field === 'shipment.marks')?.value,
    ).toBe(marks);
  }
});
