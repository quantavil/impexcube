import { z } from 'zod';
import {
  ContextSchema,
  IssueSchema,
  PatchSchema,
  ShipmentSchema,
  SnapshotSchema,
} from '../domain/schemas';
export const RunStateSchema = z.enum([
  'prepared',
  'source_selected',
  'copy_started',
  'target_identified',
  'sections_saved',
  'verified',
  'needs_input',
  'uncertain',
  'superseded',
]);
export const RunRecordSchema = z
  .strictObject({
    runId: z.string().regex(/^[-\w]{1,100}$/),
    state: RunStateSchema,
    productPreservationConfirmedForTarget: z.string().optional(),
    context: ContextSchema,
    inputFolder: z.string(),
    inputHash: z.string(),
    sourceJobNo: z.string(),
    sourceSnapshot: SnapshotSchema,
    shipment: ShipmentSchema,
    patch: PatchSchema,
    reason: z.string(),
    targetJobNo: z.string().nullable(),
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
      r.targetJobNo === r.sourceJobNo ||
      (['target_identified', 'sections_saved', 'verified'].includes(r.state) &&
        !r.targetJobNo)
    )
      invalid(
        'Identified/saved/verified runs require a target distinct from source',
        'targetJobNo',
      );
    for (const c of [r.shipment.context, r.sourceSnapshot.context])
      if (
        c.branch !== r.context.branch ||
        c.financialYear !== r.context.financialYear
      )
        invalid('Run, shipment and source contexts must match', 'context');
    if (r.sourceSnapshot.jobNo !== r.sourceJobNo)
      invalid(
        'Source snapshot must belong to the recorded source',
        'sourceSnapshot',
      );
    if (
      r.state === 'verified' &&
      [...r.issues, ...r.patch.issues].some((i) => i.blocking)
    )
      invalid('Verified runs cannot have blocking issues', 'issues');
  });
export type RunState = z.infer<typeof RunStateSchema>;
export type RunRecord = z.infer<typeof RunRecordSchema>;
