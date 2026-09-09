# Phase 2 alpha roadmap

Status: M1–M5 implemented; M6/M7 implementation and local release evidence are
available as `0.2.0-alpha.1`, using format `0.2.0-draft.2`. npm publication remains
blocked on registry authentication. See the [release report](docs/release-alpha.md)
and [current documentation](docs/README.md). No state-of-the-art ranking is claimed
without comparative behavioral evidence.

## Direction

Make it simple to author a group of LLM-driven characters, put them in a
situation, observe and change the conditions, and embed the same character
machinery in another application. Games, group conversations, and spatial
simulations should all fit.

**Give characters a world, a perspective, and tools—not a script.**

The host supplies constraints, observations, permissions, and consequences.
Characters choose strategies, revise intentions, cooperate, refuse, and use
tools creatively. Planning, reflection, relationships, and agreement protocols
are optional capabilities. We do not prescribe a story or cognitive pipeline.

Embodiment is optional and separate from presentation: a 3D simulation can run
headlessly, and a conversation needs no coordinates. Physical hosts can share
the contract without claiming perfect observations or reversible real-world
effects. Increasing model capability should create more room for judgment.

## Milestone progress

| Milestone | Status | Public outcome | Depends on |
| --- | --- | --- | --- |
| M1 — Portable contract and runner | Complete | Draft JSON Schemas, a precise Markdown mapping, validation, and a minimal character loop shared by conversation and constrained-world hosts | — |
| M2 — Authorable casts and situations | Complete | Change characters, private knowledge, tools, models, and run limits without editing TypeScript; reuse one host across different scenarios | M1 |
| M3 — Continuity and social behavior | Implemented | Supply actual memory content with provenance; distinguish observations from beliefs; support editable intentions and optional reflection or agreement recipes | M1, exercised through M2 |
| M4 — Playground and inspector | Implemented | Author, run, pause, inspect perspectives and consequences, and open recorded runs locally; explicit BYOK and model selection | M1–M2, incorporating M3 |
| M5 — Resume and branches | Implemented | Restore complete supported checkpoints, record interventions, and compare new continuations while keeping parent runs immutable | M1, M4, host checkpoint support |
| M6 — Embedding and headless 3D | Implemented; npm publication pending | Publish an npm alpha, embedding starter, optional spatial profile, and independent 3D reference host with headless and viewer modes; expand provider and local-model support | M1, stabilized against M2–M5 |
| M7 — Interoperability and release | Implemented locally | Editable showcase scenarios, shareable run bundles, character-card conversion reports, and an independent-language format reader | M1–M6 |

The alpha already has capability catalogs, memory ranking, evidence-backed
commitments, asynchronous model requests, and host-specific decision replay.
The six document kinds, optional shared runner, local loader, and authorable
conversation/settlement hosts are implemented. The local playground and compatible settled
branching are implemented; arbitrary world patching and cross-host migration remain
outside this alpha. The format is an open-standard candidate,
not an established standard. See the [current M1/M2 guide](docs/portable-scenarios.md).

### M1 implementation gates

Completed gates, backed by format, resolution, runner, and host fixtures:

- [x] Character boundary: local versioned schema, generated types, strict bounded
  parsing, reversible Markdown, diagnostics, required-profile gate, and fixtures.
  See the [implemented subset and limits](docs/character-format.md).
- [x] Remaining five document kinds and resolution: freeze field semantics,
  resolve bundle IDs/paths, validate configuration precedence and model slots,
  and record exact-byte resource hashes. Prove reference and launch failures.
- [x] Observation/action boundary: explicit clocks and revisions, private
  projections, asynchronous outcomes, uncertainty, and deduplication fixtures.
- [x] Shared runner: bridge existing primitives and prove the same loop in
  conversation and constrained-world hosts without world-specific core branches.

This sequence resolves contract gaps before UI work. Capture request context
and action evidence with the runner so M4 can inspect real records. Required
profile checks are one part of launch validation; they do not establish
compatibility alone. Preserve existing host-specific APIs and replay readers
until an explicit migration exists.

### M2 implementation gates

- [x] Author cast, personas, private starting context, tools, models, features,
  and limits in files, without TypeScript changes.
- [x] Run two contrasting situations with the same conversation host, plus an
  authorable constrained-world settlement host, through the public runner.
- [x] Inspect effective model assignments, configuration precedence, supplied
  context, proposals, and host outcomes; keep connection credentials local.
- [x] Freeze source bytes and compiled Markdown with hashes; save ordered event
  records in a new immutable directory with explicit completeness/capabilities.

