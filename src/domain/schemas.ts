import { z } from 'zod';
export const ContextSchema = z.strictObject({
  branch: z.enum(['DELHI', 'MORADABAD']),
  financialYear: z
    .string()
    .regex(/^\d{4}-\d{4}$/)
    .refine((v) => Number(v.slice(5)) === Number(v.slice(0, 4)) + 1),
});
const position = z.number().int().positive();
export const EvidenceSchema = z.strictObject({
  file: z.string(),
  raw: z.string(),
  page: position.optional(),
  line: position.optional(),
  sheet: z.string().optional(),
  cell: z.string().optional(),
});
export const FieldSchema = z
  .strictObject({
    value: z.string().nullable(),
    status: z.enum([
      'sourced',
      'default',
      'unknown',
      'conflict',
      'explicit_zero',
      'included',
    ]),
    evidence: z.array(EvidenceSchema),
  })
  .superRefine((f, ctx) => {
    if (f.status === 'unknown' && f.value !== null)
      ctx.addIssue({
        code: 'custom',
        message: 'Unknown field must have null value',
        params: { domainCode: 'unknown' },
      });
    if (f.status === 'explicit_zero' && !/^0(?:\.0+)?$/.test(f.value ?? ''))
      ctx.addIssue({
        code: 'custom',
        message: 'Explicit zero must equal zero',
        params: { domainCode: 'zero' },
      });
  });
const fields = z.record(z.string(), FieldSchema);
export const ExtractedProductSchema = z.strictObject({
  invoiceIndex: z.number().int().nonnegative().optional(),
  itemId: z.string().optional(),
  fields: z.record(z.string(), FieldSchema),
});
export const ShipmentSchema = z.strictObject({
  context: ContextSchema,
  fields,
  invoices: z.array(fields),
  products: z.array(ExtractedProductSchema).optional(),
});
export const RoleSchema = z.enum([
  'invoice',
  'packing',
  'instructions',
  'reference',
]);
export const ManifestSchema = z.strictObject({
  shipmentId: z.string().regex(/^[-\w]{1,80}$/),
  context: ContextSchema,
  files: z
    .array(z.strictObject({ path: z.string().min(1), role: RoleSchema }))
    .min(1),
  referenceOnly: z.boolean().default(false),
  productMode: z.string().optional(),
  instructions: z.record(z.string(), z.string()).default({}),
  locale: z.enum(['en-IN', 'en-US', 'de-DE']).optional(),
});
export const DocumentSchema = z.strictObject({
  file: z.string(),
  role: RoleSchema,
  pages: z
    .array(z.strictObject({ page: position, text: z.string() }))
    .optional(),
  cells: z
    .array(
      z.strictObject({ sheet: z.string(), cell: z.string(), raw: z.string() }),
    )
    .optional(),
  reader: z.string().optional(),
  markdown: z.string().optional(),
  lines: z
    .array(z.strictObject({ line: position, text: z.string() }))
    .optional(),
  warnings: z.array(z.string()).optional(),
  visualPages: z.array(position).optional(),
  needsVisual: z.boolean(),
});
export const IssueSchema = z.strictObject({
  code: z.string(),
  field: z.string().optional(),
  message: z.string(),
  blocking: z.boolean(),
});
export const SectionSchema = z.enum([
  'general',
  'shipment',
  'exchange',
  'invoice',
  'charges',
  'thirdParty',
]);
export const OperationSchema = z.strictObject({
  section: SectionSchema,
  field: z.string(),
  action: z.enum(['replace', 'clear', 'carry']),
  value: z.string(),
  invoiceIndex: z.number().int().nonnegative().optional(),
  evidence: z.array(EvidenceSchema),
});
export const PatchSchema = z.strictObject({
  operations: z.array(OperationSchema),
  issues: z.array(IssueSchema),
});
export const SnapshotSchema = z.strictObject({
  context: ContextSchema,
  jobNo: z.string(),
  fields: z.record(z.string(), z.string()),
  invoices: z.array(z.record(z.string(), z.string())),
  productFingerprint: z.string().nullable(),
  packingRanges: z
    .array(
      z.strictObject({
        from: z.string(),
        to: z.string(),
        total: z.string(),
        unit: z.string(),
      }),
    )
    .optional(),
});
export const ProductMaterialSchema = z.strictObject({
  name: z.string(),
  net_per_pc: z.number().nonnegative(),
  total_net: z.number().nonnegative(),
});
export const ProductItemSchema = z.strictObject({
  InvoiceSNo: z.string(),
  ItemSNo: z.string(),
  InvoiceNo: z.string(),
  Description: z.string(),
  EndUse: z.string(),
  HAWBL_NO: z.string().nullable().optional(),
  Total_Package: z.string().nullable().optional(),
  Accessories: z.string().nullable().optional(),
  RewardItem: z.string(),
  IGST_PaymentStatus: z.string(),
  RITCCode: z.string(),
  ApplicableExpSchemes: z.string(),
  Quantity: z.string(),
  QuantityUnit: z.string(),
  SQCQTY: z.string(),
  SQCUnit: z.string(),
  UnitPrice: z.string(),
  ProductAmount: z.string(),
  Per: z.string(),
  PerUnit: z.string(),
  drawback_schno: z.string(),
  dbk_qty: z.string(),
  dbk_rate: z.string(),
  dbk_unit: z.string(),
  dbk_desc: z.string().nullable().optional(),
  ROSLRate: z.string().nullable().optional(),
  ROSLCapValue: z.string().nullable().optional(),
  CountryDestination: z.string(),
  FTACode: z.string(),
  StateOrigin: z.string(),
  DistrictOrigin: z.string(),
  Taxable_Value: z.string(),
  IGST_Rate: z.string(),
  IGST_Amount: z.string(),
  GSTCCessAmount: z.string().nullable().optional(),
  RODTEP: z.string(),
  RoDTEPQty: z.string(),
  _ref_no: z.string().optional(),
  _materials: z.array(ProductMaterialSchema).optional(),
  _net_weight: z.number().optional(),
  _cartons: z.number().optional(),
});
export const ReconciledProductsSchema = z.strictObject({
  invoice_no: z.string(),
  items: z.array(ProductItemSchema),
  total_items: z.number().int().nonnegative(),
  total_quantity: z.number().nonnegative(),
  total_cartons: z.number().int().nonnegative(),
  total_amount: z.number().nonnegative(),
  total_net_weight: z.number().nonnegative(),
});

