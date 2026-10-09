import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Journal } from '../src/runs/journal';
import { runFixture, shipmentFixture } from './fixtures';

test('different folder identifier cannot recopy same exporter invoice', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'impex-'));
  try {
    const journal = new Journal(dir);
    const shipment = shipmentFixture('0502032324', 'INV-7');
    await journal.save(
      runFixture({ runId: 'OLD', state: 'copy_started', shipment }),
    );
    expect(typeof (journal as any).assertNoDuplicate).toBe('function');
    await expect(
      (journal as any).assertNoDuplicate('NEW', shipment),
    ).rejects.toThrow('already belongs');
    await expect(
      (journal as any).assertNoDuplicate('OLD', shipment),
    ).resolves.toBeUndefined();
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

test('archived and superseded runs do not block fresh run', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'impex-'));
  try {
    const j = new Journal(dir);
    const shipment = shipmentFixture('0502032324', 'INV-7');
    await j.save(
      runFixture({
        runId: 'RUN-1',
        state: 'verified',
        shipment,
        targetJobNo: 'EXP-2627-11',
      }),
    );
    // Before archive, duplicate is asserted
    await expect(j.assertNoDuplicate('RUN-2', shipment)).rejects.toThrow(
      'already belongs',
    );

    // Archive RUN-1
    const archived = await j.archive('RUN-1');
    expect(archived.state).toBe('superseded');
    expect(await j.exists('RUN-1')).toBe(false);

    // Now RUN-2 should not be blocked
    await expect(
      j.assertNoDuplicate('RUN-2', shipment),
    ).resolves.toBeUndefined();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
