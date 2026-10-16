import { expect, test } from 'bun:test';
import { FIELDS } from '../src/policy/fields';
import { mergeShipment, resolveMasterRequest } from '../src/policy/merge';
import type { Field, Shipment, Snapshot } from '../src/schemas';

const field = (value: string | null): Field => ({
  value,
  status: value === null ? 'unknown' : 'sourced',
  evidence: value === null ? [] : [{ file: 'new.txt', page: 1, raw: value }],
});
const source: Snapshot = {
  context: { branch: 'DELHI', financialYear: '2026-2027' },
  jobNo: 'VIDE-EXP-2627-10',
  fields: { 'general.assignedTo': 'OLD' },
  invoices: [{}],
};

test.each([
  ['general.mode', 'Sea', 'Air', 'Land ICD'],
  ['general.sbNumber', '123', '456', '0'],
  ['general.heading', 'DOCUMENT HEADING', 'OLD HEADING', ''],
  ['shipment.cargoNature', 'Bulk', 'Other', 'C-Containerized Cargo'],
  ['shipment.loosePackages', '4', '3', '0'],
  ['shipment.factoryStuffed', 'true', 'true', 'false'],
  ['invoice.po', 'NEW PO', 'OLD PO', ''],
  ['thirdParty.city', 'NEW CITY', 'OLD CITY', ''],
])(
  'fixed %s overrides current and previous values with a warning',
  (key, current, previous, expected) => {
    const invoice = !key.startsWith('general.') && !key.startsWith('shipment.');
    const currentField = field(current);
    const patch = mergeShipment(
      {
        ...source,
        fields: { [key]: previous },
        invoices: [{ [key]: previous }],
      },
      {
        context: source.context,
        fields: invoice ? {} : { [key]: currentField },
        invoices: [invoice ? { [key]: currentField } : {}],
      },
    );
    expect(patch.operations.find((o) => o.field === key)?.value).toBe(expected);
    expect(
      patch.issues.some(
        (i) => i.field === key && i.code === 'fixed_override' && !i.blocking,
      ),
    ).toBe(true);
    expect(patch.issues.some((i) => i.field === key && i.blocking)).toBe(false);
    expect(currentField.value).toBe(current);
  },
);

test.each([
  'general.iec',
  'general.exporterAddress',
  'general.gst',
  'general.referenceDate',
  'general.stateOrigin',
  'general.assignedTo',
  'general.moowr',
  'shipment.sealType',
  'invoice.exchangeRate',
  'invoice.amountINR',
  'charges.freightCurrency',
  'charges.insuranceRate',
  'charges.discountRate',
  'charges.unitIncludes',
  'charges.igstBasis',
  'thirdParty.country',
])('locked %s is readable and never writable', (key) => {
  const invoice = !key.startsWith('general.') && !key.startsWith('shipment.');
  const patch = mergeShipment(null, {
    context: source.context,
    fields: invoice ? {} : { [key]: field('1') },
    invoices: [invoice ? { [key]: field('1') } : {}],
  });
  expect(FIELDS[key]?.source).toBe('site');
  expect(patch.operations.some((o) => o.field === key)).toBe(false);
});

test.each([
  ['general.consignee', ''],
  ['general.buyerDifferent', 'false'],
  ['shipment.grossWeight', ''],
  ['invoice.number', ''],
  ['invoice.amount', ''],
  ['invoice.payment', ''],
  ['charges.freight', ''],
])(
  'missing %s writes an empty value and warns without blocking',
  (key, expected) => {
    const invoice = !key.startsWith('general.') && !key.startsWith('shipment.');
    const patch = mergeShipment(null, {
      context: source.context,
      fields: invoice ? {} : { [key]: field(null) },
      invoices: [invoice ? { [key]: field(null) } : {}],
    });
    expect(patch.operations.find((o) => o.field === key)?.value).toBe(expected);
    expect(
      patch.issues.some(
        (i) => i.field === key && i.code === 'missing' && !i.blocking,
      ),
    ).toBe(true);
    expect(patch.issues.some((i) => i.field === key && i.blocking)).toBe(false);
  },
);

