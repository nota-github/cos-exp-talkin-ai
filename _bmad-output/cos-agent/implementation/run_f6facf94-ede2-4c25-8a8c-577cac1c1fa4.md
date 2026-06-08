# Selected Story

- Story Key: `story-5.4`
- Title: `Workbench panel conversation continuation and status surface`

## Quality Plan

| Criterion ID | Intended Evidence | Result |
| --- | --- | --- |
| `story-5.4:GOAL-1` | Persisted workbench query returns panel-level conversation/runs and renderer gives each slot its own chat/status/draft surface. | PASS |
| `story-5.4:SCOPE-1` | `apps/desktop/src/main/workbench/service.ts`, `apps/desktop/src/shared/ipc/contracts.ts`, `apps/desktop/src/renderer/routes/WorkbenchRoute.tsx` add panel chat feed + status header data. | PASS |
| `story-5.4:SCOPE-2` | `apps/desktop/src/main/chat/service.ts` continues an existing conversation; `WorkbenchRoute.tsx` submits panel follow-ups with slot-scoped reducer state. | PASS |
| `story-5.4:SCOPE-3` | `apps/desktop/src/renderer/routes/workbench-surface.ts` derives panel activity summaries from runs/messages and renderer shows them as subordinate activity cards. | PASS |
| `story-5.4:AC-1` | Persistence-backed test verifies two open panels keep separate histories and run summaries. | PASS |
| `story-5.4:AC-2` | Continuation path reuses `conversationId`/`taskId` and blocks overlap on an in-flight run. | PASS |
| `story-5.4:AC-3` | Reducer test verifies draft/loading/error isolation by slot; renderer uses per-slot reducer state. | PASS |
| `story-5.4:AC-4` | Panel header badges, run feedback, meta row, and recent activity section are rendered from source-of-truth panel data. | PASS |
| `story-5.4:AC-5` | Workbench panel feed/activity/composer sections and styling keep panels visually independent in source and tests. | PASS with guided live verification still needed |
| `story-5.4:AC-6` | Status/activity are present but secondary to the conversation feed by layout and styling. | PASS with guided live verification still needed |
| `story-5.4:VAL-1` | `apps/desktop/tests/workbench-route.test.ts` adds a two-panel continuation integration test. | PASS |
| `story-5.4:VAL-2` | `apps/desktop/tests/workbench-route.test.ts` adds reducer isolation coverage. | PASS |
| `story-5.4:VAL-3` | `apps/desktop/tests/workbench-route.test.ts` compares chat feed history with workbench panel history for the same task. | PASS |
| `design-must-have-2` | Workbench remains a dense desktop workspace instead of reverting to a single-chat view. | PASS by source; live verification pending |
| `design-must-have-6` | Workbench remains the multi-task continuation surface. | PASS |
| `design-reference-1` | Copy and flow keep Korean-first continuation invisible to the user except as task continuity. | PASS |
| `design-layout-1` | Status/activity are compact, task-management-oriented, and subordinate to chat content. | PASS by source; live verification pending |

## In Scope for This Run

- `story-5.4` only: panel-level conversation continuation, status surface, activity summary, and slot-scoped draft submission
- Shared query/IPC updates only where required to make the selected workbench slice function
- Focused automated coverage for continuation, isolation, and chat/workbench history consistency

## Deferred Work

- `story-5.5+` kanban actions, project editing, and cross-surface richer status editing
- Manual or browser-guided verification on the real desktop `/workbench` shell once a local renderer target is runnable
- Any broader visual redesign outside the workbench slice

## Validation Performed

- `npm test` PASS
  - `82/82` tests passed, including new `story-5.4:VAL-1`, `story-5.4:VAL-2`, and `story-5.4:VAL-3`
- `npm run validate:story-5.4` PASS
  - Delegates to the same authoritative test path and passed with the same `82/82` result
- `npm run dev:renderer -- --host 127.0.0.1 --port 4173` BLOCKED
  - `vite: command not found`, so live browser verification against the actual `/workbench` UI could not be completed in this environment

## Implementation Summary

