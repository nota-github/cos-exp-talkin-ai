# Selected Story

- Story Key: `story-5.8`
- Title: `Project file asset attachment and listing`

# Quality Plan

| Criterion ID | Evidence |
| --- | --- |
| `story-5.8:GOAL-1` | Implemented project-file attach/unlink commands, persistent storage copy, and project-detail file rendering across [service.ts](/Users/cos_dev/CoS/projects/pokemon/runtime/workspaces/talkin-ai/apps/desktop/src/main/projects/service.ts:356), [register-ipc.ts](/Users/cos_dev/CoS/projects/pokemon/runtime/workspaces/talkin-ai/apps/desktop/src/main/ipc/register-ipc.ts:1598), and [ProjectsRoute.tsx](/Users/cos_dev/CoS/projects/pokemon/runtime/workspaces/talkin-ai/apps/desktop/src/renderer/routes/ProjectsRoute.tsx:265). |
| `story-5.8:SCOPE-1` | Added renderer file-picker action and attach/unlink IPC commands in [ProjectsRoute.tsx](/Users/cos_dev/CoS/projects/pokemon/runtime/workspaces/talkin-ai/apps/desktop/src/renderer/routes/ProjectsRoute.tsx:265) and [contracts.ts](/Users/cos_dev/CoS/projects/pokemon/runtime/workspaces/talkin-ai/apps/desktop/src/shared/ipc/contracts.ts:472). |
| `story-5.8:SCOPE-2` | Added app-managed file storage helper and canonical `file_assets` writes in [storage.ts](/Users/cos_dev/CoS/projects/pokemon/runtime/workspaces/talkin-ai/apps/desktop/src/main/files/storage.ts:1) and [service.ts](/Users/cos_dev/CoS/projects/pokemon/runtime/workspaces/talkin-ai/apps/desktop/src/main/projects/service.ts:356). |
| `story-5.8:SCOPE-3` | Updated project detail file list and unlink behavior in [ProjectsRoute.tsx](/Users/cos_dev/CoS/projects/pokemon/runtime/workspaces/talkin-ai/apps/desktop/src/renderer/routes/ProjectsRoute.tsx:958) and in-memory IPC staging in [register-ipc.ts](/Users/cos_dev/CoS/projects/pokemon/runtime/workspaces/talkin-ai/apps/desktop/src/main/ipc/register-ipc.ts:1017). |
| `story-5.8:AC-1` | `attachProjectFile` is exposed end-to-end through shared IPC, preload, and renderer command usage. Verified by `story-5.8` attach test in [projects-route.test.ts](/Users/cos_dev/CoS/projects/pokemon/runtime/workspaces/talkin-ai/apps/desktop/tests/projects-route.test.ts:827). |
| `story-5.8:AC-2` | Attached files are copied into app-managed storage and persisted in `file_assets`; verified by stored path and metadata assertions in [projects-route.test.ts](/Users/cos_dev/CoS/projects/pokemon/runtime/workspaces/talkin-ai/apps/desktop/tests/projects-route.test.ts:865). |
| `story-5.8:AC-3` | Project detail continues to surface file name, MIME type, and size from canonical metadata in [service.ts](/Users/cos_dev/CoS/projects/pokemon/runtime/workspaces/talkin-ai/apps/desktop/src/main/projects/service.ts:152) and [ProjectsRoute.tsx](/Users/cos_dev/CoS/projects/pokemon/runtime/workspaces/talkin-ai/apps/desktop/src/renderer/routes/ProjectsRoute.tsx:980). |
| `story-5.8:AC-4` | Unlink removes project metadata without deleting the original local file; policy is explicit in UI copy and verified in [projects-route.test.ts](/Users/cos_dev/CoS/projects/pokemon/runtime/workspaces/talkin-ai/apps/desktop/tests/projects-route.test.ts:905). |
| `story-5.8:AC-5` | The file area remains a compact side-panel helper with lightweight copy and controls in [ProjectsRoute.tsx](/Users/cos_dev/CoS/projects/pokemon/runtime/workspaces/talkin-ai/apps/desktop/src/renderer/routes/ProjectsRoute.tsx:960) and [styles.css](/Users/cos_dev/CoS/projects/pokemon/runtime/workspaces/talkin-ai/apps/desktop/src/renderer/styles.css:780). |
| `story-5.8:AC-6` | Empty and populated states both expose a direct next action (`첫 파일 연결` / `파일 추가`) in [ProjectsRoute.tsx](/Users/cos_dev/CoS/projects/pokemon/runtime/workspaces/talkin-ai/apps/desktop/src/renderer/routes/ProjectsRoute.tsx:967) and [projects-route.test.ts](/Users/cos_dev/CoS/projects/pokemon/runtime/workspaces/talkin-ai/apps/desktop/tests/projects-route.test.ts:937). |
| `story-5.8:VAL-1` | `npm test` passed with sample-file attach and project-detail listing assertions in [projects-route.test.ts](/Users/cos_dev/CoS/projects/pokemon/runtime/workspaces/talkin-ai/apps/desktop/tests/projects-route.test.ts:827). |
| `story-5.8:VAL-2` | `npm test` passed with restart persistence assertions for metadata and managed storage path in [projects-route.test.ts](/Users/cos_dev/CoS/projects/pokemon/runtime/workspaces/talkin-ai/apps/desktop/tests/projects-route.test.ts:881). |
| `story-5.8:VAL-3` | `npm test` passed with unlink behavior assertions proving metadata removal and original-file preservation in [projects-route.test.ts](/Users/cos_dev/CoS/projects/pokemon/runtime/workspaces/talkin-ai/apps/desktop/tests/projects-route.test.ts:905). |

