# Selected Story

- Story Key: `story-3.2`
- Epic Key: `epic-3`
- Title: `Optimization stage orchestration and prompt artifact storage`

## Quality Plan

| Criterion ID | Intended Code/Test/Artifact Evidence |
| --- | --- |
| `story-3.2:GOAL-1` | Add a main-process optimization orchestrator that loads stored Korean runs, calls the local Translation MCP adapter, and persists optimized prompt artifacts. |
| `story-3.2:SCOPE-1` | Record `queued -> optimizing -> optimized | failed` transitions in persisted `run_records` and `run_stages`. |
| `story-3.2:SCOPE-2` | Pass the selected `optimizationMode` plus stored `conversation.summary` into the sidecar optimization payload. |
| `story-3.2:SCOPE-3` | Store `optimized_prompt_en` and `preservation_check` rows in `prompt_artifacts` on optimization success. |
| `story-3.2:AC-1` | Guard optimization so only runs with stored Korean source content are advanced into the local optimization path. |
| `story-3.2:AC-2` | Persist sidecar outputs into `prompt_artifacts` and verify them with automated tests. |
| `story-3.2:AC-3` | Mark local optimization failures as recoverable `failed` runs and prove the cloud handoff seam is not called on failure. |
| `story-3.2:AC-4` | Verify all four optimization modes are forwarded distinctly to the fake sidecar payload. |
| `story-3.2:VAL-1` | Add a mode-matrix test that captures fake sidecar optimize payloads for `balanced`, `savings`, `quality`, and `long_context`. |
| `story-3.2:VAL-2` | Add a success-path test that confirms persisted run-stage transitions and `prompt_artifacts` rows after optimization. |
| `story-3.2:VAL-3` | Add a failure-path test that injects a local optimization error and proves the cloud dispatch seam is not invoked. |

## In Scope for This Run

- `apps/desktop/src/main/workflows/optimization-stage.ts` persistent optimization-stage orchestrator
- `apps/desktop/src/main/chat/service.ts` background scheduling seam after durable `submitPrompt`
- `apps/desktop/src/main/index.ts` main-process wiring from durable submit into local optimization
- `apps/desktop/tests/optimization-stage.test.ts` story-scoped automated validation
- `apps/desktop/package.json` and root `package.json` validation aliases for `story-3.2`

## Deferred Work

- `story-3.3` cloud inference gateway and normalized provider failures
- `story-3.4` response restoration and completed-run handling
- renderer invalidation for background workflow completion beyond the current command-triggered refresh path
- richer preservation extraction heuristics, especially Korean named-entity detection beyond the current lightweight constraints/structure parser

## Validation Performed

- `npm --workspace @talkin-ai/desktop run validate:story-3.2`
  - Result: PASS
  - Evidence: `35/35` desktop tests passed, including the `story-3.2` contract-alignment retry cases.
- `npm --workspace @talkin-ai/desktop run test`
  - Result: PASS
  - Evidence: full desktop suite remained green after the Translation MCP boundary normalization.
- `npm --workspace @talkin-ai/desktop run typecheck`
  - Result: FAIL
  - Reason: pre-existing workspace blocker `TS2688 Cannot find type definition file for 'vite/client'`.

## Implementation Summary

- Added a main-process optimization orchestrator in `apps/desktop/src/main/workflows/optimization-stage.ts` that:
  - claims only `queued` runs,
  - loads the stored Korean source from `messages.content_ko`,
  - forwards `optimizationMode` plus stored `conversations.summary` to the Translation MCP adapter,
  - records `optimizing` and `optimized | failed` stage rows,
  - stores `optimized_prompt_en` and `preservation_check` artifacts on success,
  - writes recoverable `local_optimization_*` error codes on failure.
- Added a narrow normalization layer in `apps/desktop/src/main/translation/service.ts` so renderer/shared IPC modes stay `balanced|savings|quality|long_context`, but the sidecar-facing Translation MCP request now uses the approved contract shape:
  - mode values normalize to `default|cost_saver|quality|long_context`,
  - preservation input is flattened into `outputHints` plus `namedEntities`,
  - optimize results use `preservationChecks.entitiesPreserved|constraintsPreserved|outputFormatPreserved`.
- Connected durable submit to background optimization in `apps/desktop/src/main/chat/service.ts`, so the Korean prompt is committed first and the local optimization stage starts only after the run exists in SQLite.
- Wired the real Electron main process in `apps/desktop/src/main/index.ts` to create one Translation MCP adapter and one persistent optimization orchestrator against the app DB path.
- Updated `apps/desktop/src/main/workflows/optimization-stage.ts` to persist the approved preservation artifact shape, reusing the normalized sidecar request rather than storing the prior app-internal preservation object.
- Added and updated automated coverage in `apps/desktop/tests/optimization-stage.test.ts` and `apps/desktop/tests/translation-mcp.test.ts` to verify the approved Translation MCP boundary contract instead of the old pass-through payload.

