import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { PDFParse } from 'pdf-parse';
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
  const fileBytes = await readFile(path);

  if (ext === '.pdf') {
    const parser = new PDFParse({ data: fileBytes });
    const parsed = await parser.getText();
    const pages = parsed.pages.map((p: any, i: number) => ({
      page: p.num || i + 1,
      text: p.text || '',
    }));
    const visual = pages
      .filter((p: any) => !p.text.trim() || p.text.includes('\ufffd'))
      .map((p: any) => p.page);
    return DocumentSchema.parse({
      file: filename,
      role,
      reader: 'pdf-parse',
      pages,
      visualPages: visual,
      needsVisual: visual.length > 0 || pages.length === 0,
    });
  }

  if (ext === '.xlsx' || ext === '.xls') {
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
    const text = fileBytes.toString('utf-8');
    return DocumentSchema.parse({
      file: filename,
      role,
      reader: 'text',
      pages: [{ page: 1, text }],
      needsVisual: false,
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
