## Selected Story

- Story Key: `story-5.3`
- Epic Key: `epic-5`
- Title: `Multi-panel workbench grid and persisted placement`

## Quality Plan

- `story-5.3:GOAL-1`
  Code: added a persistent SQLite-backed workbench service in `apps/desktop/src/main/workbench/service.ts` and wired it into the real desktop IPC path so the workbench behaves like a restart-safe multi-panel workspace.
  Test: `apps/desktop/tests/workbench-route.test.ts` now covers multi-panel visibility, slot persistence across service recreation, and panel close behavior.
  Artifact: this summary records the new persistence boundary, renderer controls, and remaining guided verification gap.
- `story-5.3:SCOPE-1`, `story-5.3:AC-1`, `story-5.3:AC-2`, `story-5.3:VAL-1`, `story-5.3:VAL-3`
  Code: preserved four named workbench slots and kept the renderer stage as a 2x2 grid on wide desktop with responsive collapse via `apps/desktop/src/renderer/routes/WorkbenchRoute.tsx` and `apps/desktop/src/renderer/styles.css`.
  Test: `workbench-route.test.ts` asserts two simultaneous open panels plus source/CSS evidence for the wide-grid and narrow-width fallback.
  Artifact: documented the workspace silhouette and panel-density outcome.
- `story-5.3:SCOPE-2`, `story-5.3:AC-3`, `story-5.3:VAL-2`
  Code: real panel placement now reads and writes `workbench_layouts` and `workbench_panels`, with recent-task projection rebuilt from persisted task/conversation/usage data.
  Test: `workbench-route.test.ts` recreates services against the same SQLite file and verifies slot placement survives restart.
  Artifact: documented that panel assignment is persisted; only transient focus is still derived rather than separately stored.
- `story-5.3:SCOPE-3`, `story-5.3:AC-4`
  Code: added `moveWorkbenchPanel` and `closeWorkbenchPanel` IPC commands plus renderer move/close controls and explicit empty-panel CTA copy.
  Test: `workbench-route.test.ts` verifies close behavior against the persistent path and checks renderer source for move/close command wiring and empty CTA wording.
  Artifact: documented that this slice includes basic button-driven move/close behavior only; drag-and-drop remains deferred.
- `story-5.3:AC-5`, `story-5.3:AC-6`
  Code: kept the recent-task rail separate from the workspace stage while making each panel visibly independent with local actions, bounded meta blocks, and explicit empty-slot states.
  Test: `workbench-route.test.ts` plus CSS/source assertions cover panel separation, action markup, and grid structure.
  Artifact: Design Compliance Notes and Design Differentiation Notes below capture the remaining live-UI verification gap.

## In Scope for This Run

- persistent workbench layout query/command behavior for the real desktop path
- multi-panel stage rendering with a wide-desktop 2x2 grid and narrower-width fallback
- basic panel move and close actions plus explicit empty-slot CTA language

## Deferred Work

- `story-5.4` panel-internal chat feeds, per-panel draft input, and activity logs
- drag-and-drop placement UX beyond the basic move buttons delivered here
- kanban and project screen work outside `story-5.3`
- `GUIDED_VERIFICATION_REQUIRED`: live browser verification of the actual `/workbench` surface is still blocked in this environment because `npm --workspace @talkin-ai/desktop run dev:renderer` fails with `vite: command not found`

## Validation Performed

- `npm test`
  Result: pass, `79/79` tests.
- `npm --workspace @talkin-ai/desktop run test -- workbench-route.test.ts`
  Result: pass. The current package test script still executes the full desktop suite, and the new `story-5.3` tests all passed within that run.
- `npm --workspace @talkin-ai/desktop run typecheck`
  Result: fail on the pre-existing environment/tooling issue `TS2688 Cannot find type definition file for 'vite/client'`.
- `npm --workspace @talkin-ai/desktop run dev:renderer`
  Result: fail with `vite: command not found`, so no browser or screenshot pass was possible in this run.

## Implementation Summary

- Added a real `WorkbenchService` in `apps/desktop/src/main/workbench/service.ts` that:
  - ensures a default persisted layout exists
  - projects recent tasks from canonical task/conversation/usage data
  - restores panel placement from `workbench_panels`
  - supports `openInWorkbench`, `moveWorkbenchPanel`, and `closeWorkbenchPanel`
  - keeps task continuation on the same `taskId`
- Wired that service into the desktop boot and IPC layers through:
  - `apps/desktop/src/main/index.ts`
  - `apps/desktop/src/main/ipc/register-ipc.ts`
  - `apps/desktop/src/preload/bridge.ts`
  - `apps/desktop/src/shared/ipc/contracts.ts`
