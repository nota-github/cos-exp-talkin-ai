# Selected Story

- Story Key: `story-1.3`
- Title: `Core SQLite schema and repositories for chat runs`

# Quality Plan

| Criterion ID | Intended code evidence | Intended validation evidence |
| --- | --- | --- |
| `story-1.3:GOAL-1` | Add the core SQLite schema, migration runner, and chat-run repositories under `apps/desktop/src/main/persistence`. | Summarize the implemented persistence slice and its repository surface in this artifact. |
| `story-1.3:SCOPE-1` | Create migrations for `tasks`, `conversations`, `messages`, `run_records`, `run_stages`, `prompt_artifacts`, and `usage_records`. | Verify the migrated schema against `sqlite_master` in `npm run validate:story-1.3`. |
| `story-1.3:SCOPE-2` | Store task activity timestamps plus conversation model/mode and task usage categorization metadata in the persistence layer. | Exercise repository writes and reads for those fields in `npm run validate:story-1.3`. |
| `story-1.3:SCOPE-3` | Provide repository interfaces plus transaction helpers for grouped writes. | Force a transaction failure in `npm run validate:story-1.3` and confirm rollback. |
| `story-1.3:AC-1` | Expose a migration runner that can initialize a blank SQLite database file. | `npm run validate:story-1.3` checks that all required tables exist after migration. |
| `story-1.3:AC-2` | Implement repository methods to write and read Korean messages, run stages, prompt artifacts, and usage rows. | `npm run validate:story-1.3` inserts a sample task/conversation/message/run bundle and reads it back. |
| `story-1.3:AC-3` | Persist Korean source text in `messages.content_ko` without normalization or translation. | `npm run validate:story-1.3` asserts the stored Korean message exactly matches the source input. |
| `story-1.3:AC-4` | Provide transaction helpers for run completion and usage persistence. | `npm run validate:story-1.3` forces a failure mid-transaction and verifies there is no partial commit. |
| `story-1.3:VAL-1` | Keep migrations deterministic and inspectable. | `npm run validate:story-1.3` migrates a blank DB and inspects the resulting schema. |
| `story-1.3:VAL-2` | Keep repository CRUD deterministic for a sample chat run. | `npm run validate:story-1.3` writes and reloads the sample records. |
| `story-1.3:VAL-3` | Route multi-step run completion writes through a transaction helper. | `npm run validate:story-1.3` injects a rollback case and confirms no residual writes. |

# In Scope for This Run

- Implement the core SQLite schema and migration runner for `story-1.3`.
- Add repository interfaces and concrete repository methods for chat-run persistence.
- Add transaction helpers needed to atomically finish runs and store usage.
- Add story-scoped persistence tests and validation scripts.

# Deferred Work

- Wire the new persistence layer into IPC commands and screen projections in later stories.
- Add project tables, workbench tables, file assets, settings, and secret storage in later stories.
- Add price-table editing, usage estimate flags, and dashboard/history projections in later stories unless a selected story requires them earlier.
- Add non-macOS launcher coverage or a fully embedded SQLite runtime in a later packaging/runtime story if the desktop distribution scope expands beyond the current macOS baseline.

# Validation Performed

- `npm run validate:story-1.3` — PASS
  - Added root and desktop validation scripts in [`package.json`](../../../../package.json) and [`apps/desktop/package.json`](../../../../apps/desktop/package.json).
  - Covers `story-1.3:VAL-1`, `story-1.3:VAL-2`, and `story-1.3:VAL-3` via [`apps/desktop/tests/persistence.test.ts`](../../../../apps/desktop/tests/persistence.test.ts).
  - `story-1.3:VAL-1` now clears `PATH` before opening SQLite, proving the persistence slice resolves the app-managed launcher instead of a host shell lookup.
  - Includes an overlapping top-level transaction regression plus a plain root-scope repository isolation regression, so `story-1.3:AC-4` is exercised beyond the original rollback case.
- `npm test` — PASS
  - The broader desktop test suite also passes with the SQLite adapter in place.
- `npm run typecheck` — BLOCKED by pre-existing environment issue
  - Failure remains `TS2688: Cannot find type definition file for 'vite/client'`.
  - This matches the existing `story-1.2` environment blocker and is not introduced by `story-1.3`.

# Implementation Summary

- Replaced the unsupported `node:sqlite` baseline with a repo-managed SQLite launcher adapter at [`apps/desktop/resources/bin/sqlite3/darwin/sqlite3-launcher`](../../../../apps/desktop/resources/bin/sqlite3/darwin/sqlite3-launcher), so the desktop process no longer depends on a `PATH` lookup for `sqlite3`.
- Added the core schema migration in [`apps/desktop/src/main/persistence/database.ts`](../../../../apps/desktop/src/main/persistence/database.ts) for `tasks`, `conversations`, `messages`, `run_records`, `run_stages`, `prompt_artifacts`, and `usage_records`, with `PRAGMA user_version` tracking.
- Added async repository contracts and a concrete persistence surface in [`apps/desktop/src/main/persistence/types.ts`](../../../../apps/desktop/src/main/persistence/types.ts), [`apps/desktop/src/main/persistence/repositories.ts`](../../../../apps/desktop/src/main/persistence/repositories.ts), and [`apps/desktop/src/main/persistence/index.ts`](../../../../apps/desktop/src/main/persistence/index.ts).
- Switched transaction context tracking from one mutable global depth counter to `AsyncLocalStorage` plus top-level queueing, so sibling top-level writes are serialized while nested transactions still use savepoints correctly.
- Routed plain root-scope repository methods through the same shared-connection gate as top-level transactions, so reads and writes outside `transaction(...)` cannot observe or be rolled back with another caller's uncommitted work.
- Added `transaction(...)` and `completeRunWithUsage(...)` helpers so run completion and usage writes can be committed atomically and rolled back cleanly on failure.