test.each(['shipment.grossUnit', 'shipment.netUnit'])(
  '%s defaults unavailable values to KGS without inheriting previous units',
  (key) => {
    for (const current of [
      undefined,
      field(null),
      { ...field(null), status: 'sourced' as const },
    ]) {
      const patch = mergeShipment(
        { ...source, fields: { [key]: 'LBS' } },
        {
          context: source.context,
          fields: current ? { [key]: current } : {},
          invoices: [{}],
        },
      );
      expect(patch.operations.find((o) => o.field === key)?.value).toBe('KGS');
      expect(
        patch.issues.some(
          (i) => i.field === key && i.message.includes('left empty'),
        ),
      ).toBe(false);
      expect(patch.issues.some((i) => i.field === key && i.blocking)).toBe(
        false,
      );
      expect(patch.issues.find((i) => i.field === key)).toMatchObject({
        code: 'missing_default',
        message: 'No available value; defaulted to KGS',
        blocking: false,
      });
    }
  },
);

test.each(['shipment.grossUnit', 'shipment.netUnit'])(
  '%s preserves explicitly supplied units and blanks instead of defaulting',
  (key) => {
    for (const current of ['LBS', '']) {
      const patch = mergeShipment(null, {
        context: source.context,
        fields: { [key]: field(current) },
        invoices: [{}],
      });
      const operation = patch.operations.find((o) => o.field === key);
      expect(operation?.value).toBe(current);
      expect(operation?.evidence).toEqual(field(current).evidence);
      expect(patch.issues.some((i) => i.field === key)).toBe(false);
    }
  },
);

test('document-only missing values ignore previous values', () => {
  const patch = mergeShipment(
    {
      ...source,
      fields: { 'general.consignee': 'OLD' },
      invoices: [{ 'charges.discount': '5' }],
    },
    {
      context: source.context,
      fields: { 'general.consignee': field(null) },
      invoices: [{}],
    },
  );
  expect(
    patch.operations.find((o) => o.field === 'general.consignee')?.value,
  ).toBe('');
  expect(
    patch.operations.find((o) => o.field === 'charges.discount')?.value,
  ).toBe('');
});

test('shipment.annexure falls back to previous job value when current is unknown', () => {
  const patch = mergeShipment(
    {
      ...source,
      fields: { 'shipment.annexure': 'true' },
    },
    {
      context: source.context,
      fields: { 'shipment.annexure': field(null) },
      invoices: [{}],
    },
  );
  expect(
    patch.operations.find((o) => o.field === 'shipment.annexure')?.value,
  ).toBe('true');
});

test('conditional buyer fields are omitted when the resolved checkbox is false', () => {
  const patch = mergeShipment(source, {
    context: source.context,
    fields: {
      'general.buyerDifferent': field('false'),
      'general.buyer': field('NEW BUYER'),
    },
    invoices: [{}],
  });
  expect(
    patch.operations.find((o) => o.field === 'general.buyerDifferent')?.value,
  ).toBe('false');
  expect(patch.operations.some((o) => o.field === 'general.buyer')).toBe(false);
});

test('marks merge uses the policy-selected package total and its evidence', () => {
  const definition = FIELDS['shipment.packages']!;
  const previous = definition.source;
  try {
    definition.source = 'new_or_old';
    const patch = mergeShipment(
      {
        ...source,
        fields: {
          'shipment.packages': '10',
          'shipment.marks': 'TOTAL 10 CARTONS, LUT DECLARATION',
        },
      },
      {
        context: source.context,
        fields: {
          'shipment.packages': field('20'),
          'shipment.packageUnit': field('CTN'),
          'shipment.marks': field('1-20'),
          'shipment.packingFrom': field('1'),
          'shipment.packingTo': field('20'),
          'shipment.packingUnit': field('CTN'),
        },
        invoices: [{}],
      },
    );
    const marks = patch.operations.find((o) => o.field === 'shipment.marks');
    expect(marks?.value).toBe('TOTAL 20 CARTONS, LUT DECLARATION');
    expect(marks?.evidence).toContainEqual({
      file: 'new.txt',
      page: 1,
      raw: '20',
    });
    expect(patch.issues.some((i) => i.code === 'packing_count')).toBe(false);
  } finally {
    definition.source = previous;
  }
});

