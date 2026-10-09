import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('CLI help runs without site credentials', async () => {
  const p = Bun.spawn(['bun', 'src/cli.ts', 'help'], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { PATH: process.env.PATH! },
  });
  const out = await new Response(p.stdout).text();
  expect(await p.exited).toBe(0);
  expect(out).toContain('resume');
  expect(out).toContain('extract');
  expect(out).toContain('revise');
  expect(out).toContain('--fresh');
  expect(out).toContain('upload-products');
});
test('CLI refuses invalid command without opening browser', async () => {
  const p = Bun.spawn(['bun', 'src/cli.ts', 'oops'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(await p.exited).toBe(1);
});
test('extraction uses named field scope and accepts a document with an accidental prefix', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'impex-extraction-'));
  try {
    await writeFile(
      join(dir, 'manifest.json'),
      JSON.stringify({
        shipmentId: 'scope-test',
        context: { branch: 'DELHI', financialYear: '2026-2027' },
        files: [{ path: 'x_invoice.txt', role: 'invoice' }],
      }),
    );
    await writeFile(join(dir, 'x_invoice.txt'), 'Invoice INV-001');
    const p = Bun.spawn(['bun', 'src/cli.ts', 'extract', dir], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stderr = await new Response(p.stderr).text();
    expect(stderr).toBe('');
    expect(await p.exited).toBe(0);
    const instructions = await readFile(
      join(dir, 'ai-instructions.md'),
      'utf8',
    );
    expect(instructions).toContain(
      'Only extract field keys present in extraction-template.json',
    );
    expect(instructions).not.toContain('x_');
    const docs = JSON.parse(await readFile(join(dir, 'sources.json'), 'utf8'));
    expect(docs[0].file).toBe('x_invoice.txt');
    expect(docs[0].pages[0].text).toContain('INV-001');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
