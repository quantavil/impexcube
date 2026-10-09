import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateShipment } from '../src/domain/validate';
import { parseManifest } from '../src/inputs/load';
import { Journal } from '../src/runs/journal';

const manifest = () => ({
  shipmentId: 's1',
  context: { branch: 'DELHI', financialYear: '2026-2027' },
  files: [{ path: 'invoice.pdf', role: 'invoice' }],
});
test('manifest rejects unsupported locales and invalid optional shapes', () => {
  for (const extra of [
    { locale: 'fr-FR' },
    { referenceOnly: 'false' },
    { instructions: [] },
  ])
    expect(() => parseManifest({ ...manifest(), ...extra })).toThrow();
  expect(parseManifest(manifest()).instructions).toEqual({});
});
test('evidence coordinates reject string pages and non-string cell references', () => {
  for (const evidence of [
    { file: 'a.pdf', raw: 'A', page: '1' },
    { file: 'a.xls', raw: 'A', sheet: 7, cell: 'A1' },
  ]) {
    const s: any = {
      context: manifest().context,
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
    await writeFile(
      join(dir, 'broken.json'),
      JSON.stringify({ runId: 'broken', state: 'verified' }),
    );
    await expect(new Journal(dir).load('broken')).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('persisted run invariants reject impossible verified states', async () => {
  const { runFixture } = await import('./fixtures');
  const dir = await mkdtemp(join(tmpdir(), 'impex-invariants-'));
  try {
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
    ];
    for (const record of records) {
      await writeFile(join(dir, 'r1.json'), JSON.stringify(record));
      await expect(new Journal(dir).load('r1')).rejects.toThrow();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
