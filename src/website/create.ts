import type { Journal, RunRecord } from '../journal';
import { FIELDS } from '../policy/fields';
import { resolveMasterRequest } from '../policy/merge';
import type { Shipment } from '../schemas';
import { normalizeName } from '../values';
import { assertSaveAccepted, writeControl } from './fill';
import { readFields } from './read';
import type { BrowserSession } from './session';
import {
  assertSession,
  BASE_URL,
  postback,
  selectSessionControl,
} from './session';
import { identityFor, verifyIdentity } from './verify';

export const NEW_JOB_URL = BASE_URL + 'frmExportJobCreation.aspx?Mode=NewJob';

/** Unsaved native form only. Never registers or edits an exporter master. */
export async function previewNewJob(
  s: BrowserSession,
  shipment: Shipment,
): Promise<Record<string, string>> {
  await s.page.goto(NEW_JOB_URL);
  await assertSession(s);
  if ((await s.page.locator('#ContentPlaceHolder1_txtjno').inputValue()).trim())
    throw new Error('New Job form unexpectedly contains an existing job');
  const name = shipment.fields['general.exporter']?.value?.trim();
  if (!name)
    throw new Error('Exporter name is required to resolve the site master');
  const exporter = s.page.locator('#' + FIELDS['general.exporter']!.id);
  const branch = s.page.locator('#' + FIELDS['general.iecBranch']!.id);
  const readBranchOptions = async () =>
    await branch.locator('option').evaluateAll((es) =>
      es
        .map((e) => ({
          value: (e as HTMLOptionElement).value,
          label: e.textContent?.trim() ?? '',
        }))
        .filter((o) => o.value),
    );

  const nameVariations = [
    name,
    name.replace(/\b([A-Z])([A-Z])\b/g, '$1 $2'),
    name.replace(/\b([A-Z])\s+([A-Z])\b/g, '$1$2'),
    name.replace(/\b([A-Z])([A-Z])\b/g, '$1. $2.'),
    name.replace(/\b([A-Z])([A-Z])\b/g, '$1.$2.'),
  ].filter(
    (v, idx, arr) =>
      normalizeName(v) === normalizeName(name) && arr.indexOf(v) === idx,
  );

  let options: { value: string; label: string }[] = [];
  for (const candidateName of nameVariations) {
    await postback(s, async () => {
      await exporter.fill(candidateName);
      await exporter.blur();
    });
    options = await readBranchOptions();
    if (options.length > 0) break;
  }
  const requested = shipment.fields['general.iecBranch']?.value;
  const candidates = requested
    ? options.filter((o) => o.value === requested || o.label === requested)
    : options;
  if (!candidates.length)
    throw new Error(
      'Exporter/branch absent from site master; register or resolve the exporter master before creating a job',
    );
  const matches: Record<string, string>[] = [];
  for (const option of candidates) {
    await selectSessionControl(s, branch, option.value);
    await assertSession(s);
    const fields = await readFields(s, 'general');
    const iec = shipment.fields['general.iec']?.value,
      gst = shipment.fields['general.gst']?.value;
    if (
      fields['general.iec'] &&
      (!iec || fields['general.iec'] === iec) &&
      (!gst || fields['general.gst'] === gst) &&
      normalizeName(fields['general.exporter'] ?? '') === normalizeName(name)
    )
      matches.push(fields);
  }
  if (matches.length !== 1)
    throw new Error(
      'Exporter master identity/branch is missing or ambiguous; supply matching IEC/GST and an explicit general.iecBranch',
    );
  await selectSessionControl(s, branch, matches[0]!['general.iecBranch']!);
  return matches[0]!;
}

export async function createNewJob(
  s: BrowserSession,
  record: RunRecord,
  journal: Journal,
): Promise<string> {
  if (
    s.context.branch !== record.context.branch ||
    s.context.financialYear !== record.context.financialYear
  )
    throw new Error('Record/session context differs');
  if (
    record.state !== 'prepared' ||
    record.targetJobNo ||
    !record.exporterMaster['general.iec'] ||
    !record.exporterMaster['general.exporter'] ||
    record.patch.issues.some((i) => i.blocking)
  )
    throw new Error(
      'Native New Job requires a prepared run and resolved exporter master; never repeat uncertain creation',
    );
  const current = new URL(s.page.url());
  const preparedForm =
    current.origin + '/' === BASE_URL &&
    current.pathname === '/frmExportJobCreation.aspx' &&
    current.searchParams.get('Mode') === 'NewJob';
  let master: Record<string, string>;
  if (preparedForm) {
    await assertSession(s);
    if (
      (await s.page.locator('#ContentPlaceHolder1_txtjno').inputValue()).trim()
    )
      throw new Error(
        'Prepared New Job form already contains a target; inspect before creating',
      );
    master = await readFields(s, 'general');
  } else {
    master = await previewNewJob(
      s,
      resolveMasterRequest(record.sourceSnapshot, record.shipment),
    );
  }
  if (verifyIdentity(master, identityFor(record)).length)
    throw new Error('Exporter master changed since preparation');
  for (const operation of record.patch.operations.filter(
    (o) => o.section === 'general',
  )) {
    await assertSession(s);
    if (
      (await s.page.locator('#ContentPlaceHolder1_txtjno').inputValue()).trim()
    )
      throw new Error('New Job form acquired a target before creation');
    await writeControl(s, operation);
  }
  if (
    verifyIdentity(await readFields(s, 'general'), identityFor(record)).length
  )
    throw new Error('Exporter master changed while preparing new job');
  await assertSession(s);
  await journal.transition(
    record,
    'creation_started',
    'Save native New Job once',
  );
  await postback(s, () =>
    s.page
      .locator('#ContentPlaceHolder1_tbJobCreation_TabPanel5_btnsave')
      .click(),
  );
  await assertSaveAccepted(s, 'native New Job');
  const target = extractGeneratedTarget(
    await s.page.locator('#ContentPlaceHolder1_txtjno').inputValue(),
    record.sourceJobNo ?? '',
  );
  record.targetJobNo = target;
  await journal.transition(
    record,
    'target_identified',
    'Captured native New Job target',
  );
  await assertSession(s, target);
  return target;
}

export function extractGeneratedTarget(text: string, source: string): string {
  const ids = [
    ...new Set(text.match(/\b(?:VIDE-)?EXP-\d{4}-\d+\b/g) ?? []),
  ].filter((id) => id !== source);
  if (ids.length !== 1)
    throw new Error('Generated target cannot be established uniquely');
  return ids[0]!;
}
