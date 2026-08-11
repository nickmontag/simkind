# Testing strategy

Construction tests protect stable boundaries only:

1. capability catalog completeness and rendering;
2. deterministic memory ranking;
3. evidence-backed goal completion;
4. exact decision ordering and replay;
5. conversation lifecycle directives; and
6. runtime phase ordering and class-adapter binding; and
7. model dispatch priority, completion, failure, concurrency, and reset behavior.

Every exported runtime value has at least one direct contract test. TypeScript
also checks source, tests, and executable examples as part of `npm run check`.

Host games add a few targeted adapter tests proving their intent schema,
executor, request lifecycle, and story hooks connect correctly. Avoid broad
behavioral snapshots while prompts, goals, and content are moving quickly.

After the system stabilizes, add bounded scenario soaks and rubric-based
quality evaluation. Do not require exact generated dialogue or plans.
