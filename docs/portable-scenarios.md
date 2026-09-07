# Portable scenarios and the character runner

Phase 2 milestones M1 and M2 are implemented with format revision
`0.2.0-draft.2`. You can author characters and situations as data, run the same
character loop in conversation and constrained-world hosts, select models by
connection slot, and inspect the recorded context and outcomes.

The package is now `0.2.0-alpha.1`, prepared for publication pending npm
authentication. This original M1/M2 authoring contract remains supported. See
[continuity](continuity.md), the [local playground](playground.md),
[checkpoints and branches](checkpoints.md), [providers and spatial hosts](providers-and-spatial.md),
and [interoperability](interoperability.md) for the post-M2 additions. The CLI now
defaults to `config-continuity.json`; pass `--config config.json` for M2 features.

## Run an editable scenario

Complete the [BYOK setup](../README.md#quick-start-bring-your-own-api-key), choosing
an explicit OpenRouter model that supports JSON responses. From the checkout:

```sh
npm run scenario -- --scenario shared-decision.json
npm run scenario -- --scenario workshop.json
npm run scenario -- --scenario pump-crisis.json
```

The first two situations share `example.conversation` host version `1.0.0`.
The third uses `example.settlement` version `1.0.0`. All three use the same public
runner. The host implementations are small reference integrations under
`examples/portable/hosts/`; the original six-character settlement prototype and
its existing recordings remain unchanged.

Runs print effective models, settings, tool permissions, configuration sources,
and limits before dispatch. Each step prints pending provider/action counts.
The final report includes operator-visible host state and the saved directory.
Ctrl-C stops new dispatch and requests provider cancellation. It does not undo
admitted actions. No model is chosen by default and no provider failure selects
a substitute model or fabricated successful action.

A run directory defaults to `.internal/runs/<unique-run-id>/`. Use `--output`
to choose a **new** directory; existing exports are never overwritten.
`--check` validates launch configuration without constructing the host or calling
a model. Local connection credentials must still be configured for live mode.

## Author without TypeScript

Copy the supplied bundle to your local workspace:

```sh
mkdir -p .internal
cp -R examples/portable/scenarios .internal/my-scenario
npm run scenario -- --root .internal/my-scenario --scenario shared-decision.json --check
```

Edit these files in the copy:

| File | What you control |
| --- | --- |
| `characters/*.simkind.json` | Names, personas, motivations, intentions, and private starting memories |
| `shared-decision.json`, `workshop.json`, or `pump-crisis.json` | Cast, per-instance starting-state overrides, available tools, and host initial conditions |
| `config.json` | Model slot assignments, optional memory selection, per-instance overrides, and run limits |
| `tools/*.json` | The installed host's exact tool contract; changing a descriptor does not implement a new tool |

A cast entry binds an `instanceId` to a `characterRef`. One definition can be
instantiated more than once. Each instance gets a distinct state document and a
copy of its starting context. Instance overrides overlay objects recursively and
replace arrays. Editing a template after launch cannot change that run.

Conversation casts need no coordinates or inventories. For settlement casts,
update the `positions` and `inventories` maps for every instance. All places,
routes, and the pump location must resolve. Private knowledge lives in each
character's starting memories; a cast entry can supply different memories when
reusing a definition. A character receives only its own stored context and the
host's permitted observations.

To narrow tools, set a cast entry's `allowedTools`, for example `['say']` in JSON
as `["say"]`. Run overrides can narrow those permissions further, but cannot add
permissions the scenario withheld. Host legality is checked again at execution.
Changing a tool's behavior requires an installed host implementation/version,
not a new description in an imported document.

The first metadata fence/body mapping also works with `.simkind.md` character
files. Update the resource path when switching representation; keep one
authoritative source per ID. See the [character mapping](character-format.md#exact-markdown-mapping).

## Models, features, and limits

`modelAssignments` maps instance IDs to local connection slots. By default the
CLI configures only `primary`, using `OPENROUTER_API_KEY` and `OPENROUTER_MODEL`
from `.env` or the environment. For multiple models, create a local connections
file such as `.internal/connections.json`:

```json
{
  "primary": {
    "provider": "openrouter",
    "model": "provider/your-selected-model",
    "apiKeyEnv": "OPENROUTER_API_KEY",
    "settings": { "temperature": 0.7, "maxOutputTokens": 500 }
  },
  "secondary": {
    "provider": "openrouter",
    "model": "provider/another-selected-model",
    "apiKeyEnv": "OPENROUTER_API_KEY"
  }
}
```

Replace model placeholders, assign `secondary` to an instance in `config.json`,
and run with `--connections .internal/connections.json`. A per-instance override
can set `modelSlot`, `features`, and `allowedTools`. The recorder includes only
allowlisted public model fields, never connection keys or provider exception
text. Unspecified provider settings remain unspecified; provider defaults are
not inferred. Keep credentials out of authored character/scenario data too.

The initial implemented feature is `simkind.memory-retrieval` version `0.1.0`:

- Declare the profile explicitly; no declaration means no stored-memory selection.
- Defaults are `enabled: true` and `config: { "maxItems": 12 }`.
- It supplies up to `maxItems` complete memory records, ordered by stable ID.
  This is deterministic selection, not a semantic-relevance or causal-use claim.
- `maxItems` ranges from 0 to 1000. Disabling the feature stops supplying memories
  while retaining the stored records. It does not hide current observations.
- There is no extension payload beyond an empty object. The configuration schema
  is [published locally](../schemas/0.2.0-draft.2/memory-retrieval.schema.json).

Feature values resolve in order: profile defaults, scenario recommendations,
run overrides, then per-instance overrides. Objects overlay recursively; arrays
replace. Conflicting types fail, and `null` never acts as deletion. Host limits
are checked afterward. Unknown optional extension data is preserved but never
placed in model context. Required unsupported profiles, unsupported enabled
features, missing model slots, and incompatible host/tool versions block launch.

The four required local limits are `maxRequests`, `maxInFlight`, `maxSteps`, and
`requestTimeoutMs`. Request/concurrency limits are hard local dispatch bounds;
there is no total-token or billing guarantee. The runner rotates eligible actors
so a small concurrency limit does not starve later cast members. The host chooses
decision opportunities; scheduling does not prescribe character strategies.

Provider deadlines use elapsed wall time independently of the host clock.
A completion that arrived on time remains valid if polled later. Timeouts abort
where supported and discard late proposals. A provider that ignores abort keeps
its concurrency slot until its actual promise settles. The runner does not retry
it automatically. Request cancellation and completed host effects are separate.

The included OpenRouter adapter requests JSON mode and parameter enforcement
through the [documented API](https://openrouter.ai/docs/api/reference/overview).
Tool schemas are supplied as context and enforced locally, rather than translated
into a claimed provider-specific schema subset. Models lacking the requested
capability fail visibly at dispatch. The transport tests use mocked responses;
M1/M2 verification does not claim a new live-model result.

## Document and package contracts

| Entry point | Responsibility |
| --- | --- |
| `simkind` | Existing memory, commitment, model-queue, ledger, and host primitives |
| `simkind/format` | Draft readers/writers, generated types, schema/record validation |
| `simkind/runner` | Launch compatibility, immutable context snapshots, action tracking, and provider-neutral runner |
| `simkind/node` | Local resource loading, SHA-256, and writing new run directories |

The six kinds are `character`, `character-state`, `scenario`, `tool-catalog`,
`run-config`, and `run-bundle`. Their standalone schemas reference the common
[document schema](../schemas/0.2.0-draft.2/document.schema.json), the source for
both validation and generated TypeScript. All schemas are exported under
`simkind/schemas/0.2.0-draft.2/`. `readDocument`/`writeDocument` target draft.2;
`readCharacter`/`writeCharacter` retain the original draft.1 character subset.
`upgradeCharacter` explicitly returns a new draft.2 artifact and a change report.
It never upgrades old replay claims or silently migrates files during loading.

Parsing, structural, referential, semantic, and compatibility failures carry
stage/code/pointer diagnostics. A valid document alone is not executable.
Historical memories can retain explicitly unresolved references with their origin;
historical time fields require `source.origin` and are not treated as current host
ticks. Current observations/actions must use declared clocks with valid values.

Resource paths are relative to the explicit `--root`, including paths in nested
resource catalogs. Loading never downloads code, schemas, or media. It rejects
traversal, escaping symlinks, cycles, conflicting IDs/paths, mismatched hashes,
invalid UTF-8, duplicate keys, and unresolved required launch bindings. Limits
are 1 MiB per document, 64 JSON containers deep, 128 documents, and 16 MiB of
resolved authored input. Treat a loaded `ResolvedBundle` as a snapshot: write
changed authoring sources and load again before launching them.

To embed, obtain a bundle with `loadScenario`, register a `HostRegistration`, and
pass explicit `ModelConnection` slots to `createCharacterRunner`. Inspect a
`prepareLaunch` result to review effective configuration before construction.
The [reference hosts](https://github.com/nickmibarra/simkind/tree/main/examples/portable/hosts)
use only public package imports and show the complete adapter contract.

```ts
import { loadScenario } from 'simkind/node';
import { createCharacterRunner } from 'simkind/runner';

// registration and connections are your installed host and provider adapters.
const loaded = await loadScenario(bundleRoot, 'scenario.json', 'config.json');
if (!loaded.ok) throw new Error(JSON.stringify(loaded.diagnostics));
const created = createCharacterRunner(loaded.value, registration, connections, 'run:example');
if (!created.ok) throw new Error(JSON.stringify(created.diagnostics));
const runner = created.value;
runner.step();
await runner.settleDecisions();
console.log(runner.status(), runner.events());
```

## Host outcomes and recordings

Observation envelopes identify recipient, source, captured/delivered times,
and host revision. The initial runner accepts text and structured-data content;
media, embodiment, and spatial profiles remain later work. Operator inspection
is separate from character context. Provider callbacks receive copies of their
own context, including actual selected memories, tools, and their action outcomes.

Proposals bind run, actor, request, tool/version, observed revision, and action ID.
The host admits or rejects them, then reports running, succeeded, failed,
cancelled, or unknown results. `ActionLedger` validates whole event batches before
mutation, preserves partial effects and uncertainty, and rejects conflicting ID
reuse or changes to terminal outcomes. Identical deliveries are no-ops. Deduplication
in these reference hosts is in memory for one run, not durable exactly-once execution.
Host adapters must implement deduplication where effects occur too.

The runner permits one unresolved action per actor, preventing blind resubmission
after uncertainty. Observation recording continues while an action is unresolved
or dispatch is paused. `pauseDispatch()` stops new model requests; calls to `step()`
still advance the host. Cancellation can be unsupported or too late. Stopping or
pausing is never evidence of a complete, resumable checkpoint.

The conversation host records speech and revisable votes. Private speech reaches
only the sender and recipient; public speech reaches the group. Votes are public.
The settlement host exposes local stock, carried inventory, nearby participants,
and messages the actor actually heard. Travel takes `travelTicks`; cancelling it
before arrival leaves the actor at its origin. Transfers require co-location and
stock. Reservoir water requires a working pump; repair consumes configured parts.
Speech cannot transfer resources or repair the pump.

Exports contain:

- `run.json`: host/profile versions, source hashes, effective configuration, clocks,
  limits, stream hashes, and explicit completeness/capability fields.
- `inputs/`: exact authored inputs; their resource catalogs remain relative to this
  preserved input root. Markdown also gets a separately hashed compiled document.
- `checkpoints/` when supplied: compatible settled runner and host state.
- `events.jsonl`: ordered observations, request context, model results/errors,
  proposals, action outcomes, and stop records.

Exports contain operator evidence, including private character context. They are
not automatically redacted for public sharing. Connection credentials are never
supplied to the recorder. A new output directory is required, and validation
precedes file creation. Pending requests, unresolved actions, or interrupted runs
are marked truncated. Copies returned by `events()` and `inspect()` cannot mutate
the original history or running instances.

The base recording API produces playback evidence. The CLI and playground now
include settled checkpoints when supported; `saveRun` then advertises restore and
branch capability. Verified host replay and fresh provider continuation remain
distinct operations. See [checkpoints](checkpoints.md) for exact versions, limits,
immutability, and the playback-only downgrade used by sharing exports.

## Verification

`npm run check` covers all six document fixtures, local resolution, profile/config
precedence, private perspectives, host legality, asynchronous travel, uncertainty,
partial effects, cancellation, provider deadlines/reset, request limits, transport,
and immutable export hashes. Fixture manifests are under `fixtures/format/draft.2`
and `fixtures/host/`. Existing core and deterministic host tests remain in place.
For a CLI smoke without paid requests:

```sh
npm run scenario -- --fixture --scenario shared-decision.json
npm run scenario -- --fixture --scenario pump-crisis.json
```

The fixture provider deliberately chooses no action. It proves the author/load/run/
record path; it is not a behavioral showcase. Targeted tests separately exercise
real host transitions, including travel and resource contention, without making a
preferred story ending a correctness condition.
