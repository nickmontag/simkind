# Host contract fixtures

`uncertain-action.json` is a portable H06 lifecycle fixture: admit, report an
unknown result, then reconcile success. The action remains unresolved between
uncertainty and success. Reading this fixture never invokes a provider or tool.

`tests/portable-fixtures.test.ts` consumes the data. The broader executable
fixtures in `tests/portable-runner.test.ts` cover H01–H09, H11, H14, and H15,
including the same runner in the conversation and settlement reference hosts.
Spatial/headless-viewer equivalence, physical playback, and character state-edit
tools remain later milestones; this is not complete Phase 2 host conformance.
