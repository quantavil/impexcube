import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeRun } from '../src/runs/execute';
import { Journal } from '../src/runs/journal';
import { runFixture, shipmentFixture } from './fixtures';

const record = (): any => runFixture();
test('blocking preflight performs no mutations', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'impex-'));
  try {
    const r = record();
    r.patch.issues = [
      { code: 'required', message: 'Missing new invoice', blocking: true },
    ];
    const j = new Journal(dir);
    await j.save(r);
    const effects: string[] = [];
    const report = await executeRun(r, j, {
      copy: async () => {
        effects.push('copy');
        return 'VIDE-EXP-2627-11';
      },
      save: async () => {
        effects.push('save');
      },
      verify: async () => [],
      checkTarget: async () => {},
    });
    expect(effects).toEqual([]);
    expect(report.status).toBe('needs_input');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('automatic save and rerun retain one target; uncertain copy never retries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'impex-'));
  try {
    const r = record(),
      j = new Journal(dir);
    const effects: string[] = [];
    const ops: any = {
      copy: async () => {
        await j.transition(r, 'copy_started');
        effects.push('created target');
        r.targetJobNo = 'VIDE-EXP-2627-11';
        await j.transition(r, 'target_identified');
        return r.targetJobNo;
      },
      save: async () => {
        effects.push('saved fields');
      },
      verify: async () => [],
      checkTarget: async () => {},
    };
    await j.save(r);
    expect((await executeRun(r, j, ops)).status).toBe('verified');
    expect((await executeRun(await j.load('r1'), j, ops)).status).toBe(
      'verified',
    );
    expect(effects).toEqual(['created target', 'saved fields']);
    const uncertain = record();
    uncertain.state = 'copy_started';
    expect((await executeRun(uncertain, j, ops)).status).toBe('uncertain');
    expect(effects).toEqual(['created target', 'saved fields']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('failed save preserves identified target for resume', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'impex-'));
  try {
    const r = record();
    r.state = 'target_identified';
    r.targetJobNo = 'VIDE-EXP-2627-11';
    const j = new Journal(dir);
    await j.save(r);
    const report = await executeRun(r, j, {
      copy: async () => {
        throw Error('must not copy');
      },
      save: async () => {
        throw Error('request timeout');
      },
      verify: async () => [],
      checkTarget: async () => {},
    });
    expect(report.targetJobNo).toBe('VIDE-EXP-2627-11');
    expect((await j.load('r1')).state).toBe('uncertain');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('resuming a prepared duplicate refuses a second Generate', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'impex-'));
  try {
    const j = new Journal(dir);
    const shipment = shipmentFixture('0502032324', 'INV7');
    const a = {
        ...record(),
        shipment,
        state: 'verified',
        targetJobNo: 'VIDE-EXP-2627-11',
      },
      b = { ...record(), shipment, runId: 'r2' };
    await j.save(a);
    await j.save(b);
    let copies = 0;
    const result = await executeRun(b, j, {
      copy: async () => {
        copies++;
        return 'VIDE-EXP-2627-12';
      },
      checkTarget: async () => {},
      save: async () => {},
      verify: async () => [],
    });
    expect(copies).toBe(0);
    expect(result.issues.some((i) => i.code === 'duplicate')).toBe(true);
    expect(result.status).toBe('needs_input');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a save failure cannot poison shared preflight issues on resume', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'impex-'));
  try {
    const r = record();
    r.issues = r.patch.issues;
    r.targetJobNo = 'VIDE-EXP-2627-11';
    r.state = 'target_identified';
    const j = new Journal(dir);
    let saves = 0;
    const ops = {
      copy: async () => {
        throw Error('must not copy');
      },
      save: async () => {
        if (++saves === 1) throw Error('timeout');
      },
      verify: async () => [],
      checkTarget: async () => {},
    };
    await executeRun(r, j, ops);
    expect(r.patch.issues).toEqual([]);
    expect((await executeRun(await j.load('r1'), j, ops)).status).toBe(
      'verified',
    );
    expect(saves).toBe(2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('revising an existing verified target updates sections without copying again', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'impex-'));
  try {
    const r = record();
    r.targetJobNo = 'VIDE-EXP-2627-11';
    r.state = 'verified';
    r.savedSections = ['general', 'shipment', 'invoice'];
    const j = new Journal(dir);
    await j.save(r);

    // Now party provides revised product / invoice details
    const revised = await j.load(r.runId);
    expect(revised.state).toBe('verified');

    // Simulate the revision transition
    revised.savedSections = [];
    revised.inputHash = 'new-revised-hash';
    await j.transition(
      revised,
      'target_identified',
      `Revised inputs for existing target ${revised.targetJobNo}`,
    );

    let copies = 0;
    let saves = 0;
    const ops = {
      copy: async () => {
        copies++;
        return 'SHOULD_NOT_COPY';
      },
      save: async () => {
        saves++;
      },
      verify: async () => [],
      checkTarget: async () => {},
    };

    const result = await executeRun(revised, j, ops);
    expect(copies).toBe(0); // Zero new copies!
    expect(saves).toBe(1); // Re-saved on target
    expect(result.status).toBe('verified');
    expect(result.targetJobNo).toBe('VIDE-EXP-2627-11');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
