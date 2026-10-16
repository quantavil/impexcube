import {
  type Field,
  type Issue,
  issue,
  type Operation,
  type Patch,
  type Section,
  type Shipment,
  type Snapshot,
} from '../schemas';
import { compareDecimals } from '../values';
// Field source policy lives here, beside the inspected control mapping.
// Explicit new blanks/zeroes are values; unknown/null means unavailable.
export type SourceRule =
  | 'new'
  | 'new_or_old'
  | 'fixed'
  | 'site'
  | 'derived'
  | 'none';
export interface Definition {
  section: Section;
  id: string;
  kind: 'text' | 'select' | 'date' | 'decimal' | 'check' | 'port' | 'packing';
  source: SourceRule;
  readonly?: boolean;
  // Fixed value, or fallback when a current/previous source is unavailable.
  value?: string;
  identity?: 'exact' | 'normalized';
  transform?: 'marks';
  aliases?: Record<string, string>;
  emptySavedAs?: 'zero';
  when?: { field: string; value: string };
}
// Section boundaries come from inspected website controls and the draft workflow.
export const MANUAL_SECTIONS = [
  'Product and its sub-tabs',
  'IceGate',
  'Dummy Job Info',
  'Job Status',
  'e-Sansit',
  'Container Details',
  'Document uploads',
  'Checklist approval and filing',
] as const;
export const FIELDS: Record<string, Definition> = {};
function add(
  section: Section,
  prefix: string,
  defs: Record<
    string,
    [
      string,
      Definition['kind'],
      SourceRule,
      Partial<Omit<Definition, 'section' | 'id' | 'kind' | 'source'>>?,
    ]
  >,
) {
  for (const [name, [id, kind, source, options]] of Object.entries(defs))
    FIELDS[`${section}.${name}`] = {
      section,
      id: prefix + id,
      kind,
      source,
      ...options,
    };
}
add('general', 'ContentPlaceHolder1_', {
  mode: ['ddlMode', 'select', 'fixed', { value: 'Land ICD' }],
  customCity: ['ddlcustcity', 'select', 'derived'],
  customHouse: ['ddlCustom', 'select', 'derived'],
  jobDate: ['txtJobReceivedDate', 'date', 'site', { readonly: true }],
  sbNumber: ['txtSBNo', 'text', 'fixed', { value: '0' }],
  sbDate: ['txtSBDate', 'date', 'fixed', { value: '' }],
  heading: ['txtSBHeading', 'text', 'fixed', { value: '' }],
  dockNo: ['txtDockNo', 'text', 'fixed', { value: '' }],
});
add('general', 'ContentPlaceHolder1_tbJobCreation_TabPanel5_', {
  exporter: [
    'txtExporter',
    'text',
    'new_or_old',
    { readonly: true, identity: 'normalized' },
  ],
  iec: ['lblIECodeNo', 'text', 'site', { readonly: true, identity: 'exact' }],
  exporterAddress: [
    'txtAddress',
    'text',
    'site',
    { readonly: true, identity: 'normalized' },
  ],
  gst: [
    'txtGstTRegNo',
    'text',
    'site',
    { readonly: true, identity: 'normalized' },
  ],
  category: ['ddlcategory', 'select', 'site', { readonly: true }],
  class: ['ddlExpType', 'select', 'site', { readonly: true }],
  adCode: [
    'txtDealerCode',
    'text',
    'site',
    { readonly: true, identity: 'normalized' },
  ],
  iecBranch: [
    'ddlBranchName',
    'select',
    'new_or_old',
    { readonly: true, identity: 'exact' },
  ],
  reference: ['txtExporterRefNo', 'text', 'new'],
  referenceDate: ['txtRefDate', 'date', 'site', { readonly: true }],
  consignee: ['txtConsigneeName', 'text', 'new'],
  consigneeAddress: ['txtConsigneeAddress', 'text', 'new'],
  consigneeCountry: ['ddlConsigneeCountry', 'select', 'new'],
  buyerDifferent: ['Chkbuyerconginee', 'check', 'new'],
  buyer: [
    'txtNotify',
    'text',
    'new',
    { when: { field: 'general.buyerDifferent', value: 'true' } },
  ],
  buyerAddress: [
    'txtNotifyAddress',
    'text',
    'new',
    { when: { field: 'general.buyerDifferent', value: 'true' } },
  ],
  buyerCountry: [
    'ddlNotifyCountry',
    'select',
    'new',
    { when: { field: 'general.buyerDifferent', value: 'true' } },
  ],
  stateOrigin: ['txtStateofOrigin', 'select', 'site', { readonly: true }],
  assignedTo: ['txtEmpName', 'text', 'site', { readonly: true }],
  moowr: ['ddlIEC_MOOWR', 'select', 'site', { readonly: true }],
});
add('shipment', 'ContentPlaceHolder1_Shipment_TabPanelExch_', {
  destinationCountry: ['ddlDesCountry', 'select', 'new_or_old'],
  destinationPort: ['txtportunececodes', 'port', 'new_or_old'],
  dischargeCountry: ['ddlDisCountry', 'select', 'new_or_old'],
  dischargePort: ['txtportunececode', 'port', 'new_or_old'],
  packages: ['txtpkgs1', 'decimal', 'new'],
  packageUnit: ['ddlTotalUnit', 'select', 'new'],
  grossWeight: ['txtGrossWeight1', 'decimal', 'new'],
  grossUnit: ['ddlGrossUnit', 'select', 'new', { value: 'KGS' }],
  netWeight: ['txtNetWeight1', 'decimal', 'new'],
  netUnit: ['ddlNetUnit', 'select', 'new', { value: 'KGS' }],
  marks: ['txtRemarks', 'text', 'new_or_old', { transform: 'marks' }],
  marksType: ['ddlFEMAMEIS', 'select', 'new_or_old'],
  cargoNature: [
    'ddlNatureofCorgo',
    'select',
    'fixed',
    { value: 'C-Containerized Cargo' },
  ],
  containerCount: ['txtnoofContainer', 'decimal', 'new_or_old'],
  sealType: ['ddlSealType', 'select', 'site', { readonly: true }],
  annexure: ['ChkAnnexure', 'check', 'site', { readonly: true }],
  loosePackages: ['txtLoosePkgs', 'decimal', 'fixed', { value: '0' }],
  mbl: ['txtMBLNO', 'text', 'fixed', { value: '' }],
  mblDate: ['txtMBLDate', 'date', 'fixed', { value: '' }],
  hbl: ['txtHBLNo', 'text', 'fixed', { value: '' }],
  hblDate: ['txtHBLDate', 'date', 'fixed', { value: '' }],
  rotation: ['txtRotationNo', 'text', 'fixed', { value: '' }],
  rotationDate: ['TxtRotationDate', 'date', 'fixed', { value: '' }],
  sailingDate: ['txtSailingDate', 'date', 'fixed', { value: '' }],
  shippingLine: ['txtShippingLine', 'text', 'fixed', { value: '' }],
  preCarriage: ['txtPreCarriage', 'text', 'fixed', { value: '' }],
  receipt: ['txtPlcereceipt', 'text', 'fixed', { value: '' }],
  voyage: ['txtVoyageNo', 'text', 'fixed', { value: '' }],
  vesselDate: ['txtVesselDate', 'date', 'fixed', { value: '' }],
  cfs: ['txtCFSName', 'text', 'fixed', { value: '' }],
  volume: ['txtvolume', 'decimal', 'fixed', { value: '' }],
  eta: ['txtETADate', 'date', 'fixed', { value: '' }],
  etd: ['txtETDDate', 'date', 'fixed', { value: '' }],
  liner: ['txtlinername', 'text', 'fixed', { value: '' }],
  cargoReceived: ['txtCargoreceiveddate', 'date', 'fixed', { value: '' }],
  customsFormality: ['txtcustomformalitydate', 'date', 'fixed', { value: '' }],
  factoryStuffed: ['chkgoodstuff', 'check', 'fixed', { value: 'false' }],
  sample: ['chkSampleAccom', 'check', 'fixed', { value: 'false' }],
  factoryAddress: ['txtFactoryAddress', 'text', 'fixed', { value: '' }],
  agency: ['txtAgencyName', 'text', 'fixed', { value: '' }],
});
add('invoice', 'ContentPlaceHolder1_tbInvoice_TabPanel1_', {
  number: ['txtInvoiceNo', 'text', 'new'],
  date: ['txtDate', 'date', 'new'],
  currency: ['ddlInvoiceCurrency', 'select', 'new'],
  amount: ['txtProductValues', 'decimal', 'new'],
  terms: [
    'ddlTermsofInvoice',
    'select',
    'new_or_old',
    {
      aliases: {
        CPT: 'CIF',
        CIP: 'CIF',
        DAP: 'CIF',
        DPU: 'CIF',
        DDP: 'CIF',
        CFR: 'CF',
        EXW: 'FOB',
        'EXW (EX-WORK)': 'FOB',
        'EX-WORK': 'FOB',
        FCA: 'FOB',
        FAS: 'FOB',
      },
    },
  ],
  payment: ['ddlPayment', 'select', 'new_or_old'],
  period: ['txtperiod', 'text', 'new_or_old'],
  po: ['txtinvpono', 'text', 'fixed', { value: '' }],
  poDate: ['txtinvpodt', 'date', 'fixed', { value: '' }],
  contract: ['txtExpContNoDt', 'text', 'fixed', { value: '' }],
  contractDate: ['txtExpContNoDt1', 'date', 'fixed', { value: '' }],
  exchangeRate: ['txtExchange', 'decimal', 'site', { readonly: true }],
  amountINR: ['txtProductINRValues', 'decimal', 'site', { readonly: true }],
});
add('charges', 'ContentPlaceHolder1_tbInvoice_TabPanel3_', {
  freight: ['txtfreighamount', 'decimal', 'new_or_old'],
  freightCurrency: ['ddlFreight', 'select', 'site', { readonly: true }],
  insurance: ['txtinsureamount', 'decimal', 'new_or_old'],
  insuranceCurrency: ['ddlInsurace', 'select', 'site', { readonly: true }],
  insuranceRate: ['txtinsurerate', 'decimal', 'site', { readonly: true }],
  discount: ['txtDiscAmount', 'decimal', 'new'],
  discountCurrency: ['ddlDiscountcurr', 'select', 'site', { readonly: true }],
  discountRate: ['txtDiscRate', 'decimal', 'site', { readonly: true }],
  commission: ['txtCommAmount', 'decimal', 'new'],
  commissionCurrency: ['ddlCommCurr', 'select', 'site', { readonly: true }],
  commissionRate: ['txtCommRate', 'decimal', 'site', { readonly: true }],
  deduction: ['txtOthDedAmount', 'decimal', 'new'],
  deductionCurrency: ['ddlOthDedcurr', 'select', 'site', { readonly: true }],
  deductionRate: ['txtOthDedRate', 'decimal', 'site', { readonly: true }],
  packing: ['txtpackamount', 'decimal', 'new'],
  packingCurrency: ['ddlPackFobCurr', 'select', 'site', { readonly: true }],
  unitIncludes: ['ddlUnitprice', 'select', 'site', { readonly: true }],
  igstBasis: ['ddlIGSTBasedOn', 'select', 'site', { readonly: true }],
  pmvBasis: ['ddlpmvbasedon', 'select', 'site', { readonly: true }],
  taxableLut: ['ddltaxablevalueonlut', 'select', 'site', { readonly: true }],
});
add('thirdParty', 'ContentPlaceHolder1_tbInvoice_TabPanel13_', {
  name: ['txtThirdPartyName', 'text', 'new'],
  address1: ['txtThirdPartyAdd1', 'text', 'new'],
  address2: ['txtThirdPartyAdd2', 'text', 'new'],
  subdivision: ['txtSubDivision', 'text', 'fixed', { value: '' }],
  city: ['txtThirdPartyCity', 'text', 'fixed', { value: '' }],
  pin: ['txtPinThirdParty', 'text', 'fixed', { value: '' }],
  country: ['ddlThirdPartyCode', 'select', 'site', { readonly: true }],
  aeoCode: ['txtAuthopercode', 'text', 'fixed', { value: '' }],
  aeoCountry: ['txtAuthcountry', 'text', 'fixed', { value: '' }],
  aeoRole: ['txtOperRole', 'text', 'fixed', { value: '' }],
  termsPlace: ['txttremsplace', 'text', 'fixed', { value: '' }],
});

