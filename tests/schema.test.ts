import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Journal } from '../src/journal';
import { RunRecordSchema } from '../src/schemas';
import { validateShipment } from '../src/values';

const context = { branch: 'DELHI', financialYear: '2026-2027' };
test('evidence coordinates reject string pages and non-string cell references', () => {
  for (const evidence of [
    { file: 'a.pdf', raw: 'A', page: '1' },
    { file: 'a.xls', raw: 'A', sheet: 7, cell: 'A1' },
  ]) {
    const s: any = {
      context,
      fields: {
        'general.exporter': {
          value: 'A',
          status: 'sourced',
          evidence: [evidence],
        },
      },
      invoices: [],
    };
    expect(validateShipment(s).some((i) => i.code === 'shape')).toBe(true);
  }
});
test('journal rejects corrupt persisted records before recovery', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'impex-schema-'));
  try {
    await mkdir(join(dir, 'broken'));
    const path = join(dir, 'broken', 'journal.json');
    const corrupt = { runId: 'broken', state: 'verified' };
    await writeFile(path, JSON.stringify(corrupt));
    await expect(new Journal(dir).load('broken')).rejects.toThrow();
    expect(await Bun.file(path).json()).toEqual(corrupt);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('persisted run invariants reject impossible verified states', async () => {
  const { runFixture } = await import('./fixtures');
  const records = [
    runFixture({ state: 'verified' }),
    runFixture({
      state: 'target_identified',
      targetJobNo: 'VIDE-EXP-2627-10',
    }),
    runFixture({
      state: 'verified',
      targetJobNo: 'VIDE-EXP-2627-11',
      issues: [{ code: 'readback', message: 'Mismatch', blocking: true }],
    }),
    runFixture({
      context: { branch: 'MORADABAD', financialYear: '2026-2027' },
    }),
    {
      ...runFixture(),
      productPreservationConfirmedForTarget: 'VIDE-EXP-2627-11',
    },
  ];
  for (const record of records) {
    expect(() => RunRecordSchema.parse(record)).toThrow();
  }
});
