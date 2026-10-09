# Revised Draft Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Overview
Enable operators to seamlessly update an existing ImpexCube draft job when client product details, quantities, or invoice data change, avoiding duplicate job generation on the Customs portal while retaining strict deduplication and recovery. Add an explicit `--fresh` option to allow generating a new target job when an old draft is genuinely canceled.

## File Structure & Responsibilities
- `src/runs/schema.ts`: Add `'superseded'` to `RunStateSchema`.
- `src/runs/journal.ts`:
  - Update `assertNoDuplicate` to ignore `'superseded'` runs.
  - Add `archive(runId: string)` to mark an existing run record superseded and archive it so `--fresh` can generate a new job without duplicate errors.
- `src/runs/prepare.ts`:
  - In `prepareRun`, when `runId` already exists and has `targetJobNo`:
    - If `old.inputHash !== inputHash`: update `old` with the revised `shipment`, recalculate `patch` against `sourceSnapshot`, update `inputHash`, transition to `target_identified` (resetting `savedSections`), and return the revised record.
    - If options specify `{ fresh: true }`: archive the old run and prepare fresh.
- `src/cli.ts`:
  - Add `--fresh` and `--revise` flags to `submit` and `run` commands.
  - Support `revise` as a first-class command (`bun run impex revise <folder>`).
  - In `upload-products` and `resume`, gracefully handle revised inputs or prompt to revise.
- `tests/workflow.test.ts`:
  - Add unit and integration tests verifying:
    1. Revising an existing target draft when inputs change updates the record and executes saves without creating a new copy.
    2. Superseded / archived runs do not block a `--fresh` run from copying.
    3. Unchanged inputs still skip redundant re-saves.

---

### Task 1: Update Schema and Journal for Superseded / Revision State
**Files:**
- `src/runs/schema.ts`
- `src/runs/journal.ts`
- `tests/duplicate.test.ts`

- [ ] Add `'superseded'` to `RunStateSchema` in `src/runs/schema.ts`.
- [ ] Add `archive(runId: string)` method in `Journal` (`src/runs/journal.ts`) that loads the record, sets state to `'superseded'`, saves it with an archived timestamp ID, and removes the active run file.
- [ ] Update `assertNoDuplicate` in `Journal` to ignore `old.state === 'superseded'`.
- [ ] Write unit tests in `tests/duplicate.test.ts` verifying that archived/superseded runs are ignored by `assertNoDuplicate`.
- [ ] Run `bun test tests/duplicate.test.ts` and verify it passes.

---

### Task 2: Implement Draft Revision in `prepareRun`
**Files:**
- `src/runs/prepare.ts`
- `tests/workflow.test.ts`

- [ ] Update `prepareRun` options signature to accept `{ fresh?: boolean }`.
- [ ] If `{ fresh: true }` and run exists: call `await journal.archive(runId)` before proceeding.
- [ ] If run exists with `targetJobNo` and `old.inputHash !== inputHash`:
  - Log that inputs have changed and existing draft `targetJobNo` is being revised.
  - Re-ingest the revised shipment and recalculate `patch` using `buildPatch(old.sourceSnapshot, shipment)`.
  - Canonicalize the patch if needed.
  - Update `old.shipment = shipment`, `old.patch = patch`, `old.inputHash = inputHash`, `old.savedSections = []`.
  - Transition `old` to `target_identified` with intent `"Revised draft with updated inputs"`.
  - Return `old`.
- [ ] Write unit tests in `tests/workflow.test.ts` verifying that changing inputs on an existing target draft triggers a revision rather than throwing an error.
- [ ] Run `bun test tests/workflow.test.ts` and verify it passes.

---

### Task 3: Expose Revision and Fresh Options in CLI
**Files:**
- `src/cli.ts`
- `README.md`

- [ ] Update `help` text and command parser in `src/cli.ts` to recognize `revise` and `--fresh`.
- [ ] Wire `--fresh` through `prepareRun(arg, session, journal, { fresh })`.
- [ ] Update `upload-products` to refresh `inputHash` so subsequent resumes do not fail with input mismatch.
- [ ] Update `README.md` documenting how to revise an existing draft vs create a fresh job.

---

### Task 4: Full Test Suite & Quality Verification
**Files:**
- All touched files

- [ ] Run `bun test` across all test suites.
- [ ] Run `bun run typecheck`.
- [ ] Run `bun run lint`.
- [ ] Run `bun run knip`.
