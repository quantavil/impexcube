import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import {
  basename,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path';
import { ExtractInputKind, extract } from '@xberg-io/xberg';
import * as XLSX from 'xlsx';
import type { Context, DocumentText, Input, InputFile } from '../schemas';
import { DocumentSchema, InputSchema } from '../schemas';

export async function readSingleDocument(
  path: string,
  role: InputFile['role'],
): Promise<DocumentText> {
  const filename = basename(path);
  const ext = extname(path).toLowerCase();

  if (ext === '.pdf') {
    const res = await extract(
      {
        kind: ExtractInputKind.Uri,
        uri: resolve(path),
      },
      {
        ocr: { enabled: true },
        pages: { extractPages: true },
      },
    );
    const extracted = res.results?.[0];
    const pages =
      extracted?.pages && extracted.pages.length > 0
        ? extracted.pages.map((p) => ({
            page: p.pageNumber,
            text: p.content || '',
          }))
        : [{ page: 1, text: extracted?.content || '' }];
    const visual = pages
      .filter((p) => !p.text.trim() || p.text.includes('\ufffd'))
      .map((p) => p.page);
    return DocumentSchema.parse({
      file: filename,
      role,
      reader: 'xberg',
      pages,
      visualPages: visual,
      needsVisual: visual.length > 0 || pages.length === 0,
    });
  }

  if (ext === '.xlsx' || ext === '.xls') {
    const fileBytes = await readFile(path);
    const wb = XLSX.read(fileBytes, { type: 'buffer' });
    let markdown = '';
    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      if (!sheet) continue;
      markdown += `## ${sheetName}\n\n`;
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        raw: false,
        defval: '',
      });
      for (const row of rows) {
        const cells = (row as unknown[]).map((cell) =>
          String(cell ?? '')
            .replace(/[\r\n]+/g, ' ')
            .replaceAll('|', '\\|')
            .trim(),
        );
        if (cells.some(Boolean)) {
          markdown += `| ${cells.join(' | ')} |\n`;
        }
      }
      markdown += '\n';
    }
    const lines = markdown.split('\n').map((text, idx) => ({
      line: idx + 1,
      text,
    }));
    return DocumentSchema.parse({
      file: filename,
      role,
      reader: 'xlsx',
      markdown,
      lines,
      needsVisual: lines.length === 0 || !markdown.trim(),
    });
  }

  if (ext === '.txt' || ext === '.md') {
    const fileBytes = await readFile(path);
    const text = fileBytes.toString('utf-8');
    return DocumentSchema.parse({
      file: filename,
      role,
      reader: 'text',
      pages: [{ page: 1, text }],
      needsVisual: false,
    });
  }

  if (ext === '.docx') {
    const res = await extract(
      {
        kind: ExtractInputKind.Uri,
        uri: resolve(path),
      },
      {
        outputFormat: 'markdown',
        ocr: { enabled: true },
      },
    );
    const extracted = res.results?.[0];
    const markdown = (extracted?.content || '').replace(
      /\\([-.\\_()[\]{}*+?^$])/g,
      '$1',
    );
    const lines = markdown.split('\n').map((text: string, idx: number) => ({
      line: idx + 1,
      text,
    }));
    return DocumentSchema.parse({
      file: filename,
      role,
      reader: 'xberg',
      markdown,
      lines,
      needsVisual: lines.length === 0 || !markdown.trim(),
    });
  }

  throw new Error(`Unsupported document type: ${ext}`);
}

export async function readDocuments(
  files: InputFile[],
  folder: string,
): Promise<DocumentText[]> {
  const docs: DocumentText[] = [];
  for (const f of files) {
    const path = await safeInputPath(folder, f.path);
    const doc = await readSingleDocument(path, f.role);
    docs.push({ ...doc, file: f.path });
  }
  return docs;
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
  if (!rel || rel === '..' || rel.startsWith('..' + '/') || isAbsolute(rel))
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
export async function discoverInput(
  folder: string,
  context: Context,
): Promise<Input> {
  if (!customsHouseFromFolder(folder))
    throw new Error(
      'Name the shipment folder <customs-code>_<number>, for example INMBD6_001',
    );
  if ((await lstat(resolve(folder))).isSymbolicLink())
    throw new Error('Shipment folder cannot be a symbolic link');
  const root = await realpath(folder);
  const files: InputFile[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink())
        throw new Error(
          'Shipment folders cannot contain symbolic links: ' +
            relative(root, path),
        );
      if (entry.isDirectory()) {
        await walk(path);
        continue;
      }
      if (!entry.isFile()) continue;
      if (
        ['manifest.json', 'extracted.json'].includes(entry.name.toLowerCase())
      )
        throw new Error(
          'Obsolete input file: ' +
            entry.name +
            '. Preserve old audit files outside this shipment folder.',
        );
      if (
        !['.pdf', '.docx', '.xlsx', '.xls', '.txt', '.md'].includes(
          extname(entry.name).toLowerCase(),
        )
      )
        continue;
      files.push({
        path: relative(root, path),
        role: 'document',
        hash: Bun.CryptoHasher.hash('sha256', await readFile(path), 'hex'),
      });
    }
  };
  await walk(root);
  if (!files.length) throw new Error('No supported shipment documents found');
  files.sort((a, b) => a.path.localeCompare(b.path));
  return InputSchema.parse({
    folder: root,
    context,
    runId:
      context.branch +
      '-' +
      context.financialYear +
      '-' +
      basename(root).toUpperCase(),
    files,
  });
}