# In Scope for This Run

- Project detail file attach action
- App-managed storage copy for local project assets
- File metadata persistence and project-detail listing
- File unlink action with explicit original-file policy copy

# Deferred Work

- File preview, parsing, OCR, or semantic indexing
- Bulk multi-file upload
- Managed-copy garbage collection after unlink

# Validation Performed

- `npm test`
  - Result: pass (`95` tests, `0` failures)
- `npm --workspace @talkin-ai/desktop run typecheck`
  - Result: fail on existing baseline issue `TS2688: Cannot find type definition file for 'vite/client'`

# Implementation Summary

- Added `attachProjectFile` / `unlinkProjectFile` to the shared desktop IPC contract and preload bridge so the renderer can send file payloads without widening the exposed surface.
- Added a small app-managed file storage helper that writes project copies under a project-scoped storage root and preserves the source extension.
- Extended the persistent project service to copy file bytes, create `file_assets` metadata rows, touch project activity ordering, and unlink metadata while explicitly retaining the managed copy and never touching the original local file.
- Updated the project detail side rail so users can attach the first file from the empty state, add another file from the populated state, inspect file name/type/size, and unlink a file with clear success/error copy.
- Added story-scoped tests covering attach, restart persistence, unlink behavior, and source-level design affordances.

# Design Compliance Notes

- Status: `pass`
- Relevant contract coverage:
  - `design-must-have-7` / project hub context: preserved by keeping file actions inside the existing project detail hub instead of creating a separate document surface.
  - `design-must-have-9` / project detail user flow: file actions are integrated into the project detail side section only where this story touches UI.
  - `design-layout-1` and unrelated navigation/chat/workbench requirements: `not_applicable` for this slice.
- Notes:
  - The file section remains secondary to task/context panels.
  - Empty and populated states both present a clear next action without turning the screen into a document manager.

# Design Differentiation Notes

- Status: `pass`
- Intended archetype: `chat-first inbox`
- Visible choices made:
  - Kept file management inside the existing long-running project hub rather than introducing a standalone asset table.
  - Used brief, workflow-oriented copy such as “지금 작업에 필요한 참고 자료만 가볍게 연결합니다.”
  - Preserved the sidecar helper-panel shape and inline CTA rhythm.
- Layout silhouette difference from default/control:
  - The file UI stays as a narrow contextual rail within the project hub, not a centered upload card or generic asset dashboard.
- Default convergence risks avoided:
  - Avoided a cold document-management layout with toolbars, tables, or heavy CRUD chrome.
- Remaining weak spots:
  - No live renderer screenshot verification was captured in this run; design status is source-and-test backed.

# Outcome Quality Notes

- Purpose clarity:
  - The file area now clearly reads as “attach supporting docs to this project hub,” not as general storage.
- Primary action:
  - `첫 파일 연결` from empty state and `파일 추가` from populated state make the next step explicit.
- State/copy handling:
  - Success: confirms the file is attached and clarifies that only the app-managed copy changed.
  - Error: clarifies the original file is still safe and retry is available.
  - Empty: explains what to do first and why only a few files belong here.
- Visible quality choices:
  - Explicit original-file policy copy.
  - Compact add/unlink controls beside metadata.
  - Project activity timestamp updates continue to flow through canonical project state.
- Remaining weak spots:
  - Unlink currently retains the managed copy on disk; cleanup is intentionally deferred.
  - Typecheck remains blocked by the pre-existing `vite/client` baseline issue.

# Structured Assessment

```json
{
  "success_criteria_status": "partial",
  "story_completion_status": "met",
  "mvp_acceptance_status": "partial",
  "release_evidence_status": "story_test_passed",
  "package_readiness_status": "blocked_by_existing_typecheck_baseline",
  "remaining_required_story_keys": ["story-6.1", "story-6.2"],
  "next_story_candidates": ["story-6.1", "story-6.2"],
  "risks": [
    "Managed file copies are intentionally retained after unlink; cleanup remains deferred work.",
    "Workspace typecheck still fails on the pre-existing TS2688 vite/client configuration issue."
  ]
}
```
