import type { Issue, Patch, Snapshot } from '../domain/model';
import { issue } from '../domain/model';
import { convertedINR, displayDate, normalizeDate } from '../domain/validate';
import { FIELDS } from '../policy/fields';
import type { RunRecord } from '../runs/journal';
import { readSnapshot } from './read';
import type { BrowserSession } from './session';
import { equivalent } from './write';
export async function verifyPatch(
  s: BrowserSession,
  target: string,
  p: Patch,
  record: RunRecord,
): Promise<Issue[]> {
  const sourceNow = record.sourceSnapshot,
    actual = await readSnapshot(s, target),
    issues: Issue[] = verifySnapshotContract(sourceNow, actual, record);
  for (const o of p.operations) {
    const value =
      o.invoiceIndex === undefined
        ? actual.fields[o.field]
        : actual.invoices[o.invoiceIndex]?.[o.field];
    const desired =
      FIELDS[o.field]!.kind === 'date' && o.value
        ? displayDate(o.value)
        : o.value;
    if (!equivalent(value ?? '', desired, FIELDS[o.field]!.kind))
      issues.push(issue('readback', 'Persisted value differs', o.field));
  }
  for (const inv of actual.invoices) {
    const currency = inv['invoice.currency']!,
      rate = inv['invoice.exchangeRate']!;
    if (
      !record.expectedRates[currency] ||
      !equivalent(rate, record.expectedRates[currency]!, 'decimal')
    )
      issues.push(
        issue(
          'exchange_rate',
          'Saved invoice rate differs from native Update result',
        ),
      );
    issues.push(...verifyInvoiceConversion(inv));
    if (
      record.productPreservationConfirmedForTarget !== target &&
      !equivalent(
        inv['charges.productAmount'] ?? '',
        inv['invoice.amount'] ?? '',
        'decimal',
      )
    )
      issues.push(
        issue(
          'manual_products',
          'Copied Product totals differ from new invoice; finish manual Product edits',
          undefined,
          false,
        ),
      );
  }
  const intendedDate = record.shipment.fields['general.jobDate']?.value;
  if (
    intendedDate &&
    actual.fields['general.jobDate'] !==
      displayDate(normalizeDate(intendedDate))
  )
    issues.push(
      issue('job_date', 'Generated job date differs from current instruction'),
    );
  if (record.productPreservationConfirmedForTarget !== target)
    issues.push(
      issue(
        'manual_products',
        'Product rows are not edited by automation; review native-copied products before filing',
        undefined,
        false,
      ),
    );
  return issues;
}

export function verifyInvoiceConversion(inv: Record<string, string>): Issue[] {
  try {
    const expected = convertedINR(
      inv['invoice.amount'] ?? '',
      inv['invoice.exchangeRate'] ?? '',
    );
    if (equivalent(inv['invoice.amountINR'] ?? '', expected, 'decimal'))
      return [];
  } catch {}
  return [
    issue(
      'exchange_conversion',
      'Saved INR invoice value does not reconcile with its foreign amount and exchange rate',
      'invoice.amountINR',
    ),
  ];
}

export function verifyIdentity(
  actual: Record<string, string>,
  expected: Record<string, string>,
): Issue[] {
  const out: Issue[] = [];
  for (const key of [
    'general.iec',
    'general.exporter',
    'general.exporterAddress',
    'general.gst',
    'general.adCode',
    'general.iecBranch',
  ]) {
    if (expected[key] !== undefined && actual[key] !== expected[key])
      out.push(
        issue(
          'identity',
          'Copied exporter master differs from recorded source',
          key,
        ),
      );
  }
  return out;
}
export function verifySnapshotContract(
  sourceNow: Snapshot,
  target: Snapshot,
  record: RunRecord,
): Issue[] {
  const expected = record.sourceSnapshot,
    out = verifyIdentity(target.fields, expected.fields);
  if (JSON.stringify(sourceNow) !== JSON.stringify(expected))
    out.push(
      issue(
        'source_changed',
        'Source job changed since preparation; inspect before continuing',
      ),
    );
  if (
    record.productPreservationConfirmedForTarget !== target.jobNo &&
    (expected.productFingerprint && target.productFingerprint
      ? target.productFingerprint !== expected.productFingerprint
      : true)
  )
    out.push(
      issue(
        'product_preservation',
        'Copied Product preservation is not verified. Keep draft partial until the initial copy is checked.',
      ),
    );
  return out;
}
