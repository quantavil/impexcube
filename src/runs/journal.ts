import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readdir, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Shipment } from '../domain/model';
import { normalizeDate } from '../domain/validate';
import { normalizeName } from '../policy/identity';
import { type RunRecord, RunRecordSchema, type RunState } from './schema';

export type { RunRecord, RunState } from './schema';

function safeId(id: string): string {
  if (!/^[-\w]{1,100}$/.test(id)) throw new Error('Invalid run identifier');
  return id;
}
export class Journal {
  constructor(readonly dir: string) {}
  async save(record: RunRecord): Promise<void> {
    RunRecordSchema.parse(record);
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const target = join(this.dir, safeId(record.runId) + '.json'),
      temp = target + '.' + randomUUID() + '.tmp';
    const f = await open(temp, 'wx', 0o600);
    try {
      await f.writeFile(JSON.stringify(record, null, 2));
      await f.sync();
    } finally {
      await f.close();
    }
    await rename(temp, target);
    const directory = await open(this.dir, 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
  async load(id: string): Promise<RunRecord> {
    const record = RunRecordSchema.parse(
      JSON.parse(await readFile(join(this.dir, safeId(id) + '.json'), 'utf8')),
    );
    if (record.runId !== id)
      throw new Error('Journal run identifier differs from filename');
    return record;
  }
  async exists(id: string): Promise<boolean> {
    return Bun.file(join(this.dir, safeId(id) + '.json')).exists();
  }
  async archive(runId: string): Promise<RunRecord> {
    const old = await this.load(runId);
    old.state = 'superseded';
    old.transitions.push({
      state: 'superseded',
      at: new Date().toISOString(),
      intent: 'Archived to permit fresh run',
    });
    const archivedId = `${safeId(runId).slice(0, 75)}_old_${Date.now()}`;
    old.runId = archivedId;
    await this.save(old);
    await rm(join(this.dir, safeId(runId) + '.json'), { force: true });
    return old;
  }
  async assertNoDuplicate(runId: string, shipment: Shipment): Promise<void> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw e;
    }
    const exporter = (s: Shipment) =>
      normalizeName(
        s.fields['general.iec']?.value ??
          s.fields['general.exporter']?.value ??
          '',
      );
    const invoices = (s: Shipment) =>
      s.invoices.map((i) =>
        JSON.stringify([
          i['invoice.number']?.value?.trim(),
          normalizeDate(i['invoice.date']?.value ?? ''),
        ]),
      );
    for (const name of names.filter((n) => n.endsWith('.json'))) {
      const old = await this.load(name.slice(0, -5));
      if (
        old.runId === runId ||
        old.state === 'superseded' ||
        !(
          old.targetJobNo ||
          ['copy_started', 'uncertain', 'sections_saved', 'verified'].includes(
            old.state,
          )
        )
      )
        continue;
      if (
        old.context.branch === shipment.context.branch &&
        old.context.financialYear === shipment.context.financialYear &&
        exporter(old.shipment) === exporter(shipment) &&
        invoices(shipment).some((i) => invoices(old.shipment).includes(i))
      )
        throw new Error(
          'Exporter invoice already belongs to run ' +
            old.runId +
            '. Resume that run instead.',
        );
    }
  }
  async transition(
    record: RunRecord,
    state: RunState,
    intent?: string,
  ): Promise<void> {
    record.state = state;
    record.transitions.push({ state, at: new Date().toISOString(), intent });
    await this.save(record);
  }
}
export function fingerprint(data: unknown): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}
