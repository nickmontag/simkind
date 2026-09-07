# Phase 2 alpha roadmap

Status: planned direction, not shipped functionality. The current release is
0.1.0; see the [current documentation](docs/README.md) for supported behavior.
Milestones describe outcomes and dependencies, not committed dates.

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

## Planned milestones

| Milestone | Public outcome | Depends on |
| --- | --- | --- |
| M1 — Portable contract and runner | Draft JSON Schemas, a precise Markdown mapping, validation, and a minimal character loop shared by conversation and constrained-world hosts | — |
| M2 — Authorable casts and situations | Change characters, private knowledge, tools, models, and run limits without editing TypeScript; reuse one host across different scenarios | M1 |
| M3 — Continuity and social behavior | Supply actual memory content with provenance; distinguish observations from beliefs; support editable intentions and optional reflection or agreement recipes | M1, exercised through M2 |
| M4 — Playground and inspector | Author, run, pause, inspect perspectives and consequences, and open recorded runs locally; explicit BYOK and model selection | M1–M2, incorporating M3 |
| M5 — Resume and branches | Restore complete supported checkpoints, record interventions, and compare new continuations while keeping parent runs immutable | M1, M4, host checkpoint support |
| M6 — Embedding and headless 3D | Publish an npm alpha, embedding starter, optional spatial profile, and independent 3D reference host with headless and viewer modes; expand provider and local-model support | M1, stabilized against M2–M5 |
| M7 — Interoperability and release | Editable showcase scenarios, shareable run bundles, character-card conversion reports, and an independent-language format reader | M1–M6 |

The alpha already has capability catalogs, memory ranking, evidence-backed
commitments, asynchronous model requests, and host-specific decision replay.
A portable format, general runner, playground, and general branching system
remain future work. The proposed format is an open-standard candidate, not
an established interoperability standard.

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