test('absent Third Party clears copied Notify Party fields while preserving previous charges', () => {
  const patch = mergeShipment(
    {
      ...source,
      invoices: [
        { 'thirdParty.name': 'PREVIOUS NOTIFY PARTY', 'charges.freight': '12' },
      ],
    },
    { context: source.context, fields: {}, invoices: [{}] },
  );
  expect(
    patch.operations.find((o) => o.field === 'thirdParty.name')?.value,
  ).toBe('');
  expect(
    patch.issues.some((i) => i.field?.startsWith('thirdParty.') && i.blocking),
  ).toBe(false);
  expect(
    patch.operations.find((o) => o.field === 'charges.freight')?.value,
  ).toBe('12');
});

test.each([
  ['DAP', 'CIF'],
  ['CFR', 'CF'],
  ['EXW (EX-WORK)', 'FOB'],
  ['CIF', 'CIF'],
  ['FOB', 'FOB'],
  ['CI', 'CI'],
  [' dap ', 'CIF'],
])(
  'invoice term %s maps to site group %s while keeping original evidence',
  (term, expected) => {
    const original = field(term);
    const patch = mergeShipment(source, {
      context: source.context,
      fields: {},
      invoices: [{ 'invoice.terms': original }],
    });
    const operation = patch.operations.find((o) => o.field === 'invoice.terms');
    expect(operation?.value).toBe(expected);
    expect(operation?.evidence).toEqual(original.evidence);
    expect(original.value).toBe(term);
  },
);

test.each([
  ['invoice.payment', 'DA', 'DP', 'DA'],
  ['invoice.payment', null, 'DP', 'DP'],
  ['invoice.period', '30', '60', '30'],
  ['invoice.period', null, '60', '60'],
])(
  '%s prefers current values then previous values',
  (key, current, previous, expected) => {
    const invoice = key.startsWith('invoice.');
    const patch = mergeShipment(
      {
        ...source,
        fields: { [key]: previous },
        invoices: [{ [key]: previous }],
      },
      {
        context: source.context,
        fields: invoice ? {} : { [key]: field(current) },
        invoices: [invoice ? { [key]: field(current) } : {}],
      },
    );
    expect(patch.operations.find((o) => o.field === key)?.value).toBe(expected);
  },
);

test.each([
  ['DAP', 'FOB', 'CIF'],
  [null, 'CFR', 'CF'],
])(
  'invoice terms prefer current %s then previous %s before grouping',
  (current, previous, expected) => {
    const patch = mergeShipment(
      { ...source, invoices: [{ 'invoice.terms': previous }] },
      {
        context: source.context,
        fields: {},
        invoices: [{ 'invoice.terms': field(current) }],
      },
    );
    expect(
      patch.operations.find((o) => o.field === 'invoice.terms')?.value,
    ).toBe(expected);
  },
);

test('invoice terms are empty when current and previous terms are absent', () => {
  const patch = mergeShipment(null, {
    context: source.context,
    fields: {},
    invoices: [{}],
  });
  expect(
    patch.issues.some((i) => i.field === 'invoice.terms' && i.blocking),
  ).toBe(false);
  expect(patch.operations.find((o) => o.field === 'invoice.terms')?.value).toBe(
    '',
  );
});

test.each([['charges.freight'], ['charges.insurance']])(
  '%s prefers current, then previous, then an empty string',
  (key) => {
    for (const [current, previous, expected] of [
      ['7', '12', '7'],
      [null, '12', '12'],
      [null, '', ''],
      ['0', '12', '0'],
      ['', '12', ''],
    ] as const) {
      const patch = mergeShipment(
        { ...source, invoices: [{ [key]: previous }] },
        {
          context: source.context,
          fields: {},
          invoices: [{ [key]: field(current) }],
        },
      );
      expect(patch.operations.find((o) => o.field === key)?.value).toBe(
        expected,
      );
      expect(patch.issues.some((i) => i.field === key && i.blocking)).toBe(
        false,
      );
    }
  },
);