add('shipment', 'ContentPlaceHolder1_Shipment_TabPanelExch_', {
  packingFrom: ['txtpckno_from', 'packing', 'fixed', { value: '' }],
  packingTo: ['txtpckno_to', 'packing', 'fixed', { value: '' }],
  packingUnit: ['ddlpackcode', 'packing', 'fixed', { value: '' }],
});

// Native charge Save represents policy's literal empty amounts as zero.
for (const d of Object.values(FIELDS)) {
  if (d.section === 'charges' && d.kind === 'decimal' && d.source !== 'site')
    d.emptySavedAs = 'zero';
}
// No inspected native control mapping exists for these specification fields.
// Keep this limitation explicit rather than guessing selector IDs.
export const UNSUPPORTED_FIELDS = [
  'shipment.flightNo',
  'shipment.flightDate',
  'general.chaNo',
  'general.filingMode',
  'general.sbType',
  'general.epzCode',
  'general.rbiWaiver',
  'invoice.finalInv',
] as const;

// Header business rules stay beside the field policies, not in browser routing.
export function mergeMarks(
  previous: string,
  value: string,
  fields: Record<string, Field>,
  allowCompleteReplacement = false,
): string | Issue {
  // Only labeled package counts/ranges are replaceable; declaration identifiers
  // and dates are deliberately outside these patterns.
  const label =
    '(?:CARTONS?|CTNS?|PACKAGES?|PKGS?|BOX(?:ES)?|CASES?|BAGS?|BALES?|PALLETS?)';
  const range = /^(\d+)\s*(?:[-–]|TO)\s*(\d+)$/i.exec(value.trim());
  const countOnly = new RegExp(
    `^(?:TOTAL\\s+)?(?:(\\d+)\\s+${label}|${label}\\s+(\\d+))$`,
    'i',
  ).exec(value.trim());
  const currentCount = countOnly?.[1] ?? countOnly?.[2];
  const partial = Boolean(range || countOnly);
  if (value === '') return value;
  const inherited = value === previous;
  if (!partial && !inherited) {
    if (
      !allowCompleteReplacement &&
      /LUT|RODTEP/i.test(previous) &&
      !/LUT|RODTEP/i.test(value)
    )
      return issue(
        'marks_review',
        'Document marks omit inherited declarations; provide reviewed complete marks as an instruction',
        'shipment.marks',
      );
    return value;
  }
  const review = () =>
    issue(
      'marks_review',
      'Package marks are ambiguous or disagree with the current total; provide complete marks as an instruction',
      'shipment.marks',
    );
  const rawTotal = fields['shipment.packages']?.value?.trim() ?? '';
  const packageTotal = rawTotal.replace(/\.0+$/, '');
  const total = packageTotal || currentCount || '';
  const unit =
    fields['shipment.packageUnit']?.value?.trim().toUpperCase() ?? '';
  if (unit && !new RegExp(`^${label}$`, 'i').test(unit))
    return partial ? review() : previous;
  if (total && (!/^\d+$/.test(total) || BigInt(total) <= 0n)) return review();
  if (
    currentCount &&
    packageTotal &&
    BigInt(currentCount) !== BigInt(packageTotal)
  )
    return review();
  if (!partial && !total) return previous;
  if (
    range &&
    (BigInt(range[2]!) < BigInt(range[1]!) ||
      (total && BigInt(range[2]!) - BigInt(range[1]!) + 1n !== BigInt(total)))
  )
    return review();
  const ranges = [
    ...previous.matchAll(
      new RegExp(
        `\\b(?:(?<prefix>${label}\\s+(?:NOS?\\.?\\s*)?)(?<from1>\\d+)(?<separator1>\\s*(?:[-–]|TO)\\s*)(?<to1>\\d+)|(?<from2>\\d+)(?<separator2>\\s*(?:[-–]|TO)\\s*)(?<to2>\\d+)(?<suffix>\\s+${label}))\\b`,
        'gi',
      ),
    ),
  ];
  const totals = [
    ...previous.matchAll(
      new RegExp(`\\bTOTAL\\s+(?<count>\\d+)(?<suffix>\\s+${label})\\b`, 'gi'),
    ),
  ];
  if (ranges.length > 1 || totals.length > 1) return review();
  if (!ranges.length && !totals.length) return partial ? review() : previous;
  const count =
    total ||
    (range ? (BigInt(range[2]!) - BigInt(range[1]!) + 1n).toString() : '');
  const replacements: { index: number; length: number; text: string }[] = [];
  if (ranges[0]) {
    const match = ranges[0];
    const groups = match.groups!;
    const from = groups.from1 ?? groups.from2!;
    const to = groups.to1 ?? groups.to2!;
    if (BigInt(to) < BigInt(from)) return review();
    if (
      totals[0] &&
      BigInt(totals[0].groups!.count!) !== BigInt(to) - BigInt(from) + 1n
    )
      return review();
    const nextFrom = range
      ? BigInt(range[1]!).toString().padStart(from.length, '0')
      : from;
    const nextTo = range
      ? BigInt(range[2]!).toString()
      : (BigInt(from) + BigInt(count) - 1n).toString();
    replacements.push({
      index: match.index!,
      length: match[0].length,
      text: `${groups.prefix ?? ''}${nextFrom}${groups.separator1 ?? groups.separator2}${nextTo.padStart(to.length > nextTo.length && /^0/.test(to) ? to.length : 0, '0')}${groups.suffix ?? ''}`,
    });
  }
  if (totals[0]) {
    const match = totals[0];
    replacements.push({
      index: match.index!,
      length: match[0].length,
      text: match[0].replace(/\d+/, count),
    });
  }
  let merged = previous;
  for (const replacement of replacements.sort((a, b) => b.index - a.index))
    merged =
      merged.slice(0, replacement.index) +
      replacement.text +
      merged.slice(replacement.index + replacement.length);
  return merged;
}

