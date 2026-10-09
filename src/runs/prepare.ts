import { basename, resolve } from 'node:path';
import { previewCopy } from '../browser/copy';
import { resolveCustomsCity } from '../browser/customs';
import { discoverCandidates } from '../browser/discover';
import { readSnapshot } from '../browser/read';
import type { BrowserSession } from '../browser/session';
import { ensureContext } from '../browser/session';
import { canonicalizePatch } from '../browser/write';
import { readDocuments } from '../documents/extract';
import { ingestExtraction } from '../documents/handoff';
import { issue, type Manifest, type Shipment } from '../domain/model';
import { normalizeDate } from '../domain/validate';
import {
  customsHouseFromFolder,
  loadInput,
  safeInputPath,
} from '../inputs/load';
import { buildPatch } from '../policy/patch';
import { selectSource } from '../policy/select';
import { fingerprint, type Journal, type RunRecord } from './journal';
export async function hashInputs(
  folder: string,
  manifest: Manifest,
): Promise<string> {
  const chunks = [];
  for (const name of [
    'manifest.json',
    'extracted.json',
    ...manifest.files.map((f) => f.path),
  ]) {
    const file =
      name === 'manifest.json' || name === 'extracted.json'
        ? resolve(folder, name)
        : await safeInputPath(folder, name);
    chunks.push([
      name,
      Bun.CryptoHasher.hash(
        'sha256',
        await Bun.file(file).arrayBuffer(),
        'hex',
      ),
    ]);
  }
  const house = customsHouseFromFolder(folder);
  if (house)
    chunks.push(
      ['folder-customs-house', house],
      ['resolved-context', JSON.stringify(manifest.context)],
    );
  return fingerprint(chunks);
}
export async function loadShipment(
  folder: string,
): Promise<{ manifest: Manifest; shipment: Shipment }> {
  const { manifest, shipment: raw } = await loadInput(folder);
  if (!raw)
    throw new Error(
      'Missing extracted.json. Run extract and complete the AI handoff first.',
    );
  const house = customsHouseFromFolder(folder);
  if (!house)
    throw new Error(
      'Name the shipment folder <customs-code>_<number>, for example INMBD6_001',
    );
  const docs = await readDocuments(manifest, folder);
  const shipment = ingestExtraction(raw, docs, {
    ...manifest.instructions,
    'general.customHouse': house,
  });
  shipment.fields['general.customHouse']!.evidence = [
    { file: 'folder-name', raw: basename(resolve(folder)) },
  ];
  if (
    shipment.context.branch !== manifest.context.branch ||
    shipment.context.financialYear !== manifest.context.financialYear
  )
    throw new Error('Extracted context differs from manifest');
  return { manifest, shipment };
}
export interface PrepareOptions {
  fresh?: boolean;
}
export async function prepareRun(
  folder: string,
  s: BrowserSession,
  journal: Journal,
  options?: PrepareOptions,
): Promise<RunRecord> {
  const { manifest, shipment } = await loadShipment(folder);
  if (manifest.referenceOnly)
    throw new Error('Completed reference examples cannot create new jobs');
  const inputHash = await hashInputs(folder, manifest),
    runId =
      manifest.context.branch +
      '-' +
      manifest.context.financialYear +
      '-' +
      manifest.shipmentId;
  if (options?.fresh && (await journal.exists(runId))) {
    console.log(
      `Archiving previous run ${runId} to generate a fresh target job...`,
    );
    await journal.archive(runId);
  }
  if (await journal.exists(runId)) {
    const old = await journal.load(runId);
    if (
      old.targetJobNo ||
      ['copy_started', 'uncertain', 'sections_saved', 'verified'].includes(
        old.state,
      )
    ) {
      if (old.inputHash !== inputHash) {
        if (old.targetJobNo) {
          console.log(
            `Inputs changed for existing draft ${old.targetJobNo}. Updating target draft...`,
          );
          const house = shipment.fields['general.customHouse']!.value!;
          const city = await resolveCustomsCity(s, old.sourceJobNo, house);
          shipment.fields['general.customCity'] = {
            value: city,
            status: 'default',
            evidence: [
              ...shipment.fields['general.customHouse']!.evidence,
              { file: 'website-customs-master', raw: house + '=' + city },
            ],
          };
          let patch = buildPatch(old.sourceSnapshot, shipment);
          if (!patch.issues.some((i) => i.blocking))
            patch = await canonicalizePatch(s, old.sourceJobNo, patch);
          old.shipment = shipment;
          old.patch = patch;
          old.issues = [...patch.issues];
          old.inputHash = inputHash;
          old.savedSections = [];
          await journal.transition(
            old,
            'target_identified',
            `Revised inputs for existing draft ${old.targetJobNo}`,
          );
          return old;
        }
        throw new Error(
          'Inputs changed after a copy attempt without an identified target. Resume the existing target or resolve target before revising.',
        );
      }
      return old;
    }
  }
  await journal.assertNoDuplicate(runId, shipment);
  await ensureContext(s, manifest.context);
  const candidates = await discoverCandidates(s, shipment);
  let selected = selectSource(candidates, shipment, manifest.sourceJobNo);
  if (Array.isArray(selected))
    throw new Error(selected.map((i) => i.message).join('; '));
  if (selected.source.context.financialYear !== manifest.context.financialYear)
    throw new Error(
      'Previous-year source found; cross-year copy is not yet verified. Use the site to resolve this case.',
    );
  let sourceSnapshot = await readSnapshot(s, selected.source.jobNo);
  if (
    !manifest.sourceJobNo &&
    sourceSnapshot.invoices.length !== shipment.invoices.length
  ) {
    for (const c of candidates) {
      if (c.jobNo === selected.source.jobNo) continue;
      const snap = await readSnapshot(s, c.jobNo);
      if (snap.invoices.length === shipment.invoices.length) {
        selected = {
          source: c,
          reason: 'exporter_fallback',
        };
        sourceSnapshot = snap;
        break;
      }
    }
  }
  const house = shipment.fields['general.customHouse']!.value!;
  const city = await resolveCustomsCity(s, selected.source.jobNo, house);
  shipment.fields['general.customCity'] = {
    value: city,
    status: 'default',
    evidence: [
      ...shipment.fields['general.customHouse']!.evidence,
      { file: 'website-customs-master', raw: house + '=' + city },
    ],
  };
  let patch = buildPatch(sourceSnapshot, shipment);
  if (!patch.issues.some((i) => i.blocking))
    patch = await canonicalizePatch(s, selected.source.jobNo, patch);
  const expectedRates = await previewCopy(s, selected.source.jobNo);
  const requestedMode = patch.operations.find(
    (o) => o.field === 'general.mode',
  )?.value;
  if (requestedMode && requestedMode !== sourceSnapshot.fields['general.mode'])
    patch.issues.push(
      issue(
        'mode',
        'Changing copied shipment mode is unverified; resolve source compatibility first',
      ),
    );
  for (const inv of shipment.invoices) {
    const currency = inv['invoice.currency']?.value;
    if (currency && !expectedRates[currency])
      patch.issues.push(
        issue(
          'currency',
          'New currency is not present in the source copy-rate preview',
        ),
      );
  }
  const desiredDate = shipment.fields['general.jobDate']?.value;
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  if (desiredDate && normalizeDate(desiredDate) !== today)
    patch.issues.push(
      issue(
        'job_date',
        'Site auto-generates job date; a different date requires manual resolution',
      ),
    );
  const record: RunRecord = {
    runId,
    state: 'prepared',
    context: manifest.context,
    inputFolder: resolve(folder),
    inputHash,
    sourceJobNo: selected.source.jobNo,
    sourceSnapshot,
    shipment,
    patch,
    reason: selected.reason,
    targetJobNo: null,
    expectedRates,
    savedSections: [],
    issues: patch.issues,
    transitions: [],
  };
  await journal.transition(
    record,
    patch.issues.some((i) => i.blocking) ? 'needs_input' : 'prepared',
  );
  return record;
}