test('a new draft leaves unstated commercial headers empty and omits unnumbered packing rows', () => {
  const patch = mergeShipment(null, {
    context: source.context,
    fields: {
      'shipment.packages': field('465'),
      'shipment.packageUnit': field('CTN'),
      'shipment.packingUnit': field('CTN'),
    },
    invoices: [{}],
  });
  for (const key of [
    'invoice.terms',
    'invoice.payment',
    'shipment.destinationPort',
    'shipment.dischargePort',
    'shipment.marks',
  ]) {
    expect(patch.operations.find((o) => o.field === key)?.value).toBe('');
    expect(patch.issues.some((i) => i.field === key && i.blocking)).toBe(false);
  }
  expect(
    patch.operations.some((o) => FIELDS[o.field]?.kind === 'packing'),
  ).toBe(false);
  expect(
    patch.operations.find((o) => o.field === 'shipment.marksType')?.value,
  ).toBe('');
  expect(
    patch.issues.some((i) => i.field === 'invoice.amount' && i.blocking),
  ).toBe(false);
});

test('final packing verification rejects an old numbered range after inputs omit numbering', async () => {
  const { validateSavedPacking } = await import('../src/policy/fields');
  const snapshot = {
    ...source,
    fields: { 'shipment.packages': '200', 'shipment.packageUnit': 'CTN' },
    packingRanges: [{ from: '1', to: '100', total: '100', unit: 'CTN' }],
  };
  expect(validateSavedPacking(snapshot).some((i) => i.blocking)).toBe(true);
  expect(validateSavedPacking({ ...snapshot, packingRanges: [] })).toEqual([]);
});

test('native empty charge representations never turn unknown inputs into nonzero charges', async () => {
  const { matchesNativeEmpty } = await import('../src/policy/fields');
  expect(matchesNativeEmpty('charges.insurance', '', '0.00')).toBe(true);
  expect(matchesNativeEmpty('charges.insurance', '', '12.00')).toBe(false);
  expect(matchesNativeEmpty('charges.insuranceCurrency', '', 'GBP')).toBe(
    false,
  );
  expect(matchesNativeEmpty('charges.insurance', '7', '0.00')).toBe(false);
  expect(matchesNativeEmpty('shipment.grossWeight', '', '0.00')).toBe(false);
});

test('a fixed field with conflicting document sources still uses policy without blocking', () => {
  const patch = mergeShipment(source, {
    context: source.context,
    fields: { 'general.mode': { ...field('Sea'), status: 'conflict' } },
    invoices: [{}],
  });
  expect(patch.operations.find((o) => o.field === 'general.mode')?.value).toBe(
    'Land ICD',
  );
  expect(
    patch.issues.some((i) => i.field === 'general.mode' && i.blocking),
  ).toBe(false);
});

test('a locked job date does not impose a document-date requirement', async () => {
  const { applyPreflightChecks } = await import('../src/policy/fields');
  const shipment: Shipment = {
    context: source.context,
    fields: { 'general.jobDate': field('2020-01-01') },
    invoices: [{}],
  };
  const patch = mergeShipment(source, shipment);
  applyPreflightChecks(patch, shipment);
  expect(patch.issues.some((i) => i.code === 'job_date')).toBe(false);
  expect(patch.operations.some((o) => o.field === 'general.jobDate')).toBe(
    false,
  );
});

test('uninspected auxiliary controls remain explicit nonblocking limitations', () => {
  const patch = mergeShipment(source, {
    context: source.context,
    fields: { 'general.filingMode': field('Online') },
    invoices: [{}],
  });
  expect(patch.operations.some((o) => o.field === 'general.filingMode')).toBe(
    false,
  );
  expect(
    patch.issues.some((i) => i.code === 'unsupported_fields' && !i.blocking),
  ).toBe(true);
  expect(
    patch.issues.some((i) => i.field === 'general.filingMode' && i.blocking),
  ).toBe(false);
});