export function validateHeaderRules(
  source: Snapshot | null,
  shipment: Shipment,
  operations: Operation[],
): Issue[] {
  const issues: Issue[] = [];
  const s = {
    ...shipment,
    fields: Object.fromEntries(
      operations
        .filter((o) => o.invoiceIndex === undefined)
        .map((o) => [o.field, { value: o.value }]),
    ),
  };
  if (source && source.context.branch !== s.context.branch)
    issues.push(
      issue('context', 'Previous reference belongs to a different branch'),
    );
  if (!s.invoices.length)
    issues.push(
      issue(
        'invoice_count',
        'Current shipment must contain at least one invoice',
      ),
    );
  const gross = s.fields['shipment.grossWeight']?.value,
    net = s.fields['shipment.netWeight']?.value;
  if (
    gross &&
    net &&
    s.fields['shipment.grossUnit']?.value ===
      s.fields['shipment.netUnit']?.value
  ) {
    try {
      if (compareDecimals(net, gross) > 0)
        issues.push(issue('weight', 'Net weight exceeds gross weight'));
    } catch {}
  }
  return issues;
}

export function applyPreflightChecks(patch: Patch, shipment: Shipment): void {
  if (
    new Set(
      shipment.invoices
        .map((i) => i['invoice.currency']?.value)
        .filter(Boolean),
    ).size > 1
  )
    patch.issues.push(
      issue(
        'currency',
        'Multiple currencies require manual handling before job creation',
      ),
    );
}

/** Native New Job must retain no numbered packing rows. */
export function validateSavedPacking(snapshot: Snapshot): Issue[] {
  return snapshot.packingRanges?.length
    ? [issue('packing_range', 'Saved numbered packing rows must remain absent')]
    : [];
}

/** Native F&I Save encodes empty writable charge amounts as zero. */
export function matchesNativeEmpty(
  field: string,
  expected: string,
  actual: string,
): boolean {
  const d = FIELDS[field];
  if (expected.trim() !== '') return false;
  const zero = (s: string) => /^0+(?:\.0+)?$/.test(s.trim());
  return d?.emptySavedAs === 'zero' && zero(actual);
}
