import type { Section } from '../domain/model';
export interface Definition {
  section: Section;
  id: string;
  kind: 'text' | 'select' | 'date' | 'decimal' | 'check' | 'port' | 'packing';
  required?: boolean;
  allowBlank?: boolean;
  reset?: boolean;
  readonly?: boolean;
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
    [string, Definition['kind'], ('required' | 'reset' | 'readonly')?]
  >,
) {
  for (const [name, [id, kind, flag]] of Object.entries(defs))
    FIELDS[`${section}.${name}`] = {
      section,
      id: prefix + id,
      kind,
      ...(flag ? { [flag]: true } : {}),
    };
}
add('general', 'ContentPlaceHolder1_', {
  mode: ['ddlMode', 'select', 'required'],
  customCity: ['ddlcustcity', 'select', 'required'],
  customHouse: ['ddlCustom', 'select', 'required'],
  jobDate: ['txtJobReceivedDate', 'date', 'readonly'],
  sbNumber: ['txtSBNo', 'text'],
  sbDate: ['txtSBDate', 'date'],
  heading: ['txtSBHeading', 'text', 'reset'],
  dockNo: ['txtDockNo', 'text', 'reset'],
});
add('general', 'ContentPlaceHolder1_tbJobCreation_TabPanel5_', {
  exporter: ['txtExporter', 'text', 'readonly'],
  iec: ['lblIECodeNo', 'text', 'readonly'],
  exporterAddress: ['txtAddress', 'text', 'readonly'],
  gst: ['txtGstTRegNo', 'text', 'readonly'],
  category: ['ddlcategory', 'select', 'readonly'],
  class: ['ddlExpType', 'select', 'readonly'],
  adCode: ['txtDealerCode', 'text', 'readonly'],
  iecBranch: ['ddlBranchName', 'select', 'readonly'],
  reference: ['txtExporterRefNo', 'text', 'reset'],
  referenceDate: ['txtRefDate', 'date', 'reset'],
  consignee: ['txtConsigneeName', 'text', 'required'],
  consigneeAddress: ['txtConsigneeAddress', 'text', 'required'],
  consigneeCountry: ['ddlConsigneeCountry', 'select', 'required'],
  buyerDifferent: ['Chkbuyerconginee', 'check', 'required'],
  buyer: ['txtNotify', 'text'],
  buyerAddress: ['txtNotifyAddress', 'text'],
  buyerCountry: ['ddlNotifyCountry', 'select'],
  stateOrigin: ['txtStateofOrigin', 'select'],
  assignedTo: ['txtEmpName', 'text'],
  moowr: ['ddlIEC_MOOWR', 'select'],
});
add('shipment', 'ContentPlaceHolder1_Shipment_TabPanelExch_', {
  destinationCountry: ['ddlDesCountry', 'select', 'required'],
  destinationPort: ['txtportunececodes', 'port', 'required'],
  dischargeCountry: ['ddlDisCountry', 'select', 'required'],
  dischargePort: ['txtportunececode', 'port', 'required'],
  packages: ['txtpkgs1', 'decimal', 'required'],
  packageUnit: ['ddlTotalUnit', 'select', 'required'],
  grossWeight: ['txtGrossWeight1', 'decimal', 'required'],
  grossUnit: ['ddlGrossUnit', 'select', 'required'],
  netWeight: ['txtNetWeight1', 'decimal', 'required'],
  netUnit: ['ddlNetUnit', 'select', 'required'],
  marks: ['txtRemarks', 'text', 'required'],
  marksType: ['ddlFEMAMEIS', 'select'],
  cargoNature: ['ddlNatureofCorgo', 'select'],
  containerCount: ['txtnoofContainer', 'decimal'],
  sealType: ['ddlSealType', 'select'],
  annexure: ['ChkAnnexure', 'check'],
  loosePackages: ['txtLoosePkgs', 'decimal', 'reset'],
  mbl: ['txtMBLNO', 'text', 'reset'],
  mblDate: ['txtMBLDate', 'date', 'reset'],
  hbl: ['txtHBLNo', 'text', 'reset'],
  hblDate: ['txtHBLDate', 'date', 'reset'],
  rotation: ['txtRotationNo', 'text', 'reset'],
  rotationDate: ['TxtRotationDate', 'date', 'reset'],
  sailingDate: ['txtSailingDate', 'date', 'reset'],
  shippingLine: ['txtShippingLine', 'text', 'reset'],
  preCarriage: ['txtPreCarriage', 'text', 'reset'],
  receipt: ['txtPlcereceipt', 'text', 'reset'],
  voyage: ['txtVoyageNo', 'text', 'reset'],
  vesselDate: ['txtVesselDate', 'date', 'reset'],
  cfs: ['txtCFSName', 'text', 'reset'],
  volume: ['txtvolume', 'decimal', 'reset'],
  eta: ['txtETADate', 'date', 'reset'],
  etd: ['txtETDDate', 'date', 'reset'],
  liner: ['txtlinername', 'text', 'reset'],
  cargoReceived: ['txtCargoreceiveddate', 'date', 'reset'],
  customsFormality: ['txtcustomformalitydate', 'date', 'reset'],
  factoryStuffed: ['chkgoodstuff', 'check'],
  sample: ['chkSampleAccom', 'check'],
  factoryAddress: ['txtFactoryAddress', 'text'],
  agency: ['txtAgencyName', 'text', 'reset'],
});
add('invoice', 'ContentPlaceHolder1_tbInvoice_TabPanel1_', {
  number: ['txtInvoiceNo', 'text', 'required'],
  date: ['txtDate', 'date', 'required'],
  currency: ['ddlInvoiceCurrency', 'select', 'required'],
  amount: ['txtProductValues', 'decimal', 'required'],
  terms: ['ddlTermsofInvoice', 'select', 'required'],
  payment: ['ddlPayment', 'select', 'required'],
  period: ['txtperiod', 'text', 'reset'],
  po: ['txtinvpono', 'text', 'reset'],
  poDate: ['txtinvpodt', 'date', 'reset'],
  contract: ['txtExpContNoDt', 'text', 'reset'],
  contractDate: ['txtExpContNoDt1', 'date', 'reset'],
  exchangeRate: ['txtExchange', 'decimal', 'readonly'],
  amountINR: ['txtProductINRValues', 'decimal', 'readonly'],
});
add('charges', 'ContentPlaceHolder1_tbInvoice_TabPanel3_', {
  freight: ['txtfreighamount', 'decimal', 'required'],
  freightCurrency: ['ddlFreight', 'select', 'required'],
  insurance: ['txtinsureamount', 'decimal', 'required'],
  insuranceCurrency: ['ddlInsurace', 'select', 'required'],
  insuranceRate: ['txtinsurerate', 'decimal', 'required'],
  discount: ['txtDiscAmount', 'decimal', 'required'],
  discountCurrency: ['ddlDiscountcurr', 'select', 'required'],
  discountRate: ['txtDiscRate', 'decimal', 'required'],
  commission: ['txtCommAmount', 'decimal', 'required'],
  commissionCurrency: ['ddlCommCurr', 'select', 'required'],
  commissionRate: ['txtCommRate', 'decimal', 'required'],
  deduction: ['txtOthDedAmount', 'decimal', 'required'],
  deductionCurrency: ['ddlOthDedcurr', 'select', 'required'],
  deductionRate: ['txtOthDedRate', 'decimal', 'required'],
  packing: ['txtpackamount', 'decimal', 'required'],
  packingCurrency: ['ddlPackFobCurr', 'select', 'required'],
  unitIncludes: ['ddlUnitprice', 'select', 'required'],
  igstBasis: ['ddlIGSTBasedOn', 'select'],
  pmvBasis: ['ddlpmvbasedon', 'select'],
  taxableLut: ['ddltaxablevalueonlut', 'select'],
  productAmount: ['txtproductamount', 'decimal', 'readonly'],
});
add('thirdParty', 'ContentPlaceHolder1_tbInvoice_TabPanel13_', {
  name: ['txtThirdPartyName', 'text', 'required'],
  address1: ['txtThirdPartyAdd1', 'text', 'required'],
  address2: ['txtThirdPartyAdd2', 'text', 'required'],
  subdivision: ['txtSubDivision', 'text', 'required'],
  city: ['txtThirdPartyCity', 'text', 'required'],
  pin: ['txtPinThirdParty', 'text', 'required'],
  country: ['ddlThirdPartyCode', 'select', 'required'],
  aeoCode: ['txtAuthopercode', 'text', 'reset'],
  aeoCountry: ['txtAuthcountry', 'text', 'reset'],
  aeoRole: ['txtOperRole', 'text', 'reset'],
  termsPlace: ['txttremsplace', 'text', 'reset'],
});

add('shipment', 'ContentPlaceHolder1_Shipment_TabPanelExch_', {
  packingFrom: ['txtpckno_from', 'packing', 'required'],
  packingTo: ['txtpckno_to', 'packing', 'required'],
  packingUnit: ['ddlpackcode', 'packing', 'required'],
});

// Explicitly absent third-party details may be cleared with instruction/evidence.
for (const d of Object.values(FIELDS))
  if (d.section === 'thirdParty') d.allowBlank = true;
