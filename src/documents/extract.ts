import { readFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { ExtractInputKind, extract } from '@xberg-io/xberg';
import * as XLSX from 'xlsx';
import type { DocumentText, Manifest } from '../domain/model';
import { DocumentSchema } from '../domain/schemas';
import { safeInputPath } from '../inputs/load';

export async function readSingleDocument(
  path: string,
  role: Manifest['files'][number]['role'],
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
      markdown += `## ${sheetName}\n\n`;
      const csv = XLSX.utils.sheet_to_csv(sheet);
      markdown += `${csv
        .split('\n')
        .map((row) => `| ${row.split(',').join(' | ')} |`)
        .join('\n')}\n\n`;
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
      needsVisual: lines.length === 0,
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
      pages: [{ page: 1, text: markdown }],
      warnings: [],
      needsVisual: lines.length === 0 || !markdown.trim(),
    });
  }

  throw new Error(`Unsupported document type: ${ext}`);
}

export async function readDocuments(
  manifest: Manifest,
  folder: string,
): Promise<DocumentText[]> {
  const docs: DocumentText[] = [];
  for (const f of manifest.files) {
    const path = await safeInputPath(folder, f.path);
    const doc = await readSingleDocument(path, f.role);
    docs.push({ ...doc, file: f.path });
  }
  return docs;
}
