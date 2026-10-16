import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Journal } from './journal';
import type { RunRecord } from './schemas';
import { reportFor } from './workflow';

export function formatReport(record: RunRecord): string {
  const report = reportFor(record);
  const clean = (s: string) => s.replace(/[\r\n]+/g, ' ');
  const lines = [
    `Impex Cube: ${record.runId}`,
    `Status: ${report.status}`,
    `Previous: ${record.sourceJobNo ?? 'none'}`,
    `Target: ${record.targetJobNo ?? 'not created'}`,
  ];
  const missing = report.issues.filter(
    (i) => i.code === 'missing' && !i.blocking,
  );
  const overrides = report.issues.filter(
    (i) => i.code === 'fixed_override' && !i.blocking,
  );
  if (missing.length)
    lines.push(
      `Warning: ${missing.length} unavailable fields left empty; details in final.json.`,
    );
  if (overrides.length)
    lines.push(
      `Warning: fixed defaults overrode ${overrides.length} supplied/reference values; details in final.json.`,
    );
  for (const i of report.issues.filter(
    (i) => i.blocking || !['missing', 'fixed_override'].includes(i.code),
  ))
    lines.push(
      `${i.blocking ? 'Blocked' : 'Warning'}: ${clean(i.message)}${i.field ? ' [' + i.field + ']' : ''}`,
    );
  lines.push(
    'Saved-header verification only; Products, uploads and filing remain manual.',
  );
  return lines.join('\n');
}
export async function saveReport(
  record: RunRecord,
  journal: Journal,
): Promise<string> {
  const path = join(journal.runFolder(record.runId), 'report.md');
  // Every prepared or resumed record already has its durable run directory.
  await writeFile(path, formatReport(record) + '\n', { mode: 0o600 });
  return path;
}