## Criterion Assessment

- `story-3.2:GOAL-1` PASS: stored Korean requests now run through a local optimization orchestrator that persists the optimized prompt artifacts instead of stopping at `queued`.
- `story-3.2:SCOPE-1` PASS: `queued -> optimizing -> optimized | failed` is recorded through `run_records.status` plus appended `run_stages` rows in `apps/desktop/src/main/workflows/optimization-stage.ts`.
- `story-3.2:SCOPE-2` PASS: the sidecar optimize payload now includes the selected mode and stored `conversations.summary` in the approved contract shape, with mode normalization and `outputHints` / `namedEntities` verified in `apps/desktop/tests/translation-mcp.test.ts` and `apps/desktop/tests/optimization-stage.test.ts`.
- `story-3.2:SCOPE-3` PASS: successful optimization writes both `optimized_prompt_en` and a `preservation_check` artifact whose stored request/result keys match the approved Translation MCP contract.
- `story-3.2:AC-1` PASS: the orchestrator only advances persisted runs that still have a stored Korean source message; the optimization input is read from `messages.content_ko`, and missing-source runs are failed locally instead of invoking the sidecar.
- `story-3.2:AC-2` PASS: sidecar outputs are persisted as auditable prompt artifacts, and the preservation-check artifact now stores the normalized request plus `entitiesPreserved|constraintsPreserved|outputFormatPreserved`.
- `story-3.2:AC-3` PASS: local optimization failures become recoverable `failed` runs with `local_optimization_*` error codes, and the optional cloud handoff seam is proven not to run on failure.
- `story-3.2:AC-4` PASS: `balanced`, `savings`, `quality`, and `long_context` are all forwarded distinctly to the fake sidecar as `default`, `cost_saver`, `quality`, and `long_context`.
- `story-3.2:VAL-1` PASS: `apps/desktop/tests/optimization-stage.test.ts` captures fake optimize payloads for all four normalized sidecar modes and asserts the stored conversation summary is forwarded.
- `story-3.2:VAL-2` PASS: the success-path test proves persisted `run_stages`, `run_records.status=optimized`, and `prompt_artifacts` rows after background optimization.
- `story-3.2:VAL-3` PASS: the failure-path test injects a `TranslationMcpRuntimeError`, confirms `run_records.status=failed`, and asserts the cloud dispatch seam is not called.

## Design Compliance Notes

- Status: `not_applicable`
- Reason: `story-3.2` is a main-process orchestration and persistence slice with no renderer layout or copy changes.

## Design Differentiation Notes

- Status: `not_applicable`
- Intended archetype: `chat-first inbox`
- Visible choices made: none in this run
- Layout silhouette difference from default/control: none in this run
- Default convergence risks avoided: no UI changes were made
- Remaining weak spots: live renderer refresh after background optimization remains deferred to a later workflow/query-sync slice

## Outcome Quality Notes

- Purpose clarity: the app now has a real local optimization execution step between durable Korean input storage and any future cloud dispatch, and that step now matches the approved Translation MCP boundary contract instead of a fake pass-through shape.
- Primary action: the user-visible `submitPrompt` flow still stores the Korean request first, while the new workflow continues asynchronously in the main process.
- State/copy handling: no renderer copy changed, but persisted run state is now meaningfully richer because `queued`, `optimizing`, `optimized`, and `failed` survive restart in canonical tables.
- Visible quality choices: the implementation keeps raw Korean out of any cloud handoff seam on failure, stores auditable optimized artifacts, and normalizes the sidecar request/result contract at the main-process boundary so later cloud and restore stories can build on an authoritative shape.
- Remaining weak spots: there is still no cloud inference, response restoration, or renderer invalidation broadcast when background optimization completes.

## Structured Assessment

```json
{
  "success_criteria_status": "partial",
  "story_completion_status": "completed",
  "mvp_acceptance_status": "partial",
  "release_evidence_status": "pass_for_story_slice",
  "package_readiness_status": "warning_preexisting_typecheck_gaps_remain",
  "remaining_required_story_keys": [
    "story-3.3",
    "story-3.4",
    "story-3.5",
    "story-4.1",
    "story-4.2",
    "story-4.3",
    "story-4.4",
    "story-5.1",
    "story-5.2",
    "story-5.3",
    "story-5.4",
    "story-5.5",
    "story-5.6",
    "story-5.7",
    "story-5.8",
    "story-6.1",
    "story-6.2",
    "story-6.3",
    "story-6.4"
  ],
  "next_story_candidates": [
    "story-3.3",
    "story-3.4"
  ],
  "risks": [
    "Desktop package typecheck is still blocked by the pre-existing missing vite/client type definition issue.",
    "Background optimization completion is persisted correctly, but the renderer still has no dedicated system invalidation path for post-submit workflow updates.",
    "The product still lacks cloud inference, English-response persistence, and Korean response restoration, so the end-to-end differentiating loop is not complete."
  ]
}
```
