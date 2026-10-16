import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { discoverInput } from '../src/documents/read';
import { Journal } from '../src/journal';
import { ShipmentArtifactSchema } from '../src/schemas';
import { hashInputs } from '../src/workflow';
import { runFixture } from './fixtures';

const cli = resolve('src/cli.ts');
async function invoke(args: readonly string[], cwd = process.cwd()) {
  const child = Bun.spawn(['bun', cli, ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, IMPEX_USERNAME: '', IMPEX_PASSWORD: '' },
  });
  const [code, out, err] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, out, err };
}

test('CLI help describes assistant extraction without user-authored manifests', async () => {
  const r = await invoke(['help']);
  expect(r.code).toBe(0);
  expect(r.out).toContain('extract <folder>');
  expect(r.out).toContain('shipment.json');
  expect(r.out).toContain('assisting AI');
});

test.each([
  { args: ['submit', 'missing'] },
  { args: ['prepare-data', 'missing'] },
  { args: ['revise', 'missing'] },
  { args: ['run', 'missing', '--fresh'] },
  { args: ['run', 'missing', '--invented'] },
])(
  'retired commands and unknown options fail before browser work: %j',
  async ({ args }) => {
    const r = await invoke(args);
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/Unknown|Invalid/);
    expect(r.err).not.toContain('IMPEX_USERNAME');
  },
);

test('CLI discovers documents and creates internal shipment artifact without a manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'impex-cli-'));
  try {
    await mkdir(join(root, 'INMBD6_001'));
    await writeFile(join(root, 'INMBD6_001', 'invoice.txt'), 'Invoice INV123');
    const r = await invoke(
      ['extract', 'INMBD6_001', '--branch', 'MORADABAD', '--year', '2026-2027'],
      root,
    );
    expect(r.code).toBe(0);
    expect(r.out).toContain('Invoice INV123');
    const file = join(
      root,
      'runs',
      'MORADABAD-2026-2027-INMBD6_001',
      'shipment.json',
    );
    const artifact = await Bun.file(file).json();
    expect(artifact.formatVersion).toBe(1);
    expect(artifact.files[0].path).toBe('invoice.txt');
    expect(
      await Bun.file(join(root, 'INMBD6_001', 'manifest.json')).exists(),
    ).toBe(false);
    const missing = await invoke(
      ['run', 'INMBD6_001', '--branch', 'MORADABAD', '--year', '2026-2027'],
      root,
    );
    expect(missing.code).not.toBe(0);
    expect(missing.err).toContain('invoice');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('verified rerun hashes originals without reopening an unchanged workbook; changes still revalidate', async () => {
  const root = await mkdtemp(join(tmpdir(), 'impex-verified-'));
  const context = { branch: 'MORADABAD' as const, financialYear: '2026-2027' };
  const folder = join(root, 'INMBD6_001'),
    journal = new Journal(join(root, 'runs'));
  try {
    await mkdir(folder);
    // A ZIP signature without its directory reliably fails the spreadsheet reader.
    await writeFile(
      join(folder, 'invoice.xlsx'),
      Buffer.from([0x50, 0x4b, 3, 4]),
    );
    const input = await discoverInput(folder, context);
    const shipment = { ...runFixture().shipment, context };
    const artifact = ShipmentArtifactSchema.parse({
      formatVersion: 1,
      inputFolder: input.folder,
      files: input.files,
      referenceOnly: false,
      instructions: {},
      shipment,
    });
    await journal.writeArtifact(input.runId, 'shipment.json', artifact);
    const record = runFixture({
      runId: input.runId,
      context,
      shipment,
      sourceJobNo: null,
      sourceSnapshot: null,
      state: 'verified',
      targetJobNo: 'EXP-2627-123',
      inputFolder: input.folder,
      inputHash: await hashInputs(folder, context, journal),
    });
    await journal.save(record);
    const args = [
      'run',
      folder,
      '--branch',
      context.branch,
      '--year',
      context.financialYear,
    ];
    const unchanged = await invoke(args, root);
    expect(unchanged.code).toBe(0);
    expect(unchanged.out).toContain('EXP-2627-123');
    expect(unchanged.out).toContain('verified');

    record.policyHash = 'changed-policy';
    await journal.save(record);
    const policyChanged = await invoke(args, root);
    expect(policyChanged.code).not.toBe(0);
    expect(policyChanged.err).toMatch(/zip|directory|file/i);

    record.policyHash = runFixture().policyHash;
    await journal.save(record);
    artifact.instructions = { 'invoice[0].invoice.terms': 'FOB' };
    await journal.writeArtifact(input.runId, 'shipment.json', artifact);
    const interpretationChanged = await invoke(args, root);
    expect(interpretationChanged.code).not.toBe(0);
    expect(interpretationChanged.err).toMatch(/zip|directory|file/i);

    await writeFile(join(folder, 'invoice.xlsx'), 'changed shipment');
    const documentChanged = await invoke(args, root);
    expect(documentChanged.code).not.toBe(0);
    expect(documentChanged.err).toContain('documents changed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 20000);
