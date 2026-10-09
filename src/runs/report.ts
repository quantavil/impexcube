import { reportFor } from './execute';
import type { RunRecord } from './journal';

export function formatReport(record: RunRecord): string {
  const report = reportFor(record);
  const escapeCell = (v: string) =>
    v.replaceAll('|', '\\|').replace(/[\r\n]+/g, ' ');
  const lines = [
    `# Impex Cube draft: ${escapeCell(record.runId)}`,
    `Status: ${report.status}`,
    `Source: ${record.sourceJobNo}`,
    `Target: ${record.targetJobNo ?? 'not created'}`,
    `Selection: ${record.reason}`,
    '',
    '| Section | Field | Action | New value |',
    '|---|---|---|---|',
    ...record.patch.operations.map(
      (o) =>
        `| ${o.section} | ${escapeCell(o.field)}${o.invoiceIndex === undefined ? '' : ` [${o.invoiceIndex + 1}]`} | ${o.action} | ${escapeCell(o.value)} |`,
    ),
    '',
    '## Outstanding work',
    ...report.issues.map(
      (i) =>
        `- ${i.blocking ? 'BLOCKING' : 'Manual review'}: ${escapeCell(i.message)} ${i.field ?? ''}`,
    ),
    '- Review/edit ProductFormat.xlsx before filing. This is a draft, not an approved filing.',
  ];
  return lines.join('\n');
}
