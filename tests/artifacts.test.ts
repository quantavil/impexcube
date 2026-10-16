import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Journal } from '../src/journal';
import { extractShipment, hashInputs, loadShipment } from '../src/workflow';

const context = { branch: 'MORADABAD' as const, financialYear: '2026-2027' };

test('assistant handoff and validated shipment stay in run artifacts without user JSON', async () => {
  const root = await mkdtemp(join(tmpdir(), 'impex-artifacts-'));
  const folder = join(root, 'INMBD6_001'),
    journal = new Journal(join(root, 'runs'));
  try {
    await mkdir(folder);
    await writeFile(join(folder, 'invoice.txt'), 'Invoice INV123 for ACME');
    const handoff = await extractShipment(folder, context, journal);
    expect(handoff.documents[0]!.pages![0]!.text).toBe(
      'Invoice INV123 for ACME',
    );
    const path = join(journal.runFolder(handoff.input.runId), 'shipment.json');
    const artifact = await Bun.file(path).json();
    artifact.shipment.fields['general.exporter'] = {
      value: 'ACME',
      status: 'sourced',
      evidence: [{ file: 'invoice.txt', page: 1, raw: 'ACME' }],
    };
    artifact.shipment.invoices = [
      {
        'invoice.number': {
          value: 'INV123',
          status: 'sourced',
          evidence: [{ file: 'invoice.txt', page: 1, raw: 'INV123' }],
        },
      },
    ];
    await writeFile(path, JSON.stringify(artifact));
    const loaded = await loadShipment(folder, context, journal);
    expect(loaded.shipment.fields['general.exporter']!.value).toBe('ACME');
    expect(loaded.shipment.fields['general.customHouse']!.value).toBe('INMBD6');
    expect(await Bun.file(join(folder, 'manifest.json')).exists()).toBe(false);
    expect(await Bun.file(join(folder, 'extracted.json')).exists()).toBe(false);
    const refreshed = await extractShipment(folder, context, journal);
    expect(refreshed.artifactPath).toBe(path);
    expect(
      (await Bun.file(path).json()).shipment.fields['general.exporter'].value,
    ).toBe('ACME');
    await writeFile(join(folder, 'invoice.txt'), 'CHANGED');
    await expect(loadShipment(folder, context, journal)).rejects.toThrow(
      'changed',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('old extracted shape is rejected as shipment artifact', async () => {
  const root = await mkdtemp(join(tmpdir(), 'impex-artifacts-'));
  const folder = join(root, 'INMBD6_001'),
    journal = new Journal(join(root, 'runs'));
  try {
    await mkdir(folder);
    await writeFile(join(folder, 'invoice.txt'), 'INV123');
    const handoff = await extractShipment(folder, context, journal);
    await writeFile(
      join(journal.runFolder(handoff.input.runId), 'shipment.json'),
      JSON.stringify({ context, fields: {}, invoices: [] }),
    );
    await expect(loadShipment(folder, context, journal)).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('metadata-only rerun checks reject reference, wrong context/folder and obsolete artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'impex-artifact-guards-'));
  const folder = join(root, 'INMBD6_001'),
    journal = new Journal(join(root, 'runs'));
  try {
    await mkdir(folder);
    await writeFile(join(folder, 'invoice.txt'), 'INV123');
    const handoff = await extractShipment(folder, context, journal);
    const artifact = await Bun.file(handoff.artifactPath).json();
    for (const invalid of [
      { ...artifact, referenceOnly: true },
      { ...artifact, inputFolder: join(root, 'OTHER_001') },
      {
        ...artifact,
        shipment: {
          ...artifact.shipment,
          context: { ...context, branch: 'DELHI' },
        },
      },
      { ...artifact, formatVersion: 0 },
    ]) {
      await writeFile(handoff.artifactPath, JSON.stringify(invalid));
      await expect(hashInputs(folder, context, journal)).rejects.toThrow();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
