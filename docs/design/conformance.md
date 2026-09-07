# Phase 2 conformance, evaluation, and release gates

Status: draft design. Audience: contributors designing future releases.

This is a proposed validation plan. Fixture IDs below are implementation tasks,
not claims that these tests already exist. This document supports the
[roadmap](../../roadmap.md), [format](schema.md), and
[host contract](host-protocol.md).

## Compatibility claims

Implementations declare format/profile versions and one or more capabilities:

| Level | Required evidence |
| --- | --- |
| Document reader/writer | Parsing, validation, deterministic conversion, extension preservation |
| Character host | Perspective isolation, tool validation, action lifecycle, state ownership |
| Replay host | Complete recorded inputs and deterministic reproduction for stated host versions |
| Branching host | Compatible restore, immutable prefix, recorded interventions and continuation |

Passing JSON Schema validation does not imply host compatibility or replay support.
Unsupported required profiles may be stored by an editor but must prevent execution.
Physical hosts can legitimately claim recording/playback without restore/replay.

## Fixture organization

Implement schema artifacts, human-readable specification, and test cases together.
A proposed layout is `schemas/<revision>/`, `fixtures/format/`, `fixtures/host/`,
and `fixtures/runs/`. These paths are future implementation targets.

Each fixture records ID, input files, expected validation stage, expected error
code or normalized result, relevant profile versions, and a rationale. Tests must
protect semantics rather than mirror implementation details. Negative fixtures
must not contain real credentials or private scenario data.

## Format fixtures

| ID | Case | Expected behavior |
| --- | --- | --- |
| F01 | Minimal character JSON | Valid without body, model, numeric traits, or planner |
| F02 | Equivalent JSON and character Markdown | Same canonical data after conversion |
| F03 | Markdown metadata duplicates body description | Reject ambiguous source |
| F04 | Unknown field in known core object | Reject typo with document/pointer diagnostic |
| F05 | Unknown optional profile extension | Preserve exactly at data level; do not execute it |
| F06 | Unsupported required profile | Reader can retain; host compatibility fails |
| F07 | Missing or conflicting document/instance references | Required binding fails before launch |
| F08 | Imported historical memory has unresolved subject | Preserve with explicit unresolved provenance |
| F09 | Duplicate JSON keys or resource IDs | Reject; no parser-dependent last-value behavior |
| F10 | Path escapes bundle root | Reject before resource access |
| F11 | Invalid clock/frame/unit reference | Semantic validation fails |
| F12 | Per-instance feature overrides | Resolve documented precedence and record effective values |
| F13 | Disabled retrieval | Existing memory remains stored and exportable |
| F14 | Stale/invalid intervention patch | Reject atomically; original revision remains intact |
| F15 | Format migration | New artifact and explicit transformation/loss report |
| F16 | Character-card import | Map supported fields, preserve unmapped data, no permission escalation |
| F17 | Model slot has no configured model | Fail clearly; never silently choose a model |

## Host fixtures

| ID | Case | Expected behavior |
| --- | --- | --- |
| H01 | Two characters have different private observations | No cross-perspective leakage |
| H02 | Model claims an item transfer in speech | Inventory unchanged without a valid host action |
| H03 | Tool argument shape is valid but context changed | Host revalidates/rejects with a recorded reason |
| H04 | Long-running action accepted | No premature completion or commitment fulfillment |
| H05 | Cancel request arrives after completion | Completion remains; cancellation result is explicit |
| H06 | Operation result unknown after timeout | Remains unresolved; no automatic duplicate action |
| H07 | Duplicate action ID | Honor advertised deduplication; conflicting payload is rejected |
| H08 | Failure after partial effects | Effects and failure are both represented |
| H09 | Late provider result after generation reset | Cannot silently apply to the wrong generation |
| H10 | Character revises an intention | Revision recorded; host outcome history cannot be forged |
| H11 | Conversation-only character | No coordinates/body/renderer required |
| H12 | Same spatial host with and without viewer | Same execution for equivalent recorded inputs |
| H13 | Delayed estimated pose | Original capture time/frame/provenance retained |
| H14 | Provider or tool capability unsupported | Launch/dispatch diagnostics; no silent weakening |
| H15 | Request limit reached | No new dispatch beyond documented local limit |
| H16 | Physical playback | Never dispatches real-world tools |

The 3D reference host should test coordinate conversion and a timed action using
a controlled local simulation. Hardware access is not required. Do not mistake
successful mock actuation for validation of a production robot driver.

## Run fixtures

