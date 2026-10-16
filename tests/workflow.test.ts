import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Journal } from '../src/journal';
import { executeRun } from '../src/workflow';
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
      create: async () => {
        effects.push('create');
        return 'VIDE-EXP-2627-11';
      },
      save: async () => {
        effects.push('save');
      },
      verify: async () => [],
    });
    expect(effects).toEqual([]);
    expect(report.status).toBe('needs_input');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('automatic save and rerun retain one target; uncertain creation never retries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'impex-'));
  try {
    const r = record(),
      j = new Journal(dir);
    const effects: string[] = [];
    const ops: any = {
      create: async () => {
        await j.transition(r, 'creation_started');
        effects.push('created target');
        r.targetJobNo = 'VIDE-EXP-2627-11';
        await j.transition(r, 'target_identified');
        return r.targetJobNo;
      },
      save: async () => {
        effects.push('saved fields');
      },
      verify: async () => [],
    };
    await j.save(r);
    expect((await executeRun(r, j, ops)).status).toBe('verified');
    expect((await executeRun(await j.load('r1'), j, ops)).status).toBe(
      'verified',
    );
    expect(effects).toEqual(['created target', 'saved fields']);
    const uncertain = record();
    uncertain.state = 'creation_started';
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
      create: async () => {
        throw Error('must not create');
      },
      save: async () => {
        throw Error('request timeout');
      },
      verify: async () => [],
    });
    expect(report.targetJobNo).toBe('VIDE-EXP-2627-11');
    expect((await j.load('r1')).state).toBe('uncertain');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('resuming a prepared duplicate refuses a second creation', async () => {
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
      create: async () => {
        copies++;
        return 'VIDE-EXP-2627-12';
      },
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
      create: async () => {
        throw Error('must not create');
      },
      save: async () => {
        if (++saves === 1) throw Error('timeout');
      },
      verify: async () => [],
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

test('a pre-creation failure can resume after no creation intent was recorded', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'impex-retry-'));
  try {
    const journal = new Journal(dir),
      r = runFixture();
    let attempts = 0;
    const ops = {
      create: async () => {
        if (r.state !== 'prepared')
          throw new Error('Native New Job requires prepared state');
        if (++attempts === 1)
          throw new Error('Master preview temporarily unavailable');
        await journal.transition(r, 'creation_started');
        return 'EXP-2627-123';
      },
      save: async () => {},
      verify: async () => [],
    };
    expect((await executeRun(r, journal, ops)).status).toBe('needs_input');
    expect((await executeRun(r, journal, ops)).status).toBe('verified');
    expect(attempts).toBe(2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
