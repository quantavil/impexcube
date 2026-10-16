import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  customsHouseFromFolder,
  discoverInput,
  safeInputPath,
} from '../src/documents/read';
import { ContextSchema } from '../src/schemas';

const context = ContextSchema.parse({
  branch: 'MORADABAD',
  financialYear: '2026-2027',
});

test('document folder discovery needs no manifest and fingerprints original bytes', async () => {
  const base = await mkdtemp(join(tmpdir(), 'impex-input-'));
  const folder = join(base, 'INMBD6_001');
  try {
    await mkdir(join(folder, 'documents'), { recursive: true });
    await writeFile(join(folder, 'invoice.txt'), 'INV 123');
    await writeFile(join(folder, 'documents', 'packing.txt'), '53 Boxes');
    const input = await discoverInput(folder, context);
    expect(input.runId).toBe('MORADABAD-2026-2027-INMBD6_001');
    expect(input.files.map((f) => f.path)).toEqual([
      'documents/packing.txt',
      'invoice.txt',
    ]);
    expect(input.files[0]!.hash).toMatch(/^[a-f0-9]{64}$/);
    const first = input.files[1]!.hash;
    await writeFile(join(folder, 'invoice.txt'), 'INV 124');
    expect((await discoverInput(folder, context)).files[1]!.hash).not.toBe(
      first,
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('document discovery rejects symlink escapes and obsolete input files', async () => {
  const base = await mkdtemp(join(tmpdir(), 'impex-input-'));
  const folder = join(base, 'INMBD6_001');
  try {
    await mkdir(folder);
    await writeFile(join(base, 'secret.txt'), 'outside');
    await symlink(join(base, 'secret.txt'), join(folder, 'invoice.txt'));
    await expect(discoverInput(folder, context)).rejects.toThrow('symbolic');
    await expect(safeInputPath(folder, '../secret.txt')).rejects.toThrow(
      'inside',
    );
    await rm(join(folder, 'invoice.txt'));
    await writeFile(join(folder, 'manifest.json'), '{}');
    await expect(discoverInput(folder, context)).rejects.toThrow('Obsolete');
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('missing and malformed shipment folders fail before browser work', async () => {
  const base = await mkdtemp(join(tmpdir(), 'impex-input-'));
  try {
    await expect(discoverInput(base, context)).rejects.toThrow('customs-code');
    const folder = join(base, 'INMBD6_001');
    await mkdir(folder);
    await expect(discoverInput(folder, context)).rejects.toThrow(
      'No supported',
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test.each(['INTKD6_002', 'unrelated'])(
  'a symbolic root cannot silently derive customs from destination %s',
  async (destination) => {
    const base = await mkdtemp(join(tmpdir(), 'impex-root-link-'));
    try {
      const target = join(base, destination),
        folder = join(base, 'INMBD6_001');
      await mkdir(target);
      await writeFile(join(target, 'invoice.txt'), 'INV 1');
      await symlink(target, folder);
      await expect(discoverInput(folder, context)).rejects.toThrow('symbolic');
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  },
);

test('customs house comes from the final folder code, not its parent or suffix', () => {
  expect(customsHouseFromFolder('/tmp/INMBD6_001')).toBe('INMBD6');
  expect(customsHouseFromFolder('/tmp/INMBD6_001/inder6_004/')).toBe('INDER6');
  for (const name of [
    'shipment-001',
    'INMBD6',
    'INMBD6_bad',
    'INMBD6_001_extra',
  ])
    expect(customsHouseFromFolder(name)).toBeNull();
});
