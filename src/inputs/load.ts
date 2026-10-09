import { realpath } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import type { Manifest, Shipment } from '../domain/model';
import { ManifestSchema } from '../domain/schemas';
export function parseManifest(raw: unknown): Manifest {
  if (
    raw &&
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    'context' in raw
  ) {
    const context = raw.context;
    if (
      context &&
      typeof context === 'object' &&
      !Array.isArray(context) &&
      (!('branch' in context) || context.branch === undefined)
    )
      raw = {
        ...raw,
        context: { ...context, branch: process.env.IMPEX_DEFAULT_BRANCH },
      };
  }
  return ManifestSchema.parse(raw);
}
export function customsHouseFromFolder(folder: string): string | null {
  return (
    /^(IN[A-Z0-9]{4})_\d+$/.exec(
      basename(resolve(folder)).toUpperCase(),
    )?.[1] ?? null
  );
}
export function resolveInputPath(folder: string, path: string): string {
  const root = resolve(folder),
    target = resolve(root, path),
    rel = relative(root, target);
  if (!rel || rel.startsWith('..') || isAbsolute(rel))
    throw new Error('Document must be inside shipment folder');
  return target;
}
export async function safeInputPath(
  folder: string,
  path: string,
): Promise<string> {
  const root = await realpath(folder);
  const target = await realpath(resolveInputPath(root, path));
  return resolveInputPath(root, relative(root, target));
}
export async function loadInput(
  folder: string,
): Promise<{ manifest: Manifest; shipment: Shipment | null }> {
  const manifest = parseManifest(
    await Bun.file(resolve(folder, 'manifest.json')).json(),
  );
  for (const f of manifest.files) await safeInputPath(folder, f.path);
  const file = Bun.file(resolve(folder, 'extracted.json'));
  return {
    manifest,
    shipment: (await file.exists()) ? await file.json() : null,
  };
}
