import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { customsHouseFromFolder } from '../src/inputs/load';
import { hashInputs, loadShipment } from '../src/runs/prepare';

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

test('folder customs code overrides inherited instructions and is part of the input hash', async () => {
  const root = await mkdtemp(join(tmpdir(), 'impex-customs-'));
  try {
    const dirs = ['INMBD6_001', 'INDER6_004'].map((name) => join(root, name));
    for (const dir of dirs) {
      await mkdir(dir);
      await Bun.write(
        join(dir, 'manifest.json'),
        JSON.stringify({
          shipmentId: 'same-shipment',
          context: { branch: 'MORADABAD', financialYear: '2026-2027' },
          files: [{ path: 'invoice.txt', role: 'invoice' }],
          instructions: { 'general.customHouse': 'OLD' },
        }),
      );
      await Bun.write(join(dir, 'invoice.txt'), 'Invoice INV1');
      await Bun.write(
        join(dir, 'extracted.json'),
        JSON.stringify({
          context: { branch: 'MORADABAD', financialYear: '2026-2027' },
          fields: {},
          invoices: [{}],
        }),
      );
    }
    const first = await loadShipment(dirs[0]!);
    const second = await loadShipment(dirs[1]!);
    expect(first.shipment.fields['general.customHouse']?.value).toBe('INMBD6');
    expect(second.shipment.fields['general.customHouse']?.value).toBe('INDER6');
    expect(second.shipment.fields['general.customHouse']?.evidence).toEqual([
      { file: 'folder-name', raw: 'INDER6_004' },
    ]);
    expect(await hashInputs(dirs[0]!, first.manifest)).not.toBe(
      await hashInputs(dirs[1]!, second.manifest),
    );
    expect(await hashInputs(dirs[0]!, first.manifest)).not.toBe(
      await hashInputs(dirs[0]!, {
        ...first.manifest,
        context: { ...first.manifest.context, branch: 'DELHI' },
      }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
