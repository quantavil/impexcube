import { type Issue, issue } from '../domain/model';
import type { Journal, RunRecord } from './journal';
export interface RunReport {
  status: 'verified' | 'partial' | 'needs_input' | 'uncertain';
  runId: string;
  sourceJobNo: string;
  targetJobNo: string | null;
  issues: Issue[];
  manualProductWork: boolean;
}
export interface ExecutionOps {
  copy(): Promise<string>;
  save(): Promise<void>;
  verify(): Promise<Issue[]>;
  checkTarget(): Promise<void>;
}
export function reportFor(r: RunRecord): RunReport {
  return {
    status:
      r.state === 'verified'
        ? 'verified'
        : r.state === 'uncertain' || r.state === 'copy_started'
          ? 'uncertain'
          : r.targetJobNo
            ? 'partial'
            : 'needs_input',
    runId: r.runId,
    sourceJobNo: r.sourceJobNo,
    targetJobNo: r.targetJobNo,
    issues: r.issues,
    manualProductWork: true,
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
    (record.state === 'copy_started' || record.state === 'uncertain') &&
    !record.targetJobNo
  ) {
    record.issues = [
      issue(
        'uncertain_copy',
        'Identify the created target before resuming. Generate will not be repeated.',
      ),
    ];
    await journal.transition(record, 'uncertain');
    return reportFor(record);
  }
  if (!record.targetJobNo) {
    try {
      await journal.assertNoDuplicate(record.runId, record.shipment);
    } catch (error) {
      record.issues = [
        issue(
          'duplicate',
          error instanceof Error ? error.message : 'Duplicate check failed',
        ),
      ];
      await journal.transition(record, 'needs_input');
      return reportFor(record);
    }
  }
  try {
    if (!record.targetJobNo) {
      const target = await ops.copy();
      if (target === record.sourceJobNo)
        throw new Error('Source cannot be target');
      record.targetJobNo = target;
      await journal.transition(record, 'target_identified');
    }
    await ops.checkTarget();
    await ops.save();
    await journal.transition(record, 'sections_saved');
    record.issues = await ops.verify();
    await journal.transition(
      record,
      record.issues.some((i) => i.blocking) ? 'needs_input' : 'verified',
    );
  } catch (_error) {
    record.issues = [
      ...record.issues,
      issue(
        'operation_failed',
        'Site operation failed or response was uncertain. Inspect the target and resume.',
      ),
    ];
    await journal.transition(
      record,
      record.targetJobNo || record.state === 'copy_started'
        ? 'uncertain'
        : 'needs_input',
    );
  }
  return reportFor(record);
}