| ID | Case | Expected behavior |
| --- | --- | --- |
| R01 | Recorded run playback | Displays evidence without model calls or tool execution |
| R02 | Deterministic host replay | Same declared state/effect results with complete inputs |
| R03 | Missing external input or host version mismatch | Reject replay claim or mark playback-only |
| R04 | Settled checkpoint resume | State, clocks, memory revisions, config, and randomness restored |
| R05 | Checkpoint while action result unresolved | Refuse resumable checkpoint in initial Phase 2 profile |
| R06 | Branch with an intervention | Parent unchanged; child links checkpoint and intervention |
| R07 | Redacted/missing media | Disclose missing evidence and reduced capability |
| R08 | Imported physical recording branched in simulation | Name simulation host and state-mapping limitations |
| R09 | Template edited after launch | Existing resolved run unchanged |

Replay equality is defined by each host's documented contract. Floating-point
physics may need explicit tolerances or may not qualify as deterministic replay.
Do not weaken an exact equality claim after a failure without versioning and
explaining the contract change.

## Behavioral evaluation without proceduralizing characters

Keep structural integrity and behavioral interest separate. A legal refusal,
unmet intention, failed negotiation, or unconventional solution may be a useful
outcome. Correctness gates must not force all models toward one story ending.

Evaluate scenarios with multiple runs and retain complete configuration and
selection criteria. Suggested measurements:

- Host-measured outcomes: completed/violated agreements where explicitly defined,
  resource changes, action rejection, repetition, and unresolved actions.
- Continuity evidence: experiences included in context, source provenance,
  explicit interpretation revisions, and information propagation.
- Operational measures: requests, tokens, reported/estimated cost, latency,
  retries, cancellation, and incomplete runs.
- Optional human/model ratings: coherence, distinctiveness, or conversational
  quality. Label judge/model/rubric versions and keep these separate from facts.

Do not use a single “emergence score.” Do not call a memory causally influential
merely because it was retrieved. Compare repeated runs with an experience removed
or changed, preserving other settings where possible, and report variation.
Temperature or seed settings do not guarantee identical provider behavior.

Use persona tensions and partial information to invite exploration. Do not reward
only the author's preferred resolution. Log surprising legal strategies as
examples for inspection rather than automatically changing the host to block them.

## Regression strategy and current migration

Retain existing core tests and deterministic scenarios. Add tests at the new
format/host boundary as the implementation becomes real. Do not replace tests of
world integrity with model-graded transcripts.

Current `DecisionRecord`, memory records, and scenario snapshots require explicit
mapping to the new format. Preserve old run readers or supply migrations with a
report. Missing clock, host revision, or external-input information cannot be
invented to upgrade an old record into a stronger replay claim.

Rename or qualify the existing `memoryInfluencedDecisions` measure before treating
it as evaluation evidence. Historical model samples remain historical; they do
not establish defaults or expected behavior for new model assignments.

Live-provider runs remain opt-in and budgeted. Mock tests prove configuration and
contract handling, not actual provider compatibility. A release report distinguishes
mock results, deterministic host results, and actual live-provider observations.

## Phase 2 release checklist

- [ ] Six document kinds have versioned schemas, semantics, and fixtures.
- [ ] JSON/Markdown conversion is deterministic; optional extensions survive editing.
- [ ] Required unsupported features and unresolved execution references block launch.
- [ ] Conversation and independent headless-capable 3D hosts use the public package.
- [ ] Character identity is independent of body, renderer, and provider.
- [ ] Perspective isolation and asynchronous action semantics pass host fixtures.
- [ ] Users can author a cast/situation and select models without source edits.
- [ ] Context, selected memories, proposals, and outcomes are inspectable.
- [ ] Playback works without new provider calls; supported replay is verified.
- [ ] Settled restore/branch works and preserves parent history.
- [ ] Credentials are absent from portable artifacts; redaction capability is honest.
- [ ] Request limits, deadlines, usage, and cancellation behavior are documented/tested.
- [ ] Character-card importer reports transformations and unmapped fields.
- [ ] An independent-language reader passes the declared document fixture subset.
- [ ] Two contrasting showcases and an outside-contributor walkthrough are complete.
- [ ] Package install/import, documentation commands, and migration instructions work
      from clean environments with supported Node versions.
- [ ] Release report lists versions, test evidence, live-model samples, and limitations.

## Release report and unresolved choices

Maintain a report per released format/runtime pair. Include the fixture matrix,
reference host versions, provider/model configurations tested, known incompatibilities,
changed semantics, and links to representative artifacts. Never include keys.

The initial 3D engine, independent reader language, schema/type-generation tooling,
and exact migration command names remain implementation choices. Choose them by
proving this checklist rather than broadening the schema to fit one framework.
