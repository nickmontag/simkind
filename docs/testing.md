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
the model selected by `OPENROUTER_MODEL` through OpenRouter. Treat this as an
opt-in behavioral smoke test: it consumes API credits and should not replace
deterministic CI.

`npm run demo:soak` is the longer integration gate. Over 30 ticks it covers
two goals competing for one mint, contextual rejection, a delayed timeout and
late completion, conversation-sourced memory, bounded concurrency, save/reload
with requests pending, and exact ledger replay. `npm run demo:openrouter:soak`
runs the same world with your chosen model selecting actions; it is excluded
from CI because it is nondeterministic and consumes credits.

Future evaluation can broaden scenario coverage and quality rubrics. Do not
require exact generated dialogue or plans.

CI runs on Node 22 and 24, checks tracked public files, and verifies the build,
types, deterministic tests, demos, and package contents.

## Phase 2 validation plan

The [conformance plan](https://github.com/nickmibarra/simkind/blob/main/docs/design/conformance.md) defines proposed format, host,
and run fixtures plus release gates. Most remain implementation tasks. The
character reader/writer subset has portable inputs and a manifest under
`fixtures/format/`, exercised by `tests/format.test.ts`. Its README identifies
partial gates and limitations. `npm run check` also verifies that generated
format types and the embedded schema match the versioned JSON Schema. See the
[character format guide](character-format.md).

M1/M2 add `portable-fixtures`, `portable-node`, and `portable-runner` suites. They
cover all six draft.2 kinds, schema wrappers, file/hash/reference resolution,
configuration and provider gates before host construction, private perspectives,
asynchronous actions, uncertainty, cancellation, deadlines/reset, hard request
limits, file-only cast changes, and immutable exports. OpenRouter transport tests
mock HTTP; they do not consume credits or establish new live-provider evidence.
See the [portable scenario guide](portable-scenarios.md#verification).


## Post-M2 alpha checks

`npm run check` also covers continuity revisions, compatible checkpoints/branches,
recording integrity, independent spatial motion/viewer parity, local playground
APIs, and card conversion. `npm run check:runs` reproduces the three deterministic
portable run bundles byte for byte. `npm run check:consumer` packs and installs in
an external temporary project, so repository self-reference cannot hide missing
exports or files. The Python reader has a separately declared fixture subset and
CI job; see [interoperability](interoperability.md).

`npm run scenario:smoke -- --model exact/provider-model` makes at most three live
requests capped at 256 output tokens each and records successes and failures. It
requires a configured local key and an explicit model; it is excluded from CI.
The [release report](release-alpha.md) separates deterministic checks, mock
transports, and the actual mixed GLM sample.

## Cross-scenario perception and durability

`tests/perception.test.ts` checks private dialogue, repeated wording with different
identities, narrative versus interpretation, recipient delivery order after
restore, participant receipts, and bounded state-heavy contexts.
`tests/runner-resilience.test.ts` checks separate maintenance deadlines while
preserving shared-deadline behavior. `tests/durable-session.test.ts` checks reports,
settled recovery, and interrupted evidence-only exports. Provider tests cover
allowlisted usage, cache, and routing metadata.

`npm run check:long-runs -- --turns 1000` exercises current conversation and
settlement implementations with exact restore; `--legacy` selects the older
baseline. The opt-in live memory harness uses current event delivery and detects
checkpoint questions in new dialogue events. See
[the scenario evaluation recipe](building-simulations.md#versioning-and-verification)
for behavioral checks that apply across social, cooperative, and competitive hosts.
