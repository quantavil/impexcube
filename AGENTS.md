# Working on Impex Cube automation

Read [README.md](README.md) for operation and [FIELD_POLICY_SPEC.md](FIELD_POLICY_SPEC.md) for business rules. The latest user decisions govern. This project owns mapped job headers; Product Excel generation, duty/HSN resolution and workbook upload belong to sibling `impexcube-products`.

## Process a shipment

Run commands from this repository root. Resolve branch/year once and use them throughout: `--branch` overrides `IMPEX_DEFAULT_BRANCH` (one is required); `--year` overrides `IMPEX_FINANCIAL_YEAR`, otherwise use the current Indian financial year. Supported branches are DELHI and MORADABAD. Credentials stay in ignored `.env`; use `IMPEX_HEADED=1` when the user wants to watch.

1. User supplies `incoming/<customs-code>_<number>/` and conversational instructions. Run `bun run impex extract <folder>` with the resolved context. Read its returned `artifactPath`, `input`, `documents` and interpretation instructions. No user-authored manifest is required.
2. As the assisting AI, read original documents and converted sources. Complete the internal `shipment.json` yourself; CLI extraction does not perform unattended AI interpretation. Do not introduce a provider service or ask the user to author JSON.
3. Run `validate`. This checks shape, file hashes and evidence; policy and native required-field validation happen during preparation/execution. Resolve document conflicts or ask only for information that cannot be established from available evidence.
4. Run optional `prepare` for a preview, or `run` to prepare and automatically save. The script discovers the reference, resolves the exporter master and folder customs, merges policy, then creates native New Job or resumes the recorded target.
5. Execution initializes current invoices, clicks native Exchange Rate Update once, saves General → Shipment → Invoice → F&I → Third Party, then verifies fresh saved target/source headers. Report target, status and minimal warnings. Products, uploads, approvals and filing remain manual.

## Prepare shipment.json correctly

Use `ShipmentArtifactSchema`, `ShipmentSchema`, `FieldSchema` and `InstructionsSchema` in `src/schemas.ts` as the exact contracts. Do not copy an obsolete payload or journal shape.

- Preserve `formatVersion: 1`, canonical `inputFolder`, resolved `shipment.context` and original file paths/hashes from `extract`.
- Set each file's role after inspecting it: invoice, packing, instructions, reference or document. A reference file cannot support current values. A completed example intended only for reference must have `referenceOnly: true`, which blocks processing.
- Put General/Shipment fields in `shipment.fields`. Put one entry per current document invoice in `shipment.invoices`, with Invoice/F&I/Third Party fields inside that entry. Use exact field keys from `policy/fields.ts`.
- Keep identifiers and decimal amounts as strings; use YYYY-MM-DD dates. Unknown is `{ "value": null, "status": "unknown", "evidence": [] }`. Blank and zero are explicit values and require evidence or an explicit instruction.
- Each document-backed value needs an exact quote and location: `{ "file": "invoice.pdf", "page": 1, "raw": "INV123" }` or `{ "file": "invoice.xlsx", "line": 12, "raw": "10685.00" }`. Locations refer to `extract` output; spreadsheet evidence uses generated lines. Invented quotes or cell coordinates are rejected.
- Keep original document values even if fixed policy overrides them. The script merges previous values; do not prefill previous data into current evidence.
- Store explicit user directions separately in `instructions`, for example `{ "invoice[0].charges.freight": "25.00" }`. Invoice instruction indexes address the artifact's invoice array before automatic sorting. Do not fabricate `user-instructions` evidence inside document fields; ingestion creates that provenance.
- Current invoices are sorted ascending by number for policy fallback and native row order. Normalized duplicate numbers block creation. Preserve real invoice identities; never manufacture rows to match the reference count.
- Inspect original PDF visuals and spreadsheet formulas without cached values. Extraction text alone does not establish semantic truth. Never extract Product rows for this workflow.

For revised files, repeat `extract` to obtain fresh text and hashes; it preserves the existing interpreted artifact. Review the originals, update affected evidence and the artifact's file list/hashes, then `run` the same folder/context. Never refresh hashes merely to bypass stale-evidence detection.

## Where changes belong

| Change | File |
|---|---|
| Field source, fixed/missing values, aliases, conditions, business checks or mappings | `src/policy/fields.ts` |
| Applying field rules and building operations | `src/policy/merge.ts` |
| Previous-job eligibility and preference | `src/policy/select.ts` |
| Document readers / evidence handling | `src/documents/read.ts` / `evidence.ts` |
| Commands / pipeline coordination | `src/cli.ts` / `workflow.ts` |
| Native controls, navigation, creation, saves, rates and readback | `src/website/` |
| Validated shapes / normalization / durable recovery / reporting | `src/schemas.ts` / `values.ts` / `journal.ts` / `report.ts` |

Use Bun, Zod 4, xlsx, xberg with OCR and Playwright. Derive TypeScript types from schemas. Keep `bun.lock` synchronized with dependency changes. Remove duplicate reads, routing and obsolete code before adding abstractions, dependencies or caches. Keep useful regression coverage; avoid tests that only restate a schema or assert implementation structure.

## Policy invariants

