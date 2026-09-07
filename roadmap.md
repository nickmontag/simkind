# Phase 2 alpha roadmap

Status: agreed product direction; proposed implementation plan. Future APIs,
formats, commands, and UI capabilities below are not implemented unless the
release evidence explicitly says otherwise.

## Purpose and guiding principle

Make Simkind an excellent place to create a group of LLM-driven characters,
give them a situation, observe and intervene in their interactions, and reuse
the same character machinery inside another application. Games are one use;
conversation-only environments, headless spatial simulations, rendered worlds,
and physical hosts must fit the same conceptual contract.

**Give characters a world, a perspective, and tools—not a script.**

Characters choose strategies, negotiate priorities, cooperate, refuse,
misunderstand, deceive, reconsider, and combine tools creatively. Increasingly
capable models should have more room to exercise judgment. The host owns
permissions, execution, and authoritative records of effects. It does not
necessarily have perfect knowledge of a physical world.

| Structure belongs to the framework or host | Choice belongs to the character |
| --- | --- |
| Tool schemas, permissions, and effects | Which tools to use and in what combination |
| Observations and information provenance | What matters and how to interpret it |
| Recorded intentions and commitments | Whether to pursue, revise, negotiate, or abandon them |
| Resources and simulation timing | Strategy, compromise, and initiative |
| Persistence and traces | How experiences inform later behavior |

Planning, reflection, relationship models, and agreement protocols are optional
capabilities or recipes. Do not impose a mandatory cognitive pipeline, universal
personality scale, fixed cooperation policy, or prescribed plot. An unmet goal
is not automatically a defect.

“Best in class” is an ambition for the workflows below, not an established
market claim or a requirement for feature parity with every agent platform.

## Implementation reading order

1. [Schema architecture](schema.md): documents, authoring, profiles, ownership,
   references, and versioning.
2. [Host protocol and embodiment](docs/phase-2-host-protocol.md): observations,
   asynchronous actions, clocks, bodies, and execution capabilities.
3. [Playground and authoring](docs/phase-2-playground.md): workflows, inspector,
   run artifacts, and contributions.
4. [Conformance and release gates](docs/phase-2-conformance.md): fixtures,
   semantic tests, evaluation, migration, and evidence.

The existing [architecture](docs/architecture.md) and
[integration guide](docs/integration.md) document the current alpha. Resolve
conflicts explicitly rather than silently replacing existing contracts.

## Baseline and intended layers

The alpha has capability descriptions, lexical memory ranking, evidence-based
goal evaluation, conversation lifecycle rules, asynchronous model requests,
host execution helpers, and decision-ledger replay. It has BYOK setup with
explicit model selection, two-character examples, and a settlement prototype.

It does not yet have the portable format, general character runner, browser
playground, general asynchronous action lifecycle, or generic branching system.
Existing scenario save/reload and replay are evidence for specific hosts only.
The small live examples currently pass recalled memory IDs rather than full
content; the settlement passes content. `memoryInfluencedDecisions` measures
recall co-occurrence rather than established causal influence. Address both in M3.

| Layer | Responsibility | Constraint |
| --- | --- | --- |
| Format | Schemas, semantics, fixtures, migrations | Language-neutral; no LLM needed |
| Core | Lifecycle, decisions, requests, records | No renderer, provider, or database requirement |
| Character recipes | Context assembly, memory use, optional cognition | Replaceable; no world-specific mechanics |
| Host adapters | Observations, tools, world state, checkpoints | Preserve host authority and engine ownership |
| Playground | Author, run, inspect, intervene, compare | Uses the public contracts available to external hosts |

Begin in one repository. Logical separation does not require a monorepo or
multiple packages immediately. Split entry points when necessary to prevent
unrelated dependencies reaching consumers.

## M1 — Portable contract and minimal runner

Dependencies: none.

Deliver draft JSON Schemas for the six document kinds, a deterministic Markdown
mapping, structural/reference/compatibility validation, and a minimal character
runner: receive a perspective and tools, request a decision, submit proposals,
and return consequences. Define observation/action envelopes and explicit clocks.
Bridge existing helpers instead of silently replacing their contracts.

Acceptance:

- The same runner operates in a conversation host and the settlement.
- No world-specific branching exists in the runner.
- Unsupported required features prevent launch with useful diagnostics.
- Documents can be read and validated without executing imported code.

## M2 — Authorable casts and situations

Dependencies: M1.