import { loadConfig } from './config';

const defaultComp = loadConfig().compliance;
export const ProductComplianceSchema = z.strictObject({
  ritc_code: z.string().default(defaultComp.ritc_code || '94038900'),
  sqc_unit: z.string().default(defaultComp.sqc_unit || 'NOS'),
  drawback_schno: z.string().default(defaultComp.drawback_schno || '940399B'),
  dbk_rate: z.string().default(defaultComp.dbk_rate || '1.2'),
  dbk_unit: z.string().default(defaultComp.dbk_unit || 'PCS'),
  scheme: z.string().default(defaultComp.scheme || '19-Drawback (DBK)'),
  end_use: z.string().default(defaultComp.end_use || 'GNX100'),
  payment_status: z.string().default(defaultComp.payment_status || 'LUT'),
  state_origin: z.string().default(defaultComp.state_origin || '09'),
  district_origin: z.string().default(defaultComp.district_origin || '171'),
  country_destination: z
    .string()
    .default(defaultComp.country_destination || 'ES'),
  fta_code: z.string().default(defaultComp.fta_code || 'NCPTI'),
  reward_item: z.string().default(defaultComp.reward_item || 'Yes'),
  rodtep: z.string().default(defaultComp.rodtep || 'Yes'),
  per: z.string().default(defaultComp.per || '1'),
  per_unit: z.string().default(defaultComp.per_unit || 'PCS'),
  quantity_unit: z.string().default(defaultComp.quantity_unit || 'PCS'),
  taxable_value: z.string().default(defaultComp.taxable_value || '0'),
  igst_rate: z.string().default(defaultComp.igst_rate || '0'),
  igst_amount: z.string().default(defaultComp.igst_amount || '0'),
});