# User Flows or Core Requirements

- `story-1.3:GOAL-1`: Korean-first chat runs now have a durable schema for the original Korean message, run lifecycle, optimized prompt artifacts, and usage ledger rows.
- `story-1.3:SCOPE-2`: task activity metadata is stored on `tasks.last_activity_at`, task usage classification is stored on `tasks.usage_category`, and model/mode metadata is stored on `conversations.selected_model` and `conversations.mode`.
- `story-1.3:AC-3`: the repository stores Korean source text verbatim in `messages.content_ko`; the test fixture uses a multiline Korean prompt and verifies exact equality after reload.
- `story-1.3:AC-4`: the persistence surface supports both generic grouped transactions and a story-specific completion helper, and all root-scope repository calls now share the same top-level gate so sibling callers cannot observe or corrupt uncommitted state.

# Acceptance / Success Criteria Mapping

| Criterion ID | Status | Evidence |
| --- | --- | --- |
| `story-1.3:GOAL-1` | PASS | Core schema and repositories added under [`apps/desktop/src/main/persistence`](../../../../apps/desktop/src/main/persistence). |
| `story-1.3:SCOPE-1` | PASS | Migration SQL covers all required tables in [`database.ts`](../../../../apps/desktop/src/main/persistence/database.ts). |
| `story-1.3:SCOPE-2` | PASS | Task activity/category plus conversation model/mode fields are stored and reloaded in [`types.ts`](../../../../apps/desktop/src/main/persistence/types.ts) and exercised by [`persistence.test.ts`](../../../../apps/desktop/tests/persistence.test.ts). |
| `story-1.3:SCOPE-3` | PASS | Repository interfaces plus `transaction(...)` and `completeRunWithUsage(...)` are implemented in [`repositories.ts`](../../../../apps/desktop/src/main/persistence/repositories.ts), with `AsyncLocalStorage`-backed transaction context and shared-connection gating for safe overlapping calls. |
| `story-1.3:AC-1` | PASS | `story-1.3:VAL-1` confirms a blank SQLite file migrates to the full required table set. |
| `story-1.3:AC-2` | PASS | `story-1.3:VAL-2` writes and reads a Korean message, run stage, optimized prompt artifact, and usage row. |
| `story-1.3:AC-3` | PASS | `story-1.3:VAL-2` asserts exact round-trip equality for the Korean multiline source prompt. |
| `story-1.3:AC-4` | PASS | `story-1.3:VAL-2` covers successful `completeRunWithUsage(...)`, `story-1.3:VAL-3` covers rollback safety, and the additional regressions verify both overlapping top-level writes and plain root-scope repository calls are serialized safely. |
| `story-1.3:VAL-1` | PASS | `npm run validate:story-1.3` |
| `story-1.3:VAL-2` | PASS | `npm run validate:story-1.3` |
| `story-1.3:VAL-3` | PASS | `npm run validate:story-1.3` |

# Risks and Open Questions

- `npm run typecheck` is still blocked by the workspace-level `vite/client` type resolution issue. That prevents authoritative TypeScript build evidence even though the authoritative story validation command (`npm run validate:story-1.3`) passes.
- The persistence adapter now resolves an app-managed launcher script first, and that launcher currently targets macOS `/usr/bin/sqlite3`. This removes shell `PATH` dependence for `story-1.3`, but wider platform packaging remains deferred.
- `tasks.project_id` is stored as nullable text without a foreign key because `projects` is explicitly out of scope for `story-1.3`.
- `messages.run_id` is stored as an indexed column without a foreign key in this slice to avoid introducing a circular FK dependency with `run_records.message_id` before later orchestration stories decide whether both directions must be enforced at the schema level.

# Structured Assessment

```json
{
  "success_criteria_status": "pass",
  "story_completion_status": "completed",
  "mvp_acceptance_status": "story_scope_pass",
  "release_evidence_status": "story_validation_passed",
  "package_readiness_status": "blocked_by_existing_typecheck_env_issue",
  "remaining_required_story_keys": [],
  "next_story_candidates": ["story-2.1", "story-3.1", "story-1.4"],
  "risks": [
    "The current launcher targets the macOS system sqlite3 binary at a fixed absolute path, so non-macOS or differently packaged distributions need a later runtime adaptation story.",
    "TypeScript build verification is still blocked by the existing vite/client environment issue recorded for story-1.2.",
    "The persistence layer is not wired into IPC or renderer projections yet by design; those integrations remain for dependent stories."
  ]
}
```

# Design Compliance Notes

- Status: `not_applicable`
- Reason: `story-1.3` is a persistence-only slice and does not change user-facing UI or flow.

# Design Differentiation Notes

- Status: `not_applicable`
- Intended archetype: `chat-first inbox`
- Visible choices made: `none; persistence-only slice`
- Layout silhouette difference from default/control: `not_applicable`
- Default convergence risks avoided: `not_applicable`
- Remaining weak spots: `none in this slice`

# Outcome Quality Notes

- Purpose clarity: This slice establishes the durable local data model required for Korean-first chat runs and later workspace recovery.
- Primary action: Not applicable in the renderer yet; the persistence API is the enabling layer for later submit/run flows.
- State/copy handling: Not applicable because no user-facing copy or interaction changes are included in `story-1.3`.
- Visible quality choices: Kept the implementation focused on restart-safe persistence, transaction safety, and auditable artifacts without expanding into unrelated UI work.
- Remaining weak spots: UI integration, recovery presentation, and dashboard projections remain deferred to dependent stories.
