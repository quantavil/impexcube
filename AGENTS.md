# Working on Impex Cube automation

Read README.md for operation.

## Tools and structure

Use Bun for TypeScript. Install with `bun install`. Keep `bun.lock` synchronized with dependency changes.

Use Zod 4 for runtime validation, `xlsx`/`jszip` for 37-column Excel conversion, `pdf-parse` for PDF text with OCR disabled, and Playwright for website controls. AI interprets the original documents and extracted data into evidence-backed `extracted.json`; the CLI does not provide unattended AI interpretation.

- `src/domain`: Zod schemas and validation; derive TypeScript types from schemas.
- `src/documents`: local extraction and evidence handoff.
- `src/policy`: source selection, identity and explicit field allowlist.
- `src/browser`: Playwright Web Forms navigation, copy, save and readback.
- `src/runs`: durable journal, duplicate prevention and recovery.

## Execution order

Read shipment documents → prepare evidence-backed fields → validate → select the previous job → copy once → click Exchange Rate Update once → fill and automatically save General, Shipment, Invoice, F&I and Third Party → verify the saved source and target values at the end. Products and final filing remain manual. Do not mark a draft fully verified until copied Product preservation is confirmed for that exact target.

Credentials and `IMPEX_DEFAULT_BRANCH=MORADABAD` belong in the ignored local `.env`; never put actual credentials in documentation. Input folders belong under `incoming/`. Use `IMPEX_HEADED=1` when the user wants to watch. An existing shipment rerun resumes its recorded target; it does not create a new copy.

Keep changes in the existing functions when practical. Remove duplicate reads, calls and routing decisions before adding abstractions, dependencies or caches. Do not add conditional rate-update skipping, old-preview rate-change blockers, or per-section saved-value verification.

## Workflow invariants

- Prefer latest same exporter + consignee; otherwise latest exporter, within resolved branch/year. An omitted manifest branch uses the explicitly configured IMPEX_DEFAULT_BRANCH; a manifest branch overrides it.
- Derive Custom House/POL from the new shipment folder `<customs-code>_<number>` and resolve its city uniquely against the live site master. Numeric suffixes are sequence numbers; do not hardcode a customs-code whitelist. Missing, ambiguous or malformed codes must produce a visible CLI error before Generate. Account branch is separate.
- Copy to a distinct new target. Never edit the source or use completed examples as mutation targets.
- Preserve Product rows for manual editing. Only mapped allowed controls are writable; filenames do not define scope.
- Live Duty Structure & Tariff UQC: Query ImpexCube's live API (`https://impexcube.in/DutyStructureExport/`) for statutory data (`/FillDescription`, `/GetDetails` for RoDTEP, `/FillDBK` for drawback) per unique RITC/HSN dynamically on each run. Do not cache duty structures on disk; use in-memory deduplication during the run.
- Dynamic SQC Unit & Quantity (KGS vs NOS): Set `SQCUnit` and `RoDTEP UQC` from statutory `StandardUQC`. When `SQCUnit === 'KGS'`, set `SQCQTY` and `RoDTEPQty` to the item's net weight in kilograms from the packing list / extracted data instead of piece counts, writing raw numeric values to Excel. For piece units (`NOS`, `PCS`), use piece quantity and formula references.
- Intelligent Drawback (DBK) Resolution: Match drawback schedules (`ActualDBK_SERNo`, `ActualDBKRate`) dynamically: match specific item keywords from `ActualDBK_Desc`, fall back to positive-rate "Others" entries, and set scheme to `19` when active.
- Taxable Value in Excel: Leave `Taxable_Value` cell (`AF`) completely blank (`null` / empty cell) by default. ImpexCube natively calculates Taxable Value in INR from the invoice foreign amount and official exchange rate. Never write USD amounts into this cell or trigger manual taxable value overrides unless an operator explicitly instructs a custom value.
- Item Description Standardization (Rule 5):
  - For Handicrafts / Artwares: Format as `OTHER ARTICLES OF [MAT1] / [MAT2] ARTWARE - [ORIGINAL ITEM DESCRIPTION]` in uppercase with constituent materials ranked high-to-low by net weight. For Chapter 94 furniture, use `OTHER FURNITURE ARTICLES OF...`.
  - For Industrial / Non-Artware Goods (e.g. automotive parts, springs, electronics, machinery): Retain the exact original commercial description in uppercase without prepending "OTHER ARTICLES OF...".
- A range-only document must not replace copied Marks & Nos declarations. Update a recognized TOTAL … CARTONS header and retain the remaining text; ambiguous marks require a reviewed complete instruction. Do not assume retained LUT/RODTEP declarations are valid for every new shipment.
- Click native Exchange Rate Update exactly once per draft-processing run/resume before section saves, including when unchanged. Record the rate saved by the site; do not skip the click or block normal rate changes against an old preview. Never write the rate manually. Native Update can recalculate invoice amounts from copied Products, so apply document headers afterward. Verify saved invoice INR at the end using exact decimal multiplication and two-decimal rounding. Multiple currencies and individual Product/duty conversions require manual review.
- Automatically save validated drafts. No Checklist approval, filing or attachment uploads.
- Unknown charges are not zero. Every known extracted value requires document evidence or explicit instructions. Keep identifiers and decimal amounts as strings.
- Generate once, persist copy intent before mutation, and resume the same target. Never retry an uncertain Generate blindly.
- Wait for dependent Web Forms postbacks and save completion. Check context and target identity before writes; compare persisted field values only in final verification.
- Text/decimal AutoPostBack controls commit their change on blur: trigger blur inside the awaited action before filling later controls. Skip an already-correct AutoPostBack value instead of waiting for a request that will not happen.
- Routine execution does not delete jobs. An explicitly authorized test deletion requires exact-target identity checks, native acknowledgment and independent absence verification; retain the deleted target journal as an audit record before permitting a replacement copy.
- Prefer inspected native routes on the verified active job: Shipment → Invoice, Invoice → Shipment/Job Details, Exchange Rate → General Details. Use explicit job URLs for switching jobs or final fresh snapshots. Avoid adding navigation caches/frameworks or bypassing the native invoice-row selection.
- Reuse same-job navigation and the selected invoice only while current context, visible controls and invoice identity agree. Verify persisted values only at the end after all section saves, using fresh final snapshots; do not reopen each just-saved section for readback. Save/postback completion and target/session guards remain mandatory; discard unsaved source option previews between preflight sections. Skip already-correct controls and sections, but retain final fresh target/source verification because later saves can recalculate values.
- Read mapped fields in one DOM snapshot per section. With an explicit IEC, scan eligible jobs newest first and stop at the latest matching consignee; name-only selection must still check exporter ambiguity.
- Keep credentials, source documents, reports and journals out of Git. Never log secrets or save login state.
- A live mutation test requires genuine new-shipment inputs or an explicitly designated disposable target. Local fixture tests do not establish live acceptance.

## Verification

Run `bun test`, `bun run typecheck`, `bun run lint`, and `bun run knip` after code changes. Add meaningful regression coverage for changed behavior. Keep docs aligned with actual limitations. Do not reintroduce obsolete benchmarks or duplicate research outputs without a concrete need.

For requested timing runs, report actual elapsed time, visited tabs/URLs and navigation steps. Distinguish an unchanged-target rerun from fresh copying/filling; state whether any Save requests occurred. Exclude AI interpretation and manual Product work unless explicitly measured. Keep timing reports local and remove temporary instrumentation after use.
