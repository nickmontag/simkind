# Testing strategy

Construction tests protect stable boundaries only:

1. capability catalog completeness and rendering;
2. deterministic memory ranking;
3. evidence-backed goal completion;
4. exact decision ordering and replay;
5. conversation lifecycle directives;
6. simkin runtime phase ordering and class-adapter binding; and
7. model dispatch priority, completion, failure, concurrency, and reset behavior.

Every exported runtime value has at least one direct contract test. TypeScript
also checks source, tests, and executable examples as part of `npm run check`.

Host simulations add a few targeted adapter tests proving their intent schema,
executor, request lifecycle, and domain hooks connect correctly. Avoid broad
behavioral snapshots while prompts, goals, and content are moving quickly.

The executable two-simkin scenario is the integration tracer bullet. It runs
model dispatch, host validation, deterministic fallbacks, action execution,
memory retrieval, commitment evidence, decision recording, and replay through
one four-tick promise-delivery story. Run it with `npm run demo`; its assertions
live in `tests/two-simkins.integration.test.ts`.

`npm run demo:openrouter` swaps the scripted provider for
`openai/gpt-5.6-luna` through OpenRouter. Treat this as an opt-in behavioral
smoke test: it consumes API credits and should not replace deterministic CI.

`npm run demo:soak` is the longer integration gate. Over 30 ticks it covers
two goals competing for one mint, contextual rejection, a delayed timeout and
late completion, conversation-sourced memory, bounded concurrency, save/reload
with requests pending, and exact ledger replay. `npm run demo:openrouter:soak`
runs the same world with Luna choosing actions; it is intentionally excluded
from CI because it is nondeterministic and consumes credits.

Future evaluation can broaden scenario coverage and quality rubrics. Do not
require exact generated dialogue or plans.

CI runs on Node 22 and 24, checks tracked public files, and verifies the build,
types, deterministic tests, demos, and package contents.
