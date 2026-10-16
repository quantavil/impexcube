import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { extractionInstructions, ingestExtraction } from './documents/evidence';
import {
  customsHouseFromFolder,
  discoverInput,
  readDocuments,
} from './documents/read';
import { fingerprint, type Journal } from './journal';
import { applyPreflightChecks, FIELDS } from './policy/fields';
import { mergeShipment, resolveMasterRequest } from './policy/merge';
import { selectSource } from './policy/select';
import {
  type Context,
  type Field,
  FinalArtifactSchema,
  type Input,
  type Issue,
  issue,
  type RunRecord,
  type Shipment,
  ShipmentArtifactSchema,
  SnapshotSchema,
} from './schemas';
import { normalizeName } from './values';
import { previewNewJob } from './website/create';
import { canonicalizePatch } from './website/fill';
import {
  discoverCandidates,
  readSnapshot,
  resolveCustomsCity,
} from './website/read';
import {
  type BrowserSession,
  ensureContext,
  selectSessionControl,
} from './website/session';
import { verifyIdentity } from './website/verify';

// Include executable rules as well as the field table; function-only edits must invalidate drafts.
export function policyFingerprint(): string {
  return fingerprint(
    [
      './policy/fields.ts',
      './policy/merge.ts',
      './policy/select.ts',
      './values.ts',
      './documents/evidence.ts',
    ].map((path) => readFileSync(new URL(path, import.meta.url), 'utf8')),
  );
}

