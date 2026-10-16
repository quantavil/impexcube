import type { RunRecord } from '../journal';
import {
  FIELDS,
  matchesNativeEmpty,
  validateSavedPacking,
} from '../policy/fields';
import type { Issue, Patch, Snapshot } from '../schemas';
import { issue } from '../schemas';
import { convertedINR, displayDate } from '../values';
import { equivalent } from './fill';
import { openSection, readFields, readSnapshot } from './read';
import type { BrowserSession } from './session';
export async function verifyPatch(
  s: BrowserSession,
  target: string,
  p: Patch,
  record: RunRecord,
): Promise<Issue[]> {
  const sourceNow = record.sourceJobNo
      ? await readSnapshot(s, record.sourceJobNo)
      : null,
    actual = await readSnapshot(s, target),
    issues: Issue[] = [
      ...verifySnapshotContract(sourceNow, actual, record),
      ...validateSavedPacking(actual),
    ];
  if (actual.invoices.length !== record.shipment.invoices.length)
    issues.push(
      issue(
        'invoice_count',
        'Saved target invoice count differs from the shipment',
      ),
    );
  for (const o of p.operations) {
    const value =
      o.invoiceIndex === undefined
        ? actual.fields[o.field]
        : actual.invoices[o.invoiceIndex]?.[o.field];
    const desired =
      FIELDS[o.field]!.kind === 'date' && o.value
        ? displayDate(o.value)
        : o.value;
    if (!equivalent(value ?? '', desired, FIELDS[o.field]!.kind)) {
      if (matchesNativeEmpty(o.field, desired, value ?? ''))
        issues.push(
          issue(
            'site_empty_default',
            'Site stores the empty field as ' +
              value +
              '; current document value remains unknown/blank',
            o.field,
            false,
          ),
        );
      else issues.push(issue('readback', 'Persisted value differs', o.field));
    }
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
  }
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
  for (const [key, definition] of Object.entries(FIELDS).filter(
    ([, d]) => d.identity,
  )) {
    if (
      expected[key] !== undefined &&
      !equivalent(actual[key] ?? '', expected[key]!, definition.kind)
    )
      out.push(
        issue(
          'identity',
          'Target exporter master differs from resolved registered master',
          key,
        ),
      );
  }
  return out;
}
export async function assertJobIdentity(
  s: BrowserSession,
  jobNo: string,
  expectedFields: Record<string, string>,
  errorMessage = 'Target exporter differs',
): Promise<Record<string, string>> {
  await openSection(s, jobNo, 'general');
  const actual = await readFields(s, 'general');
  if (verifyIdentity(actual, expectedFields).length) {
    throw new Error(errorMessage);
  }
  return actual;
}
export function verifySnapshotContract(
  sourceNow: Snapshot | null,
  target: Snapshot,
  record: RunRecord,
): Issue[] {
  const expected = record.sourceSnapshot,
    out = verifyIdentity(target.fields, identityFor(record));
  if (expected && JSON.stringify(sourceNow) !== JSON.stringify(expected))
    out.push(
      issue(
        'source_changed',
        'Source job changed since preparation; inspect before continuing',
      ),
    );
  return out;
}

export function identityFor(record: RunRecord): Record<string, string> {
  return record.exporterMaster;
}
