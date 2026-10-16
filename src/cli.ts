import { resolve } from 'node:path';
import { Journal } from './journal';
import { type Context, ContextSchema } from './schemas';
import { createNewJob } from './website/create';
import { updateExchangeRates } from './website/exchange';
import { initializeInvoices, savePatch } from './website/fill';
import { jobUrl, readSnapshot } from './website/read';
import { type BrowserSession, openSession } from './website/session';
import { assertJobIdentity, identityFor, verifyPatch } from './website/verify';

const help = `Impex Cube job headers (Bun)
extract <folder>              Read originals for the assisting AI; initialize internal shipment.json
validate <folder>             Validate the assisting AI's shipment data and document evidence
prepare <folder>              Fetch previous headers and generate deterministic final.json; no site Save
run <folder>                  Create a native New Job or update this shipment's recorded target; save and verify
resume <run-id>               Continue recorded target with unchanged inputs
resolve-target <run-id> <job>  Identify target after uncertain creation; no site Save
inspect <branch> <year> <job>  Read mapped headers without saving
help
Folder commands accept --branch <branch> and --year <financial-year>.
Branch defaults to IMPEX_DEFAULT_BRANCH; year defaults to IMPEX_FINANCIAL_YEAR or the current Indian financial year.
The user provides documents. The assisting AI produces shipment.json with evidence; the CLI does not interpret documents unattended.
Generated data stays in runs/<run-id>/{previous,shipment,final}.json, journal.json and report.md.
No Product edits, uploads, approval or filing.`;
function argumentsFor(argv: string[]) {
  const positional: string[] = [],
    options: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--help') {
      positional.push('help');
      continue;
    }
    if (arg.startsWith('--')) {
      if (!['--branch', '--year'].includes(arg))
        throw new Error(`Unknown option: ${arg}`);
      const value = argv[++i];
      if (!value || value.startsWith('--') || options[arg] !== undefined)
        throw new Error(`Invalid option: ${arg}`);
      options[arg] = value;
    } else positional.push(arg);
  }
  const [command = 'help', ...args] = positional;
  const counts: Record<string, number> = {
    help: 0,
    extract: 1,
    validate: 1,
    prepare: 1,
    run: 1,
    resume: 1,
    'resolve-target': 2,
    inspect: 3,
  };
  if (!(command in counts) || args.length !== counts[command])
    throw new Error('Invalid command or arguments. Use bun run impex help');
  if (
    Object.keys(options).length &&
    !['extract', 'validate', 'prepare', 'run'].includes(command)
  )
    throw new Error(`Invalid options for ${command}`);
  return { command, args, options };
}
function executionContext(options: Record<string, string>): Context {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(new Date());
  const year = Number(parts.find((p) => p.type === 'year')!.value),
    month = Number(parts.find((p) => p.type === 'month')!.value),
    start = month >= 4 ? year : year - 1;
  return ContextSchema.parse({
    branch: options['--branch'] ?? process.env.IMPEX_DEFAULT_BRANCH,
    financialYear:
      options['--year'] ??
      process.env.IMPEX_FINANCIAL_YEAR ??
      `${start}-${start + 1}`,
  });
}
async function main() {
  const { command, args, options } = argumentsFor(process.argv.slice(2));
  if (command === 'help') {
    console.log(help);
    return;
  }
  const journal = new Journal(resolve('runs'));
  if (command === 'inspect') {
    const context = ContextSchema.parse({
      branch: args[0],
      financialYear: args[1],
    });
    jobUrl(args[2]!);
    const s = await openSession({
      username: process.env.IMPEX_USERNAME ?? '',
      password: process.env.IMPEX_PASSWORD ?? '',
      context,
      headed: process.env.IMPEX_HEADED === '1',
    });
    try {
      console.log(JSON.stringify(await readSnapshot(s, args[2]!), null, 2));
    } finally {
      await s.browser?.close();
    }
    return;
  }
  const {
    executeRun,
    extractShipment,
    hashInputs,
    loadShipment,
    policyFingerprint,
    prepareRun,
    readShipmentInput,
  } = await import('./workflow');
  const { formatReport, saveReport } = await import('./report');
  const policyHash = policyFingerprint();
  await journal.withLock(async () => {
    if (command === 'extract') {
      const handoff = await extractShipment(
        args[0]!,
        executionContext(options),
        journal,
      );
      console.log(JSON.stringify(handoff, null, 2));
      return;
    }
    if (command === 'validate') {
      const { shipment } = await loadShipment(
        args[0]!,
        executionContext(options),
        journal,
      );
      console.log(
        `Evidence valid: ${shipment.invoices.length} current invoice(s). Policy merge and native website requirements remain to be checked.`,
      );
      return;
    }
    let loaded: Awaited<ReturnType<typeof loadShipment>> | undefined;
    let record =
      command === 'resume' || command === 'resolve-target'
        ? await journal.load(args[0]!)
        : null;
    const context = record?.context ?? executionContext(options);
    if (record) {
      if (
        (await hashInputs(record.inputFolder, record.context, journal)) !==
        record.inputHash
      )
        throw new Error(
          'Inputs changed. Run this shipment folder again to re-merge onto its recorded target.',
        );
    } else {
      // Hash the strict artifact/originals first; verified reruns need no document conversion.
      const metadata = await readShipmentInput(args[0]!, context, journal);
      if (await journal.exists(metadata.input.runId)) {
        const previous = await journal.load(metadata.input.runId);
        if (previous.inputFolder !== metadata.input.folder)
          throw new Error(
            'Run identifier already belongs to another shipment folder',
          );
        if (
          previous.state === 'verified' &&
          previous.inputHash === metadata.inputHash &&
          previous.policyHash === policyHash
        )
          record = previous;
      }
      // Changed or unverified inputs still validate evidence before opening the website.
      if (!record)
        loaded = await loadShipment(args[0]!, context, journal, metadata);
    }
    if (
      record?.state === 'verified' &&
      command !== 'resolve-target' &&
      record.policyHash === policyHash
    ) {
      console.log(formatReport(record));
      await saveReport(record, journal);
      return;
    }
    let session: BrowserSession | undefined;
    try {
      session = await openSession({
        username: process.env.IMPEX_USERNAME ?? '',
        password: process.env.IMPEX_PASSWORD ?? '',
        context,
        headed: process.env.IMPEX_HEADED === '1',
      });
      if (!record || (command === 'resume' && record.policyHash !== policyHash))
        record = await prepareRun(
          record?.inputFolder ?? args[0]!,
          context,
          session,
          journal,
          command === 'prepare',
          loaded,
        );
      if (command === 'resolve-target') {
        const target = args[1]!;
        jobUrl(target);
        if (
          record.targetJobNo ||
          !['creation_started', 'uncertain'].includes(record.state) ||
          target === record.sourceJobNo
        )
          throw new Error(
            'Only an unresolved native creation can be assigned a distinct target',
          );
        await assertJobIdentity(session, target, identityFor(record));
        record.targetJobNo = target;
        await journal.transition(
          record,
          'target_identified',
          'Operator identified exact native-created target',
        );
      } else if (command !== 'prepare') {
        const r = record,
          s = session;
        // Original documents and interpreted input must still match immediately before mutation.
        if (
          (await hashInputs(r.inputFolder, r.context, journal)) !== r.inputHash
        )
          throw new Error('Inputs changed during preparation; run again');
        await executeRun(r, journal, {
          create: () => createNewJob(s, r, journal),
          save: async () => {
            await assertJobIdentity(s, r.targetJobNo!, identityFor(r));
            await initializeInvoices(s, r, journal);
            await updateExchangeRates(s, r, journal);
            await savePatch(s, r.targetJobNo!, r.patch, r, journal);
          },
          verify: () => verifyPatch(s, r.targetJobNo!, r.patch, r),
        });
      }
      console.log(formatReport(record));
      await saveReport(record, journal);
      if (
        command === 'prepare'
          ? record.issues.some((i) => i.blocking)
          : command !== 'resolve-target' && record.state !== 'verified'
      )
        process.exitCode = 2;
    } finally {
      await session?.browser?.close();
    }
  });
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