- Updated the workbench renderer so the stage now reads as four independent panels instead of a single focused continuation surface:
  - move buttons between slots
  - close/empty behavior
  - explicit empty-rail and empty-panel guidance
  - preserved rail/stage separation
- Kept preview mode aligned with the new controls in `apps/desktop/src/renderer/routes/workbench-surface.ts`.
- Added `story-5.3` validation coverage in `apps/desktop/tests/workbench-route.test.ts` and added `validate:story-5.3` aliases in the workspace and desktop `package.json` files.

## Story Assessment

- `story-5.3:GOAL-1`
  Pass. The real desktop path now has a restart-safe multi-panel workbench instead of only the in-memory continuation preview.
- `story-5.3:SCOPE-1`
  Pass. Four slots remain available and the wide stage stays 2x2.
- `story-5.3:SCOPE-2`
  Pass. Panel assignment is persisted in SQLite and restored through the real query path.
- `story-5.3:SCOPE-3`
  Pass. Basic move and close actions are available; drag-and-drop is explicitly deferred.
- `story-5.3:AC-1`
  Pass. Tests verify at least two open task panels are visible at once.
- `story-5.3:AC-2`
  Pass by source-and-test evidence. The wide layout uses a 2x2 grid and collapses cleanly under the existing responsive breakpoint.
- `story-5.3:AC-3`
  Pass. Placement persists after service recreation against the same DB file.
- `story-5.3:AC-4`
  Pass. Empty panels now show explicit CTA copy, and close returns a panel to that state.
- `story-5.3:AC-5`
  Pass by source-and-test evidence. The stage reads as multiple bounded panels with local actions, not a tabbed single-chat surface.
- `story-5.3:AC-6`
  Pass by source-and-test evidence. Panel boundaries, local meta blocks, and per-panel actions keep neighboring task states visually separate.
- `story-5.3:VAL-1`
  Pass.
- `story-5.3:VAL-2`
  Pass.
- `story-5.3:VAL-3`
  Pass by source-and-test evidence, with live browser verification still deferred as guided follow-up.

## Design Compliance Notes

- status: `weak`
- `design-must-have-1`, `design-must-have-2`, `design-must-have-6`
  Preserved. The delivered surface is still a desktop workbench, not a generic dashboard or a single-thread chat page.
- `story-5.3:AC-5`
  Preserved. The workspace stage now contains multiple simultaneously usable panels with local controls.
- `story-5.3:AC-6`
  Preserved. Each panel has explicit borders, independent meta blocks, and isolated action controls.
- Weak spot
  No live renderer/browser capture was possible because the local renderer dev command still fails on missing `vite`.

## Design Differentiation Notes

- status: `pass`
- intended archetype: `chat-first inbox`
- visible choices made: the recent-task rail still behaves like an inbox selector, while the right side now reads as a dense operator workspace with four bounded task cells, per-panel actions, and explicit empty-slot language
- layout silhouette difference from default/control: the screen remains an asymmetric rail-plus-stage workspace, and the stage itself now reinforces the multi-chat desktop silhouette instead of feeling like one focused card plus placeholders
- default convergence risks avoided: avoided collapsing into a symmetric SaaS card grid, avoided single-chat tab metaphors, and kept Korean operator copy specific to ongoing work management
- remaining weak spots: drag-and-drop is still deferred, and the lack of a live browser pass means the visual assessment is based on source plus automated evidence

## Outcome Quality Notes

- purpose clarity: the surface now makes it clear that users can keep several tasks open, move them between slots, and leave empty capacity for the next task
- primary action: selecting a recent task or reorganizing an open panel now produces visible, persisted product state instead of only temporary in-memory placement
- state/copy handling: empty rail, empty panel, loading, error, move, and close states all have user-facing copy or explicit UI affordances
- visible quality choices: local panel actions, explicit empty-slot copy, bounded panel meta blocks, persistent slot restoration, and restart-safe recent-task projection
- remaining weak spots: live browser verification is still blocked by missing `vite`, and active focus is derived from persisted panel timestamps rather than stored as a separate field

## Structured Assessment

```json
{
  "success_criteria_status": "not_met",
  "story_completion_status": "completed",
  "mvp_acceptance_status": "story_slice_met",
  "release_evidence_status": "weak",
  "package_readiness_status": "story_slice_validated_not_release_ready",
  "remaining_required_story_keys": [
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
    "story-5.4",
    "story-5.5",
    "story-5.6"
  ],
  "risks": [
    "GUIDED_VERIFICATION_REQUIRED: the actual /workbench UI could not be browser-verified in this environment because the renderer dev command fails with `vite: command not found`.",
    "Desktop package typecheck still fails on the pre-existing missing `vite/client` type definition issue.",
    "Active panel focus is derived from persisted panel timestamps; panel assignment persistence is complete, but focus itself is not stored separately."
  ]
}
```