The [current guide](docs/portable-scenarios.md#verification) names the checks and
limitations. Reference hosts support text/structured observations, recorded evidence, and now
compatible settled restore. The current release report distinguishes simulated-host
replay, mock transport tests, and the limited live-provider sample.

### Verification checkpoint — 2026-09-07

M1/M2 verification passed: 146 tests, generated-artifact checks, typechecking,
and build; all three authored scenario CLI smoke runs; both legacy demo replay
checks; and an external package-consumer launch/export and TypeScript check.
That M1/M2 verification checkpoint preceded the post-M2 implementation below.

### M3–M7 implementation gates

- [x] Optional continuity retains delivered observation content and provenance;
  revision-checked self-reports can edit intentions and supersede interpretations.
  Observations and host outcomes cannot be overwritten as beliefs.
- [x] Local authoring, explicit provider/model slots, validate/start/run/pause/step/
  stop, actual-context inspector, and verified recording playback.
- [x] Complete settled checkpoint profile with exact host/configuration gates,
  unresolved-work refusal, immutable parent artifacts, recorded interventions,
  fresh continuation budgets, and labeled comparisons.
- [x] Schema-derived document fields with extension-preserving JSON/Markdown saves;
  host-defined world interventions with pure preview, atomic revision checks, and
  private observations; sibling trace comparison with an exact shared checkpoint.
  New host implementations preserve the original recording readers.
- [x] Independent kinematic 3D host with frames, swept obstacle checks, timed action
  progress/cancellation, and equal headless/viewer execution; public embedding
  starter and separate remote/local compatible provider adapters.
- [x] Shareable playback and complete recording bundles with capability downgrades,
  card conversion/loss reports, Python reader fixture subset, editable showcases,
  contributor walkthrough, and clean external-package checks.
- [ ] Publish the prepared npm alpha: this machine returns `ENEEDAUTH`.
The contributor walkthrough is delivered and clean-package checks pass. Broader behavioral validation remains a release-quality task. The original three-call
GLM sample is historical; subsequent long-memory, economy, and fabrication trials
are summarized in the current release and evaluation guides. They do not establish
superior character intelligence.

See [release evidence](docs/release-alpha.md) for exact scope and commands.

## Definition of done

Phase 2 should let an outside contributor author a scenario, run and modify
someone else's scenario, and embed characters through the same public contracts.
Conversation and spatial reference hosts must demonstrate those contracts.

Release evidence must distinguish playback, deterministic replay, restoration,
and fresh model continuations. Correctness tests protect host constraints and
record integrity; behavioral evaluation permits surprising legal choices,
including refusal and abandoned goals. A successful scripted story alone does
not establish character intelligence.

The [conformance and release checklist](docs/design/conformance.md#phase-2-release-checklist)
defines the detailed gates. Compatibility claims must match demonstrated
fixtures, host capabilities, and documented limitations.

## Design proposals and scope

The [public design index](docs/design/README.md) links the detailed format,
host protocol, playground, and conformance proposals. These preserve contributor
contracts and acceptance criteria while implementations evolve.

Start in one repository and promote shared behavior into core only after two
hosts demonstrate the need. Defer massive populations, universal psychology,
automatically executing generated world code, elaborate 3D assets, required
vector infrastructure, production robotics, hosted marketplaces, and distributed
execution. Engine choice, UI stack, exact API names, and package splitting remain
implementation decisions.

## Long-session follow-through

- [x] Bounded recent context, separate original evidence and model-authored episodes,
  recorded consolidation/recall/correction requests, and protected intentions.
- [x] Indexed disk storage, atomic action admission, compact settled checkpoints,
  frozen archives, paged inspection, and recovery into a separate file.
- [x] Deterministic 100/1,000/10,000-turn checks across two hosts, with exact restore.
- [x] Controlled 1,009-turn memory history and a fully live economy, with failures
  and targeted rechecks reported in [evaluation evidence](docs/long-run-evaluation.md).
- [ ] Broader semantic recall comparisons across models and indirect/paraphrased cues.

See [Long-run memory](docs/long-run-memory.md) for supported behavior and limits.

### Follow-up from live observations — implemented

- [x] Independent completion wakeups and per-opportunity deadlines; bounded provider cleanup.
- [x] Request-bound character revisions, preserved through retries and checked against intervening changes.
- [x] Explicit evidence lifecycle metadata and host receipts separating reservations from completed effects.
- [x] Fallible summaries separated from current observations and goals; cited originals included in bounded recall.
- [x] Evidence-only paged archives when no resumable checkpoint is possible; reports saved before export.
- [x] Host-defined request constraints, illustrated by voting options, offer deadlines and negotiated tool quality.

Regression coverage includes slow peers, delayed edits, timeout cleanup, incorrect
summaries, original-evidence verification, and quality-constrained exchanges.

## Validation and release consolidation — September 9, 2026

The original milestone implementation is largely delivered. The next gate is
repeatable evidence and contributor readiness, rather than more core features.

- [x] General observation/event separation, attributed dialogue and receipts,
  bounded optional maintenance, and a supervised local execution path.
- [x] Field-level correction feedback, host-local semantic tool guidance,
  compaction fidelity instructions, and selective automatic recall; originals
  remain available through explicit recall.
- [x] Latest engineering checkpoint: 243 tests; two 1,000-turn procedural soaks;
  package consumer, deterministic fixture, public-file, and exact-restore checks.
- [ ] Repeated friendship, cooperative, and competitive live trials, reported
  without rewarding a prescribed ending.
- [ ] Same-history cross-model long-memory evaluation, with retrieval misses,
  unsupported claims, privacy, cost, and latency reported separately.
- [ ] Consolidated implementation/evaluation commits and current release evidence.
- [ ] Independent human scenario-authoring and embedding walkthrough.
- [ ] npm alpha publication.

See [behavioral evaluation](docs/behavioral-evaluation.md) for the bounded test plan.
Mechanical 10,000-turn success is not proof of 10,000-turn semantic continuity.
General social/narrative quality and comparative SOTA claims remain unproven.