- Added a shared chat projection helper in `apps/desktop/src/main/chat/feed-projection.ts` so chat and workbench read the same persisted message/run summaries.
- Extended `submitPrompt` continuation in `apps/desktop/src/main/chat/service.ts` so a panel follow-up reuses an existing `conversationId`/`taskId`, refreshes conversation metadata, and rejects overlap when the same conversation already has an in-flight run.
- Extended `getWorkbenchLayout` in `apps/desktop/src/main/workbench/service.ts` and `apps/desktop/src/shared/ipc/contracts.ts` so each panel now carries its own `conversation`, `messages`, `runs`, and `activeRun`.
- Rebuilt the renderer workbench surface in `apps/desktop/src/renderer/routes/WorkbenchRoute.tsx`, `apps/desktop/src/renderer/routes/workbench-surface.ts`, and `apps/desktop/src/renderer/styles.css` around slot-scoped reducer state, per-panel feed/activity/composer sections, optimistic pending messages, and active-run polling.
- Expanded invalidation/query handling in `apps/desktop/src/renderer/lib/ipc/query-client.ts` and `apps/desktop/src/main/ipc/register-ipc.ts` so workbench layout refetches on conversation/run changes that now affect panel history.
- Added story-specific validation coverage and script wiring in `apps/desktop/tests/workbench-route.test.ts`, `apps/desktop/tests/history-inspection.test.ts`, and `apps/desktop/package.json`.

## Design Compliance Notes

- status: `weak`
- `design-must-have-2`: source now reads as a multi-panel desktop workspace with separate feed/activity/composer zones per panel, but real-shell visual confirmation is still pending
- `design-must-have-6`: pass by implementation because the workbench is the continuation surface and each panel can submit same-task follow-ups
- `design-reference-1`: pass by copy/flow because users stay in Korean and the continuation path reuses the same task implicitly
- `design-layout-1`: source and CSS make status/activity secondary to conversation content, but this still needs live viewport verification on `/workbench`
- GUIDED_VERIFICATION_REQUIRED: real desktop `/workbench` visual pass could not be run because the renderer target was unavailable (`vite: command not found`)

## Design Differentiation Notes

- status: `weak`
- intended archetype: `chat-first inbox`
- visible choices made: each workbench panel is now an independent inbox-like workspace with its own feed, status strip, recent activity cards, and Korean follow-up composer instead of a plain metadata card
- layout silhouette difference from default/control: panel interiors are split into conversation, activity, and continuation sections rather than a single generic card body; this makes the 2x2 workbench read as multiple active workspaces, not duplicated static cards
- default convergence risks avoided: avoided collapsing back to a cold admin grid by keeping Korean copy, conversation-first surfaces, and mint/blue status treatment tied to the optimization concept
- remaining weak spots: no live browser/electron screenshot evidence was captured because the local renderer could not be launched in this environment

## Outcome Quality Notes

- purpose clarity: each populated panel now explains that the user is continuing the same task/conversation, not opening a new thread
- primary action: the per-panel primary action is a Korean follow-up composer that submits back into the same task
- state/copy handling: slot-scoped reducer state preserves independent draft, loading, success, and error feedback; failed panel submission keeps the draft intact
- visible quality choices: recent activity is compact and secondary, while the conversation feed remains the dominant surface inside each panel
- remaining weak spots: preview/browser verification on the real `/workbench` route remains blocked by missing local Vite runtime tooling

## Structured Assessment

```json
{
  "success_criteria_status": "partial",
  "story_completion_status": "implemented_with_guided_verification_required",
  "mvp_acceptance_status": "partial",
  "release_evidence_status": "partial",
  "package_readiness_status": "story_slice_ready_pending_live_workbench_verification",
  "remaining_required_story_keys": [
    "story-5.5",
    "story-5.6",
    "story-5.7",
    "story-5.8"
  ],
  "next_story_candidates": [
    "story-5.5",
    "story-5.6"
  ],
  "risks": [
    "Real `/workbench` browser/electron verification is still outstanding because the local renderer target could not be launched (`vite: command not found`).",
    "The new same-conversation overlap guard depends on runs reaching `completed` or `failed`; if background workflow orchestration stalls, panel follow-up will correctly refuse to stack another run but the user will need the earlier run state to recover."
  ]
}
```
