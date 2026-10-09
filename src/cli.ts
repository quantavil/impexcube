import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { copyJob } from './browser/copy';
import { updateExchangeRates } from './browser/exchange';
import { jobUrl, openSection, readFields, readSnapshot } from './browser/read';
import { openSession } from './browser/session';
import { uploadProductExcel } from './browser/upload';
import { verifyIdentity, verifyPatch } from './browser/verify';
import { savePatch } from './browser/write';
import { readDocuments } from './documents/extract';
import { processProductsFolder } from './documents/products';
import type { Context } from './domain/model';
import { validContext } from './domain/validate';
import { loadInput } from './inputs/load';
import { FIELDS, MANUAL_SECTIONS } from './policy/fields';
import { executeRun } from './runs/execute';
import { Journal } from './runs/journal';
import { hashInputs, loadShipment, prepareRun } from './runs/prepare';
import { formatReport } from './runs/report';

const help = `Impex Cube automation (Bun)
prepare-data <folder>         Ingest documents, generate extracted.json and ProductFormat.xlsx for review
extract <folder>              Read documents; write sources.json and AI handoff template
validate <folder>             Check extracted.json evidence without signing in
inspect <branch> <year> <job> Read existing job without saving
prepare <folder>              Select source and write proposed-change report
run <folder> [--fresh]        Copy once and automatically save validated draft (or update existing draft)
submit <folder> [--fresh]     Submit reviewed draft and upload ProductFormat.xlsx (or update existing draft)
revise <folder>               Explicitly update existing target draft with revised inputs
resume <run-id>               Continue same target with unchanged inputs
resolve-target <run-id> <job> Identify target after uncertain Generate; no save
confirm-products <run-id>     Record your manual check of copied Product rows
generate-products <folder>    Generate 37-column ProductFormat.xlsx from shipment
upload-products <run-id> [f]  Upload 37-column product Excel to target draft
help
Credentials: IMPEX_USERNAME / IMPEX_PASSWORD runtime environment.
Products remain for manual editing. Completed referenceOnly inputs cannot run.`;
async function writeExtractionHandoff(
  folder: string,
  manifest: any,
  instructions?: string,
) {
  const docs = await readDocuments(manifest, folder);
  await writeFile(join(folder, 'sources.json'), JSON.stringify(docs, null, 2), {
    mode: 0o600,
  });
  const field = () => ({ value: null, status: 'unknown', evidence: [] });
  const fields = Object.fromEntries(
    Object.entries(FIELDS)
      .filter(([, d]) => ['general', 'shipment'].includes(d.section))
      .map(([k]) => [k, field()]),
  );
  const invoice = Object.fromEntries(
    Object.entries(FIELDS)
      .filter(([, d]) =>
        ['invoice', 'charges', 'thirdParty'].includes(d.section),
      )
      .map(([k]) => [k, field()]),
  );
  await writeFile(
    join(folder, 'extraction-template.json'),
    JSON.stringify(
      { context: manifest.context, fields, invoices: [invoice] },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  await writeFile(
    join(folder, 'ai-instructions.md'),
    instructions ||
      'Read sources.json and original documents. Produce extracted.json using extraction-template.json.\n',
    { mode: 0o600 },
  );
  return docs;
}

async function resolveProductExcel(
  folder: string,
  explicitPath?: string,
): Promise<string | null> {
  if (explicitPath && (await Bun.file(resolve(explicitPath)).exists()))
    return resolve(explicitPath);
  const files = ['ProductFormat.xlsx', 'ProductFormat_generated.xlsx'];
  const existing: Array<{ path: string; mtime: number }> = [];
  for (const name of files) {
    const p = resolve(folder, name);
    const f = Bun.file(p);
    if (await f.exists()) {
      existing.push({ path: p, mtime: f.lastModified });
    }
  }
  if (existing.length === 0) return null;
  if (existing.length === 1) return existing[0]!.path;
  existing.sort((a, b) => b.mtime - a.mtime);
  return existing[0]!.path;
}

async function main() {
  const [command = 'help', arg, arg2, arg3] = process.argv.slice(2);
  const isFresh = process.argv.includes('--fresh');
  if (command === 'help' || command === '--help') {
    console.log(help);
    return;
  }
  if (
    ![
      'extract',
      'validate',
      'inspect',
      'prepare',
      'prepare-data',
      'run',
      'submit',
      'revise',
      'resume',
      'resolve-target',
      'confirm-products',
      'generate-products',
      'upload-products',
    ].includes(command) ||
    !arg
  )
    throw new Error('Invalid command. Use bun run impex help');
  if (command === 'generate-products') {
    const outPath = arg2
      ? resolve(arg2)
      : resolve(arg, 'ProductFormat_generated.xlsx');
    const result = await processProductsFolder(arg, outPath);
    console.log(
      `Generated 37-column product Excel: ${outPath} (${result.total_items} items)`,
    );
    return;
  }
  const journal = new Journal(resolve('runs'));
  if (command === 'prepare-data') {
    const { manifest } = await loadInput(arg);
    let promptText = '';
    try {
      const pFile = resolve('prompt.md');
      if (await Bun.file(pFile).exists())
        promptText = await Bun.file(pFile).text();
    } catch {}
    await writeExtractionHandoff(arg, manifest, promptText);
    let productResult = null;
    const outExcel = resolve(arg, 'ProductFormat_generated.xlsx');
    try {
      productResult = await processProductsFolder(arg, outExcel);
    } catch (e: any) {
      console.warn(`Product generation notice: ${e.message}`);
    }
    console.log(
      `[Human Review Gate] Offline preparation complete for ${resolve(arg)}.`,
    );
    console.log(`  - sources.json and extraction-template.json generated`);
    console.log(`  - ai-instructions.md written based on compliance prompt`);
    if (productResult)
      console.log(
        `  - ProductFormat_generated.xlsx created (${productResult.total_items} items)`,
      );
    console.log(
      `Review/edit ProductFormat_generated.xlsx and extracted.json before running 'bun run impex run ${arg}' (or 'bun run impex submit ${arg}').`,
    );
    return;
  }
  if (command === 'extract') {
    const { manifest } = await loadInput(arg);
    const instructions =
      'Read sources.json and original documents. Produce extracted.json using extraction-template.json. One ordered entry per invoice. Exclude reference-role documents from evidence. Every known field needs file plus page/raw OR line/raw for anydoc spreadsheets exactly matching sources.json. Legacy cells evidence is accepted only when the reader actually supplies cells. Keep identifiers and amounts as strings, normalize dates YYYY-MM-DD and ungroup decimal strings. Unknown value=null,status=unknown. Mark conflicting fields conflict; never infer zero charges. Only extract field keys present in extraction-template.json. Screenshot names do not determine field scope. Unmapped website sections remain manual: ' +
      MANUAL_SECTIONS.join(', ') +
      '. Keep buyer distinct from consignee. Business defaults belong in manifest.instructions. Leave general.customHouse and general.customCity unknown: preflight derives Custom House/POL from the shipment folder code and resolves its city against the site master. Use displayed anydoc values; formatting and hidden merged cells are not data-loss warnings. Review missing formula-cache warnings and original PDF visualPages. LiteParse has OCR disabled; inspect original PDFs visually for image-only content even when extracted text exists. For scanned or uncalculated documents, produce a checked text transcription as an instructions file in manifest, preserving original for reference. No website actions during extraction.\n';
    const docs = await writeExtractionHandoff(arg, manifest, instructions);
    console.log(
      `Wrote sources.json, extraction-template.json and ai-instructions.md in ${resolve(arg)}. ${docs.filter((d) => d.needsVisual).length} documents require visual/cached-value review.`,
    );
    return;
  }

  if (command === 'validate') {
    const { shipment } = await loadShipment(arg);
    console.log(
      `Evidence valid; ${shipment.invoices.length} invoice(s). Website preflight still required.`,
    );
    return;
  }
  let record =
    command === 'resume' ||
    command === 'resolve-target' ||
    command === 'confirm-products' ||
    command === 'upload-products'
      ? await journal.load(arg)
      : null;
  let context: Context;
  if (command === 'inspect') {
    context = { branch: arg as Context['branch'], financialYear: arg2! };
    if (!validContext(context) || !arg3)
      throw new Error('Supply branch, financial year and job');
    jobUrl(arg3);
  } else context = record?.context ?? (await loadInput(arg)).manifest.context;
  let session: any;
  try {
    session = await openSession({
      username: process.env.IMPEX_USERNAME ?? '',
      password: process.env.IMPEX_PASSWORD ?? '',
      context,
      headed: process.env.IMPEX_HEADED === '1',
    });
    if (command === 'inspect') {
      const snapshot = await readSnapshot(session, arg3!);
      console.log(JSON.stringify(snapshot, null, 2));
      return;
    }
    if (!record)
      record = await prepareRun(arg, session, journal, { fresh: isFresh });
    else {
      const { manifest } = await loadInput(record.inputFolder);
      if ((await hashInputs(record.inputFolder, manifest)) !== record.inputHash)
        throw new Error(
          `Inputs changed since preparation for run ${record.runId}. Run 'bun run impex submit ${record.inputFolder}' to revise target draft ${record.targetJobNo}.`,
        );
    }
    if (command === 'confirm-products') {
      if (!record.targetJobNo || !record.savedSections.length)
        throw new Error(
          'Save a target draft before confirming copied Products',
        );
      await openSection(session, record.targetJobNo, 'general');
      if (
        verifyIdentity(
          await readFields(session, 'general'),
          record.sourceSnapshot.fields,
        ).length
      )
        throw new Error('Target exporter differs');
      record.productPreservationConfirmedForTarget = record.targetJobNo;
      await journal.transition(
        record,
        record.state,
        'Operator confirms manually inspected copied Product preservation',
      );
      console.log(
        'Recorded manual Product-preservation check. Resume to verify saved fields.',
      );
      return;
    }
    if (command === 'upload-products') {
      if (!record.targetJobNo || !record.savedSections.length)
        throw new Error('Save a target draft before uploading products');
      const excelPath = await resolveProductExcel(record.inputFolder, arg2);
      if (!excelPath)
        throw new Error(
          `Product Excel file not found. Run 'bun run impex generate-products ${record.inputFolder}' first.`,
        );
      console.log(
        `Uploading product Excel (${excelPath}) to target ${record.targetJobNo}...`,
      );
      const uploadRes = await uploadProductExcel(
        session,
        record.targetJobNo,
        excelPath,
      );
      record.productPreservationConfirmedForTarget = record.targetJobNo;
      try {
        const { manifest } = await loadInput(record.inputFolder);
        record.inputHash = await hashInputs(record.inputFolder, manifest);
      } catch {}
      await journal.transition(
        record,
        record.state,
        `Uploaded product Excel: ${uploadRes.message ?? 'ok'}`,
      );
      console.log(
        `Uploaded products successfully to ${record.targetJobNo}. Resume to verify all saved fields.`,
      );
      return;
    }
    if (command === 'resolve-target') {
      if (
        !arg2 ||
        record.targetJobNo ||
        !['copy_started', 'uncertain'].includes(record.state)
      )
        throw new Error(
          'Only an unresolved copy attempt can be assigned a target',
        );
      jobUrl(arg2);
      if (arg2 === record.sourceJobNo)
        throw new Error('Source cannot be target');
      const target = await readSnapshot(session, arg2);
      if (
        target.fields['general.iec'] !==
        record.sourceSnapshot.fields['general.iec']
      )
        throw new Error('Target exporter differs');
      record.targetJobNo = arg2;
      await journal.transition(
        record,
        'target_identified',
        'Operator explicitly identified generated target',
      );
      console.log(formatReport(record));
      return;
    }
    if (command !== 'prepare') {
      const r = record,
        s = session;
      await executeRun(r, journal, {
        copy: () => copyJob(s, r, journal),
        checkTarget: async () => {
          await openSection(s, r.targetJobNo!, 'general');
          if (
            verifyIdentity(
              await readFields(s, 'general'),
              r.sourceSnapshot.fields,
            ).length
          )
            throw new Error('Target exporter differs');
        },
        save: async () => {
          await updateExchangeRates(s, r, journal);
          const folder = r.inputFolder;
          let excelPath = await resolveProductExcel(folder);
          if (!excelPath) {
            const generated = resolve(folder, 'ProductFormat_generated.xlsx');
            try {
              await processProductsFolder(folder, generated);
              excelPath = generated;
            } catch {}
          }
          if (excelPath && (await Bun.file(excelPath).exists())) {
            console.log(
              `Uploading product Excel (${excelPath}) to target ${r.targetJobNo}...`,
            );
            try {
              const uploadRes = await uploadProductExcel(
                s,
                r.targetJobNo!,
                excelPath,
              );
              r.productPreservationConfirmedForTarget =
                r.targetJobNo ?? undefined;
              await journal.transition(
                r,
                r.state,
                `Uploaded product Excel: ${uploadRes.message ?? 'ok'}`,
              );
            } catch (err: any) {
              console.warn(
                `Product upload could not be completed automatically: ${err.message}. Products remain manual.`,
              );
            }
          }
          await savePatch(s, r.targetJobNo!, r.patch, r, journal);
        },
        verify: () => verifyPatch(s, r.targetJobNo!, r.patch, r),
      });
    }
    console.log(formatReport(record));
    console.log(
      `State: ${record.state}; source: ${record.sourceJobNo}; target: ${record.targetJobNo ?? 'none'}`,
    );
    if (
      record.state !== 'verified' &&
      !(command === 'prepare' && record.state === 'prepared')
    )
      process.exitCode = 2;
  } finally {
    await session?.browser?.close();
  }
}
try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : 'Operation failed';
  const secrets = [
    process.env.IMPEX_USERNAME,
    process.env.IMPEX_PASSWORD,
  ].filter((s): s is string => !!s);
  console.error(
    secrets.reduce(
      (text, secret) => text.replaceAll(secret, '[redacted]'),
      message,
    ),
  );
  process.exitCode = 1;
}
