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
export const ShipmentSchema = z.strictObject({
  context: ContextSchema,
  fields,
  invoices: z.array(fields),
});
export const RoleSchema = z.enum([
  'invoice',
  'packing',
  'instructions',
  'reference',
  'document',
]);
export const InputFileSchema = z.strictObject({
  path: z.string().min(1),
  role: RoleSchema,
  hash: z.string().regex(/^[a-f0-9]{64}$/),
});
export const InputSchema = z.strictObject({
  folder: z.string(),
  runId: z.string().regex(/^[-\w]{1,100}$/),
  context: ContextSchema,
  files: z.array(InputFileSchema).min(1),
});
export const InstructionsSchema = z.record(
  z
    .string()
    .regex(
      /^(?:(?:general|shipment)\.\w+|invoice\[\d+\]\.(?:invoice|charges|thirdParty)\.\w+)$/,
    ),
  z.string(),
);
export const ShipmentArtifactSchema = z.strictObject({
  formatVersion: z.literal(1),
  inputFolder: z.string(),
  files: z.array(InputFileSchema).min(1),
  referenceOnly: z.boolean(),
  instructions: InstructionsSchema,
  shipment: ShipmentSchema,
});
export const DocumentSchema = z.strictObject({
  file: z.string(),
  role: RoleSchema,
  pages: z
    .array(z.strictObject({ page: position, text: z.string() }))
    .optional(),
  reader: z.string().optional(),
  markdown: z.string().optional(),
  lines: z
    .array(z.strictObject({ line: position, text: z.string() }))
    .optional(),
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

export type Context = z.infer<typeof ContextSchema>;
export type Field = z.infer<typeof FieldSchema>;
export type Shipment = z.infer<typeof ShipmentSchema>;
export type InputFile = z.infer<typeof InputFileSchema>;
export type Input = z.infer<typeof InputSchema>;
export type Issue = z.infer<typeof IssueSchema>;
export type Snapshot = z.infer<typeof SnapshotSchema>;
export type Operation = z.infer<typeof OperationSchema>;
export type Patch = z.infer<typeof PatchSchema>;
export type DocumentText = z.infer<typeof DocumentSchema>;
export type Section = z.infer<typeof SectionSchema>;
export interface Candidate {
  jobNo: string;
  jobDate: string;
  context: Context;
  exporterName: string;
  iec: string | null;
  consigneeName: string;
  cancelled: boolean;
}
export interface Selection {
  source: Candidate;
  reason: 'same_consignee' | 'exporter_fallback';
}
export const issue = (
  code: string,
  message: string,
  field?: string,
  blocking = true,
): Issue => ({ code, message, field, blocking });

export const RunStateSchema = z.enum([
  'prepared',
  'creation_started',
  'target_identified',
  'sections_saved',
  'verified',
  'needs_input',
  'uncertain',
]);
export const RunRecordSchema = z
  .strictObject({
    workflowVersion: z.literal(1),
    runId: z.string().regex(/^[-\w]{1,100}$/),
    state: RunStateSchema,
    context: ContextSchema,
    inputFolder: z.string(),
    inputHash: z.string(),
    policyHash: z.string(),
    sourceJobNo: z.string().nullable(),
    sourceSnapshot: SnapshotSchema.nullable(),
    exporterMaster: z.record(z.string(), z.string()),
    shipment: ShipmentSchema,
    patch: PatchSchema,
    reason: z.string(),
    targetJobNo: z.string().nullable(),
    pendingInvoice: z
      .strictObject({
        index: z.number().int().nonnegative(),
        number: z.string(),
        date: z.string(),
      })
      .nullable(),
    expectedRates: z.record(z.string(), z.string()),
    savedSections: z.array(z.string()),
    issues: z.array(IssueSchema),
    transitions: z.array(
      z.strictObject({
        state: RunStateSchema,
        at: z.string(),
        intent: z.string().optional(),
      }),
    ),
  })
  .superRefine((r, ctx) => {
    const invalid = (message: string, path: string) =>
      ctx.addIssue({ code: 'custom', message, path: [path] });
    if (
      (r.targetJobNo !== null && r.targetJobNo === r.sourceJobNo) ||
      (['target_identified', 'sections_saved', 'verified'].includes(r.state) &&
        !r.targetJobNo)
    )
      invalid(
        'Identified/saved/verified runs require a target distinct from source',
        'targetJobNo',
      );
    for (const c of [
      r.shipment.context,
      ...(r.sourceSnapshot ? [r.sourceSnapshot.context] : []),
    ])
      if (
        c.branch !== r.context.branch ||
        c.financialYear !== r.context.financialYear
      )
        invalid('Run, shipment and source contexts must match', 'context');
    if ((r.sourceSnapshot?.jobNo ?? null) !== r.sourceJobNo)
      invalid(
        'Source snapshot must belong to the recorded source',
        'sourceSnapshot',
      );
    if (r.pendingInvoice && !r.targetJobNo)
      invalid('Invoice creation requires a recorded target', 'pendingInvoice');
    if (
      !r.exporterMaster['general.iec'] ||
      !r.exporterMaster['general.exporter']
    )
      invalid(
        'A new job requires a resolved exporter master',
        'exporterMaster',
      );
    if (
      r.state === 'verified' &&
      [...r.issues, ...r.patch.issues].some((i) => i.blocking)
    )
      invalid('Verified runs cannot have blocking issues', 'issues');
  });
export type RunState = z.infer<typeof RunStateSchema>;
export type RunRecord = z.infer<typeof RunRecordSchema>;

export const FinalArtifactSchema = z.strictObject({
  formatVersion: z.literal(1),
  context: ContextSchema,
  sourceJobNo: z.string().nullable(),
  exporterMaster: z.record(z.string(), z.string()),
  invoiceCount: z.number().int().nonnegative(),
  inputHash: z.string(),
  policyHash: z.string(),
  operations: z.array(OperationSchema),
  issues: z.array(IssueSchema),
});
