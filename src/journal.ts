import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  type RunRecord,
  RunRecordSchema,
  type RunState,
  type Shipment,
} from './schemas';
import { normalizeDate, normalizeInvoiceNumber, normalizeName } from './values';

export type { RunRecord, RunState } from './schemas';

function safeId(id: string): string {
  if (!/^[-\w]{1,100}$/.test(id)) throw new Error('Invalid run identifier');
  return id;
}
export class Journal {
  constructor(readonly dir: string) {}
  runFolder(id: string): string {
    return join(this.dir, safeId(id));
  }
  async withLock<T>(action: () => Promise<T>): Promise<T> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const path = join(this.dir, '.lock'),
      token = randomUUID();
    let file;
    try {
      file = await open(path, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new Error(
          'Runs directory is locked by another operation. If it crashed, confirm its process has stopped before manually removing ' +
            path,
        );
      throw error;
    }
    const release = async () => {
      await file.close();
      const current = JSON.parse(await readFile(path, 'utf8'));
      if (current.token !== token)
        throw new Error('Run lock ownership changed; inspect ' + path);
      await rm(path);
    };
    try {
      await file.writeFile(
        JSON.stringify({
          pid: process.pid,
          at: new Date().toISOString(),
          token,
        }),
      );
      await file.sync();
      return await action();
    } finally {
      await release();
    }
  }
  async writeArtifact(
    id: string,
    name: 'journal.json' | 'shipment.json' | 'previous.json' | 'final.json',
    value: unknown,
  ): Promise<void> {
    const dir = this.runFolder(id);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    // Persist both directory entries before a browser mutation can depend on this journal.
    for (const parent of [this.dir, dirname(resolve(this.dir))]) {
      const directory = await open(parent, 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
    const target = join(dir, name),
      temp = target + '.' + randomUUID() + '.tmp';
    const f = await open(temp, 'wx', 0o600);
    try {
      await f.writeFile(JSON.stringify(value, null, 2) + '\n');
      await f.sync();
    } finally {
      await f.close();
    }
    await rename(temp, target);
    const directory = await open(dir, 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
  async save(record: RunRecord): Promise<void> {
    await this.writeArtifact(
      record.runId,
      'journal.json',
      RunRecordSchema.parse(record),
    );
  }
  private async runIds(): Promise<string[]> {
    let entries;
    try {
      entries = await readdir(this.dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    if (entries.some((e) => e.isFile() && e.name.endsWith('.json')))
      throw new Error(
        'Obsolete flat journals found. Preserve the old runs directory separately before using this workflow; no automatic migration is provided.',
      );
    return entries.filter((e) => e.isDirectory()).map((e) => safeId(e.name));
  }
  async load(id: string): Promise<RunRecord> {
    await this.runIds();
    const record = RunRecordSchema.parse(
      JSON.parse(
        await readFile(join(this.runFolder(id), 'journal.json'), 'utf8'),
      ),
    );
    if (record.runId !== id)
      throw new Error('Journal run identifier differs from folder');
    return record;
  }
  async exists(id: string): Promise<boolean> {
    await this.runIds();
    return Bun.file(join(this.runFolder(id), 'journal.json')).exists();
  }
  async assertNoDuplicate(runId: string, shipment: Shipment): Promise<void> {
    const exporter = (s: Shipment) => ({
      iec: normalizeName(s.fields['general.iec']?.value ?? ''),
      name: normalizeName(s.fields['general.exporter']?.value ?? ''),
    });
    const invoiceKeys = (s: Shipment) =>
      s.invoices.flatMap((i) => {
        const num = normalizeInvoiceNumber(i['invoice.number']?.value ?? ''),
          date = i['invoice.date']?.value?.trim();
        if (!num || !date) return [];
        try {
          return [JSON.stringify([num, normalizeDate(date)])];
        } catch {
          return [];
        }
      });
    const identity = exporter(shipment),
      invoices = new Set(invoiceKeys(shipment));
    for (const id of await this.runIds()) {
      if (
        id === runId ||
        !(await Bun.file(join(this.runFolder(id), 'journal.json')).exists())
      )
        continue;
      const old = await this.load(id);
      if (
        !old.targetJobNo &&
        ![
          'creation_started',
          'uncertain',
          'sections_saved',
          'verified',
        ].includes(old.state)
      )
        continue;
      const previous = exporter(old.shipment);
      const same =
        identity.iec && previous.iec
          ? identity.iec === previous.iec
          : !!identity.name && identity.name === previous.name;
      if (
        old.context.branch === shipment.context.branch &&
        old.context.financialYear === shipment.context.financialYear &&
        same &&
        invoiceKeys(old.shipment).some((k) => invoices.has(k))
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
    record.transitions.push({
      state,
      at: new Date().toISOString(),
      ...(intent ? { intent } : {}),
    });
    await this.save(record);
  }
}
export function fingerprint(data: unknown): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}