- Fixed always wins, including blank/zero/false; retain current evidence and warn briefly on disagreement. System Locked means no automation write, even if the native control is editable.
- Doc Only uses current evidence/instructions; Doc → Past Fallback uses current, then previous, then empty with warning. Null/unknown is unavailable; explicit blank/zero never triggers fallback. Native-required blanks must stop actionably rather than receive invented values.
- Prefer latest eligible exporter + consignee; otherwise latest exporter within branch/year. Missing consignee uses exporter only; with an explicit IEC, stop at the first eligible exporter header. Name-only searches must establish exporter/IEC ambiguity before accepting a match. Explicit IEC discovery scans newest first and may stop at the latest matching consignee. Do not narrow candidates using native consignee search: it is not proven to include every name equivalent under our normalization.
- Previous job data is reference only. Always use native New Job for a new shipment. Resolve an existing unique registered exporter/branch master even without previous jobs; registration remains manual. Target must differ from reference.
- Current invoices determine count and identities. Previous invoice fallback uses corresponding ascending index; absent rows yield empty fallback, never cloned values. New invoices are initialized regardless of whether a reference exists.
- Derive customs from the shipment folder code; resolve city uniquely against the live master. Numeric suffix is a sequence number; no customs whitelist. Malformed/missing/ambiguous codes stop before native Save. Account branch is separate.
- Missing gross/net weight units default to KGS through central field policy. Explicit units or blanks win; previous units are not inherited.
- Packing From/To/Unit stay empty. Never add numbered packing rows. Total Packages/Unit are separate document fields.
- Preserve current terms before central site-group aliases such as DAP → CIF. Notify Party maps to Third Party, distinct from Buyer. Absent Third Party values follow the central clearing policy.
- By default, preserve the previous Marks & Nos declaration, including LUT/RODTEP text, and update only its recognized package count/range from current evidence. Recognize carton/package/box wording. Do not ask again to retain the declaration for a recognized update; explicit complete instructions override it. Ambiguous formats or inconsistent ranges still stop for review.
- Unknown charges are empty, not zero. Native empty-to-zero readback tolerance applies only where explicitly mapped; it does not change evidence.
- Eight auxiliary controls in `UNSUPPORTED_FIELDS` lack inspected native mappings. Report the limitation; never guess selectors or claim those controls were applied.

## Mutation and recovery invariants

- Only mapped allowed controls are writable. Never edit source jobs, Product rows, completed examples, attachments or filing controls.
- Hold the local runs-directory lock through intake/preparation/mutation. Do not break stale locks automatically. Atomic intent records must be durable before native New Job Save or invoice Add.
- Save New Job once; capture target immediately. Persist invoice index/number/date before Add. Uncertain creation/Add never retries blindly. A transient failure before any creation intent may safely retry preflight.
- Existing shipments keep their recorded target. Changed input/policy re-merges there; `resume` requires unchanged inputs. Policy identity includes executable policy code, not only field metadata. Preserve uncertain intents before revising inputs.
- Verified unchanged runs check strict artifact/context/folder and original hashes before returning the saved report; skip document conversion and browser login only when both input and policy fingerprints match. Changed or unverified runs still validate evidence before login.
- Existing invoice rows must match the normalized current prefix before Add or pending-intent clearing. Mismatched identities, extra rows or currency changes require manual reconciliation. Routine execution never deletes jobs or invoice rows.
- For uncertain creation without a target, identify the exact job then use `resolve-target <run-id> <job>`. Matching exporter/context alone is insufficient proof of ownership. Never reset a journal or choose an unrelated target.
- Check branch/year, session and target/master identity before writes. Await Save and dependent Web Forms postbacks. AutoPostBack text/decimal changes must blur inside the awaited action; skip already-correct values to avoid waiting for absent requests.
- Set checkboxes/selectors before final text values in section fills; native option postbacks can regenerate dependent text such as Marks & Nos.
- Prefer inspected native routes and invoice-row selection. Reuse context only while visible controls/job/invoice identity agree. No navigation framework/cache. Read mapped controls in one DOM snapshot per section.
- Reuse the prepared native New Job form only on its inspected URL, after session/context, empty job number and exporter master identity checks. If navigation lost the form, resolve the master again; a changed master stops creation.
- Native Exchange Rate Update runs exactly once per draft-processing attempt/resume before section saves, even for unchanged rates. Never write rates manually or block current rates using an old preview. Canonical invoice currency must match the native rate frame; multiple currencies require manual handling.
- Skip already-correct controls/sections. Check persisted values only during final fresh target/source verification after all saves, including exact decimal foreign amount × saved rate rounded to two INR decimals. Collapse whitespace for text comparison; FOB-disabled freight accepts mapped empty/zero behavior.

## Verify and report changes

After code changes run all four checks:

```bash
bun test
bun run typecheck
bun run lint
bun run knip
```

Keep meaningful regressions for changed behavior, especially evidence, policy precedence, identity, duplicates, uncertain Save/Add and final verification. Local fixtures do not establish live acceptance. A live mutation test needs genuine new-shipment inputs or an explicitly designated disposable target.

Update README when commands, operation or limitations change; update FIELD_POLICY_SPEC and its central implementation together for business changes. Do not add duplicate policy/config sources or legacy compatibility paths. Keep credentials, source documents, reports, journals and login state out of Git; preserve existing audit records separately.

Report actual check results, material limitations and whether live actions occurred. For timing requests include elapsed time, visited URLs/navigation and whether Saves occurred; distinguish fresh creation from unchanged reruns and exclude AI interpretation/manual Product work unless measured. Remove temporary instrumentation after use.