Deliver a scenario loader, two starter hosts, reference bindings, model
assignments, feature configuration, and run limits. A conversation host must
not require maps or inventories. The constrained-world host may initially use
settlement locations. Author conditions and possibilities, not a solution.

Acceptance:

- A user changes the cast, private knowledge, and motivations without TypeScript.
- Two different scenarios use the same host implementation.
- Effective configuration and selected models are inspectable.
- Credentials remain outside portable documents and recordings.

## M3 — Continuity and open social behavior

Dependencies: M1; exercise through M2 scenarios.

Deliver actual selected memory content with provenance and time; distinct
observation/report/interpretation/authored-history records; editable intentions;
expressive speech with structured effects; and optional reflection with source
links. Offer agreement and relationship recipes without a compulsory negotiation
protocol or fixed trust formula.

Meeting coordination is a useful experiment, motivated by the settlement's
crossing-path failures. Do not fix it by choosing the strategy for the model.

Acceptance:

- A mistaken character belief can coexist with a different host record.
- Revisions preserve their originating experiences.
- Legal refusal and alternative strategies do not fail correctness tests.
- Recall metrics are labeled accurately; changed-condition experiments examine
  behavior across repeated runs rather than asserting causality from one trace.

## M4 — Playground and evidence inspector

Dependencies: M1–M2; integrate M3 as it becomes available.

Deliver local browser authoring, BYOK/provider configuration, model selection,
start/pause/step/stop, conversations/events, character perspectives, and action
inspection. Capture versioned run artifacts from the start. A conversation host
needs no map; spatial hosts can begin with a simple location diagram.

Acceptance:

- A newcomer authors and launches a scenario without reading source.
- An action can be traced to supplied context and actual consequences.
- Observer-only information and model self-reports are clearly labeled.
- A saved run opens for playback without provider calls.

## M5 — Resume, interventions, and branches

Dependencies: M1, M4, and host checkpoint support.

Deliver complete checkpoints, recorded authorized interventions, resume, and
branch comparison. Start at settled boundaries with no pending model requests
or unfinished host actions. A paused UI alone is not a checkpoint.

Acceptance:

- Branches identify parent checkpoint and interventions; parents remain immutable.
- Compatible deterministic hosts reproduce the recorded prefix exactly.
- Playback, deterministic replay, restore, and new continuations remain distinct.
- Unsupported restoration fails before host-side effects. A hypothetical branch
  from a physical recording names the separate simulated continuation host.

## M6 — Embedding and headless 3D proof

Dependencies: M1; stabilize against M2–M5 experience.

Deliver a versioned npm alpha, minimal embedding starter, optional body bindings
and spatial profile, and a small independent 3D host running both headlessly
and with a simple viewer. Keep geometry, locomotion, animation, collisions, and
actuators in the host. Production robot drivers are outside Phase 2.

Expand provider adapters to configurable compatible endpoints and local
inference where capabilities permit. Include request deadlines, cancellation
reporting, usage visibility, and dispatch/token limits.

Acceptance:

- Conversation and 3D reference hosts consume the public package boundary.
- Importing core requires no playground, renderer, or provider SDK.
- Spatial observations identify frames, units, clocks, and pose provenance.
- Adding a body does not change character-definition requirements.

## M7 — Showcase, interoperability, and contributor release

Dependencies: M1–M6.

Deliver “Promises and Rumors” and a non-spatial group scenario, editable
configurations, representative run bundles, a walkthrough, and a contribution
template. Present individual outcomes, not promised stories. Add a character-card
importer with conversion reporting and an independent-language document reader.
Full cross-language runtime parity is not required.

Acceptance:

- An outside contributor authors a scenario that someone else runs and modifies.
- An independent reader validates fixtures and preserves optional extensions.
- Advertised compatibility matches demonstrated conformance.

## Release gates and scope limits

Phase 2 completes when the [release checklist](docs/phase-2-conformance.md#phase-2-release-checklist)
passes. Record versions, fixture IDs, evidence, and limitations in a release report.
A scripted demo is not evidence of general social intelligence.

Defer massive populations, universal psychology, automatic execution of generated
world code, elaborate 3D assets, required vector infrastructure, production
robotics, hosted marketplaces, and distributed execution. Prove new shared
behavior in two hosts before promoting it into core.

Exact API names, UI stack, initial 3D engine, validator library, provider-schema
mapping, and package splitting remain implementation choices. Record rationale
and compatibility consequences in the relevant design document. The emergence,
host authority, and optional-embodiment principles are settled requirements.