function sameDocuments(input: Input, files: Input['files']): boolean {
  return (
    input.files.length === files.length &&
    input.files.every((f) =>
      files.some((old) => old.path === f.path && old.hash === f.hash),
    )
  );
}
export async function extractShipment(
  folder: string,
  context: Context,
  journal: Journal,
) {
  const input = await discoverInput(folder, context);
  const path = join(journal.runFolder(input.runId), 'shipment.json');
  const documents = await readDocuments(input.files, input.folder);
  if (await Bun.file(path).exists()) {
    const existing = ShipmentArtifactSchema.parse(await Bun.file(path).json());
    if (existing.inputFolder !== input.folder)
      throw new Error('Run identifier belongs to another input folder');
    return {
      input,
      documents,
      instructions: extractionInstructions(),
      artifactPath: path,
    };
  }
  const unknown = (): Field => ({
    value: null,
    status: 'unknown',
    evidence: [],
  });
  const artifact = ShipmentArtifactSchema.parse({
    formatVersion: 1,
    inputFolder: input.folder,
    files: input.files,
    referenceOnly: false,
    instructions: {},
    shipment: {
      context,
      fields: Object.fromEntries(
        Object.entries(FIELDS)
          .filter(([, d]) => ['general', 'shipment'].includes(d.section))
          .map(([k]) => [k, unknown()]),
      ),
      invoices: [],
    },
  });
  await journal.writeArtifact(input.runId, 'shipment.json', artifact);
  return {
    input,
    documents,
    instructions: extractionInstructions(),
    artifactPath: path,
  };
}
export async function readShipmentInput(
  folder: string,
  context: Context,
  journal: Journal,
) {
  const input = await discoverInput(folder, context);
  const file = Bun.file(join(journal.runFolder(input.runId), 'shipment.json'));
  if (!(await file.exists()))
    throw new Error(
      'Shipment interpretation is missing. Ask the assisting AI to extract this folder and complete its internal shipment.json.',
    );
  const artifact = ShipmentArtifactSchema.parse(await file.json());
  if (artifact.referenceOnly)
    throw new Error(
      'Completed reference examples cannot create or update jobs',
    );
  if (
    artifact.inputFolder !== input.folder ||
    artifact.shipment.context.branch !== context.branch ||
    artifact.shipment.context.financialYear !== context.financialYear
  )
    throw new Error('Shipment artifact folder/context differs');
  if (!sameDocuments(input, artifact.files))
    throw new Error(
      'Shipment documents changed. The assisting AI must review them and update evidence and document fingerprints before running.',
    );
  return {
    input,
    artifact,
    inputHash: fingerprint({ files: input.files, artifact }),
  };
}
export async function loadShipment(
  folder: string,
  context: Context,
  journal: Journal,
  metadata?: Awaited<ReturnType<typeof readShipmentInput>>,
): Promise<{ input: Input; shipment: Shipment; inputHash: string }> {
  const { input, artifact, inputHash } =
    metadata ?? (await readShipmentInput(folder, context, journal));
  const docs = await readDocuments(artifact.files, input.folder);
  const shipment = ingestExtraction(
    artifact.shipment,
    docs,
    artifact.instructions,
  );
  if (!shipment.invoices.length)
    throw new Error(
      'No current invoices extracted; the assisting AI must identify the shipment invoices before website work.',
    );
  const house = customsHouseFromFolder(input.folder)!;
  shipment.fields['general.customHouse'] = {
    value: house,
    status: 'default',
    evidence: [{ file: 'folder-name', raw: basename(input.folder) }],
  };
  return {
    input,
    shipment,
    inputHash,
  };
}
export async function hashInputs(
  folder: string,
  context: Context,
  journal: Journal,
): Promise<string> {
  return (await readShipmentInput(folder, context, journal)).inputHash;
}
async function saveFinal(record: RunRecord, journal: Journal): Promise<void> {
  await journal.writeArtifact(
    record.runId,
    'previous.json',
    SnapshotSchema.nullable().parse(record.sourceSnapshot),
  );
  await journal.writeArtifact(
    record.runId,
    'final.json',
    FinalArtifactSchema.parse({
      formatVersion: 1,
      context: record.context,
      sourceJobNo: record.sourceJobNo,
      exporterMaster: record.exporterMaster,
      invoiceCount: record.shipment.invoices.length,
      inputHash: record.inputHash,
      policyHash: record.policyHash,
      operations: record.patch.operations,
      issues: record.patch.issues,
    }),
  );
}
export async function prepareRun(
  folder: string,
  context: Context,
  s: BrowserSession,
  journal: Journal,
  readOnly = false,
  loaded?: Awaited<ReturnType<typeof loadShipment>>,
): Promise<RunRecord> {
  const { input, shipment, inputHash } =
    loaded ?? (await loadShipment(folder, context, journal));
  const policyHash = policyFingerprint();
  let old = (await journal.exists(input.runId))
    ? await journal.load(input.runId)
    : null;
  if (old && old.inputFolder !== input.folder)
    throw new Error(
      'Run identifier already belongs to another shipment folder',
    );
  if (
    old &&
    normalizeName(
      old.exporterMaster['general.exporter'] ??
        old.shipment.fields['general.exporter']?.value ??
        '',
    ) !== normalizeName(shipment.fields['general.exporter']?.value ?? '')
  ) {
    old = null;
  }
  if (old && old.inputHash === inputHash && old.policyHash === policyHash)
    return old;
  if (
    old &&
    !old.targetJobNo &&
    ['creation_started', 'uncertain'].includes(old.state)
  )
    throw new Error(
      'Resolve uncertain target creation before changing inputs or policy',
    );
  if (old?.pendingInvoice)
    throw new Error(
      'Reconcile the uncertain Invoice Add before changing inputs or policy',
    );
  await journal.assertNoDuplicate(input.runId, shipment);
  await ensureContext(s, context);
  let sourceSnapshot = old?.sourceSnapshot ?? null,
    reason = old?.reason ?? 'new_exporter';
  if (!old) {
    const selection = selectSource(
      await discoverCandidates(s, shipment),
      shipment,
    );
    if (Array.isArray(selection)) {
      if (selection.some((i) => i.code !== 'no_source'))
        throw new Error(selection.map((i) => i.message).join('; '));
    } else {
      sourceSnapshot = await readSnapshot(s, selection.source.jobNo);
      reason = selection.reason;
    }
  }
  // Always resolve a registered master on an unsaved New Job; previous headers are reference data only.
  const exporterMaster = await previewNewJob(
    s,
    resolveMasterRequest(sourceSnapshot, shipment),
  );
  if (old && verifyIdentity(exporterMaster, old.exporterMaster).length)
    throw new Error(
      'An existing target cannot change exporter master identity',
    );
  const mode = FIELDS['general.mode']!;
  await selectSessionControl(s, s.page.locator('#' + mode.id), mode.value!);
  const house = shipment.fields['general.customHouse']!;
  const city = await resolveCustomsCity(s, null, house.value!);
  shipment.fields['general.customCity'] = {
    value: city,
    status: 'default',
    evidence: [
      ...house.evidence,
      { file: 'website-customs-master', raw: house.value + '=' + city },
    ],
  };
  let patch = mergeShipment(sourceSnapshot, shipment, exporterMaster);
  applyPreflightChecks(patch, shipment);
  if (!patch.issues.some((i) => i.blocking))
    patch = await canonicalizePatch(s, null, patch);
  const record: RunRecord = {
    workflowVersion: 1,
    runId: input.runId,
    state: old?.targetJobNo ? 'target_identified' : 'prepared',
    context,
    inputFolder: input.folder,
    inputHash,
    policyHash,
    sourceJobNo: sourceSnapshot?.jobNo ?? null,
    sourceSnapshot,
    exporterMaster,
    shipment,
    patch,
    reason,
    targetJobNo: old?.targetJobNo ?? null,
    pendingInvoice: null,
    expectedRates: old?.expectedRates ?? {},
    savedSections: [],
    issues: [...patch.issues],
    transitions: old?.transitions ?? [],
  };
  await saveFinal(record, journal);
  if (readOnly) return record;
  await journal.transition(
    record,
    patch.issues.some((i) => i.blocking) ? 'needs_input' : record.state,
    old
      ? 'Re-merge current shipment on recorded target'
      : 'Prepare native New Job',
  );
  return record;
}
export interface RunReport {
  status: 'verified' | 'partial' | 'needs_input' | 'uncertain';
  runId: string;
  sourceJobNo: string | null;
  targetJobNo: string | null;
  issues: Issue[];
}
export interface ExecutionOps {
  create(): Promise<string>;
  save(): Promise<void>;
  verify(): Promise<Issue[]>;
}
export function reportFor(r: RunRecord): RunReport {
  return {
    status:
      r.state === 'verified'
        ? 'verified'
        : ['creation_started', 'uncertain'].includes(r.state)
          ? 'uncertain'
          : r.targetJobNo
            ? 'partial'
            : 'needs_input',
    runId: r.runId,
    sourceJobNo: r.sourceJobNo,
    targetJobNo: r.targetJobNo,
    issues: r.issues,
  };
}
export async function executeRun(
  record: RunRecord,
  journal: Journal,
  ops: ExecutionOps,
): Promise<RunReport> {
  if (record.state === 'verified') return reportFor(record);
  if (record.patch.issues.some((i) => i.blocking)) {
    record.issues = [...record.patch.issues];
    await journal.transition(record, 'needs_input');
    return reportFor(record);
  }
  if (
    !record.targetJobNo &&
    ['creation_started', 'uncertain'].includes(record.state)
  ) {
    record.issues = [
      ...record.patch.issues,
      issue(
        'uncertain_creation',
        'Identify the exact created target before resuming; creation will not be repeated.',
      ),
    ];
    await journal.transition(record, 'uncertain');
    return reportFor(record);
  }
  try {
    if (!record.targetJobNo) {
      try {
        await journal.assertNoDuplicate(record.runId, record.shipment);
      } catch (error) {
        record.issues = [
          ...record.patch.issues,
          issue(
            'duplicate',
            error instanceof Error ? error.message : 'Duplicate check failed',
          ),
        ];
        await journal.transition(record, 'needs_input');
        return reportFor(record);
      }
      if (record.state === 'needs_input')
        await journal.transition(
          record,
          'prepared',
          'Retry pre-creation checks; no creation intent was recorded',
        );
      const target = await ops.create();
      if (target === record.sourceJobNo)
        throw new Error('Source cannot be target');
      if (
        record.targetJobNo !== target ||
        record.state !== 'target_identified'
      ) {
        record.targetJobNo = target;
        await journal.transition(record, 'target_identified');
      }
    }
    await ops.save();
    await saveFinal(record, journal);
    await journal.transition(record, 'sections_saved');
    record.issues = [...record.patch.issues, ...(await ops.verify())];
    await journal.transition(
      record,
      record.issues.some((i) => i.blocking) ? 'needs_input' : 'verified',
    );
  } catch (error) {
    record.issues = [
      ...record.patch.issues,
      issue(
        'operation_failed',
        error instanceof Error ? error.message : String(error),
      ),
    ];
    await journal.transition(
      record,
      record.targetJobNo || record.state === 'creation_started'
        ? 'uncertain'
        : 'needs_input',
    );
  }
  return reportFor(record);
}