test('empty marks scheme remains literal empty for missing and explicit blank values', () => {
  for (const current of [null, '']) {
    const patch = mergeShipment(null, {
      context: source.context,
      fields: { 'shipment.marksType': field(current) },
      invoices: [{}],
    });
    expect(
      patch.operations.find((o) => o.field === 'shipment.marksType')?.value,
    ).toBe('');
  }
});

test('a fixed field with unresolved null conflict sources still warns without blocking', () => {
  const patch = mergeShipment(null, {
    context: source.context,
    fields: { 'general.mode': { ...field(null), status: 'conflict' } },
    invoices: [{}],
  });
  expect(patch.operations.find((o) => o.field === 'general.mode')?.value).toBe(
    'Land ICD',
  );
  expect(
    patch.issues.some(
      (i) =>
        i.field === 'general.mode' &&
        i.code === 'fixed_override' &&
        !i.blocking,
    ),
  ).toBe(true);
  expect(
    patch.issues.some((i) => i.field === 'general.mode' && i.blocking),
  ).toBe(false);
});

test('master request resolves missing identity selection from previous without changing shipment evidence', () => {
  const previous: Snapshot = {
    ...source,
    fields: { 'general.exporter': 'OLD EXPORTER', 'general.iecBranch': '2' },
  };
  const current: Shipment = {
    context: source.context,
    fields: {
      'general.exporter': field('CURRENT EXPORTER'),
      'general.iecBranch': field(null),
    },
    invoices: [{}],
  };
  const request = resolveMasterRequest(previous, current);
  expect(request.fields['general.exporter']).toEqual(
    current.fields['general.exporter'],
  );
  expect(request.fields['general.iecBranch']).toEqual({
    value: '2',
    status: 'default',
    evidence: [{ file: 'previous-job', raw: '2' }],
  });
  expect(current.fields['general.iecBranch']).toEqual({
    value: null,
    status: 'unknown',
    evidence: [],
  });
  expect(request).not.toBe(current);
  expect(request.fields['general.exporter']).not.toBe(
    current.fields['general.exporter'],
  );
});

test('conflicts in recognized unsupported fixed and locked fields remain nonblocking limitations', () => {
  const patch = mergeShipment(source, {
    context: source.context,
    fields: {
      'general.filingMode': { ...field(null), status: 'conflict' },
      'general.chaNo': { ...field(null), status: 'conflict' },
    },
    invoices: [{ 'invoice.finalInv': { ...field(null), status: 'conflict' } }],
  });
  expect(patch.issues.some((i) => i.blocking && i.code === 'conflict')).toBe(
    false,
  );
  expect(
    patch.issues.some((i) => i.code === 'unsupported_fields' && !i.blocking),
  ).toBe(true);
});

test('preflight accepts one shipment currency independently of reference rates', async () => {
  const { applyPreflightChecks } = await import('../src/policy/fields');
  const shipment: Shipment = {
    context: source.context,
    fields: {},
    invoices: [{ 'invoice.currency': field('EUR') }],
  };
  const patch = mergeShipment(source, shipment);
  applyPreflightChecks(patch, shipment);
  expect(patch.issues.some((i) => i.code === 'currency')).toBe(false);
});

test('preflight still requires manual handling for multiple shipment currencies', async () => {
  const { applyPreflightChecks } = await import('../src/policy/fields');
  const shipment: Shipment = {
    context: source.context,
    fields: {},
    invoices: [
      { 'invoice.currency': field('EUR') },
      { 'invoice.currency': field('USD') },
    ],
  };
  const patch = mergeShipment(source, shipment);
  applyPreflightChecks(patch, shipment);
  expect(patch.issues.some((i) => i.code === 'currency' && i.blocking)).toBe(
    true,
  );
});
