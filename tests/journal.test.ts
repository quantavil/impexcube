import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Journal } from '../src/journal';
import { runFixture, shipmentFixture } from './fixtures';

test('one directory lock rejects another mutation and releases after failure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'impex-lock-'));
  try {
    const a = new Journal(dir),
      b = new Journal(dir);
    await a.withLock(async () => {
      await expect(b.withLock(async () => 'created')).rejects.toThrow('locked');
    });
    await expect(
      a.withLock(async () => {
        throw new Error('failure');
      }),
    ).rejects.toThrow('failure');
    expect(await b.withLock(async () => 'released')).toBe('released');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('duplicate prevention uses the invoice identity actually written on the website', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'impex-duplicate-'));
  try {
    const j = new Journal(dir);
    await j.save(
      runFixture({
        runId: 'OLD',
        state: 'creation_started',
        shipment: shipmentFixture('001', 'INV 123'),
      }),
    );
    await expect(
      j.assertNoDuplicate('NEW', shipmentFixture('001', 'INV123')),
    ).rejects.toThrow('already belongs');
    await expect(
      j.assertNoDuplicate('OLD', shipmentFixture('001', 'INV123')),
    ).resolves.toBeUndefined();
    expect(await Bun.file(join(dir, 'OLD', 'journal.json')).exists()).toBe(
      true,
    );
    expect(await Bun.file(join(dir, 'OLD.json')).exists()).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('obsolete flat journals are rejected without deleting the audit record', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'impex-obsolete-'));
  try {
    await writeFile(join(dir, 'OLD.json'), '{}');
    await expect(
      new Journal(dir).assertNoDuplicate('NEW', shipmentFixture()),
    ).rejects.toThrow('Obsolete');
    expect(await Bun.file(join(dir, 'OLD.json')).text()).toBe('{}');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('duplicate keys normalize whitespace and Indian dates', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'impex-'));
  try {
    const j = new Journal(dir);
    const shipment = shipmentFixture('0502032324', 'INV-7');
    await j.save(
      runFixture({
        runId: 'OLD',
        state: 'verified',
        shipment,
        targetJobNo: 'EXP-2627-11',
      }),
    );
    const newer: any = structuredClone(shipment);
    newer.fields['general.iec'].value = ' 0502032324 ';
    newer.invoices[0]['invoice.number'].value = ' INV-7 ';
    for (const date of [' 2026-10-02 ', '02/10/2026']) {
      newer.invoices[0]['invoice.date'].value = date;
      await expect(j.assertNoDuplicate('NEW', newer)).rejects.toThrow(
        'already belongs',
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an unavailable invoice date does not fabricate a duplicate identity', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'impex-'));
  try {
    const j = new Journal(dir);
    const shipment = shipmentFixture('0502032324', 'INV-7');
    await j.save(
      runFixture({
        runId: 'OLD',
        state: 'verified',
        shipment,
        targetJobNo: 'EXP-2627-11',
      }),
    );
    const newer: any = structuredClone(shipment);
    newer.invoices[0]['invoice.date'].value = null;
    await expect(j.assertNoDuplicate('NEW', newer)).resolves.toBeUndefined();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('adding an IEC later cannot bypass a name-only shipment duplicate', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'impex-identity-'));
  try {
    const j = new Journal(dir),
      old = shipmentFixture('001', 'INV-NEW');
    old.fields['general.exporter'] = {
      value: 'ROBUST VULCANITE',
      status: 'sourced',
      evidence: [],
    };
    delete old.fields['general.iec'];
    await j.save(
      runFixture({ runId: 'OLD', state: 'creation_started', shipment: old }),
    );
    const current = structuredClone(old);
    current.fields['general.iec'] = {
      value: 'BFWPC4380K',
      status: 'sourced',
      evidence: [],
    };
    await expect(j.assertNoDuplicate('NEW', current)).rejects.toThrow(
      'already belongs',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
