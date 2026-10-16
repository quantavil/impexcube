import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Journal } from '../src/journal';
import { mergeShipment } from '../src/policy/merge';
import { selectSource } from '../src/policy/select';
import { RunRecordSchema } from '../src/schemas';
import { verifySnapshotContract } from '../src/website/verify';
import { executeRun } from '../src/workflow';
import { runFixture, shipmentFixture } from './fixtures';

const master = { 'general.iec': '001', 'general.exporter': 'NEW EXPORTER' };

test('new-job preparation does not require a previous snapshot or equal invoice count', () => {
  const shipment = shipmentFixture();
  const patch = mergeShipment(null, shipment, master);
  expect(
    patch.issues.some((i) => ['invoice_count', 'no_source'].includes(i.code)),
  ).toBe(false);
  expect(
    patch.issues.some(
      (i) =>
        i.code === 'missing' && i.field === 'invoice.amount' && !i.blocking,
    ),
  ).toBe(true);
});

test('no previous exporter jobs is a no_source result rather than exporter ambiguity', () => {
  const shipment = shipmentFixture();
  delete shipment.fields['general.iec'];
  shipment.fields['general.exporter'] = {
    value: 'NEW EXPORTER',
    status: 'sourced',
    evidence: [],
  };
  shipment.fields['general.consignee'] = {
    value: 'BUYER',
    status: 'sourced',
    evidence: [],
  };
  const result = selectSource([], shipment);
  expect(Array.isArray(result) && result[0]?.code).toBe('no_source');
});

test('all native journals require a master and references remain optional', () => {
  const record = {
    ...runFixture(),
    sourceJobNo: null,
    sourceSnapshot: null,
    exporterMaster: master,
  };
  expect(RunRecordSchema.parse(record).sourceJobNo).toBeNull();
  expect(() =>
    RunRecordSchema.parse({ ...record, exporterMaster: {} }),
  ).toThrow();
  expect(() =>
    RunRecordSchema.parse({ ...runFixture(), exporterMaster: {} }),
  ).toThrow();
});

test('source-less verification checks exporter identity without pretending to verify a source', () => {
  const record = {
    ...runFixture(),
    sourceJobNo: null,
    sourceSnapshot: null,
    exporterMaster: master,
  };
  const target = {
    context: record.context,
    jobNo: 'VIDE-EXP-2627-11',
    fields: master,
    invoices: [],
  };
  expect(verifySnapshotContract(null, target, record)).toEqual([]);
  expect(
    verifySnapshotContract(
      null,
      { ...target, fields: { ...master, 'general.iec': 'WRONG' } },
      record,
    ).some((i) => i.code === 'identity'),
  ).toBe(true);
});

test('an uncertain source-less creation is not repeated on resume', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'impex-new-job-'));
  try {
    const journal = new Journal(dir);
    const record = runFixture({
      sourceJobNo: null,
      sourceSnapshot: null,
      exporterMaster: master,
      state: 'creation_started',
    });
    const actions: string[] = [];
    await executeRun(record, journal, {
      create: async () => {
        actions.push('create');
        return 'VIDE-EXP-2627-11';
      },
      save: async () => {
        actions.push('save');
      },
      verify: async () => [],
    });
    expect(actions).toEqual([]);
    expect(record.state).toBe('uncertain');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('standard exporter legal suffix abbreviations compare consistently', async () => {
  const { normalizeName } = await import('../src/values');
  expect(normalizeName('Bony Polymers Pvt. Ltd.')).toBe(
    normalizeName('BONY POLYMERS PRIVATE LIMITED'),
  );
  expect(normalizeName('Bony Polymers Pvt. Ltd.')).not.toBe(
    normalizeName('BONY INDUSTRIES PRIVATE LIMITED'),
  );
});

test('source-less preflight checks port syntax and defers country labels until site options exist', async () => {
  const { canonicalizePatch } = await import('../src/website/fill');
  const patch: any = {
    issues: [],
    operations: [
      {
        section: 'shipment',
        field: 'shipment.destinationCountry',
        value: 'UNITED STATES',
        action: 'replace',
        evidence: [],
      },
      {
        section: 'shipment',
        field: 'shipment.destinationPort',
        value: 'USNYC',
        action: 'replace',
        evidence: [],
      },
    ],
  };
  const session: any = {};
  expect(
    (await canonicalizePatch(session, null, patch)).operations[0]?.value,
  ).toBe('UNITED STATES');
  patch.operations[1].value = 'NEW YORK';
  let failure: unknown;
  try {
    await canonicalizePatch(session, null, patch);
  } catch (error) {
    failure = error;
  }
  expect(String(failure)).toContain('exact site port code');
});

test('native creation and invoice initialization reject a different recorded branch before site access', async () => {
  const { createNewJob } = await import('../src/website/create');
  const { initializeInvoices } = await import('../src/website/fill');
  const record = runFixture({
    sourceJobNo: null,
    sourceSnapshot: null,
    exporterMaster: master,
  });
  const session: any = {
    context: { ...record.context, branch: 'MORADABAD' },
    page: {},
  };
  const journal: any = {};
  let creation: unknown, invoices: unknown;
  try {
    await createNewJob(session, record, journal);
  } catch (error) {
    creation = error;
  }
  try {
    await initializeInvoices(
      session,
      { ...record, targetJobNo: 'EXP-2627-11' },
      journal,
    );
  } catch (error) {
    invoices = error;
  }
  expect(String(creation)).toContain('context');
  expect(String(invoices)).toContain('context');
});
