# Design proposals

Status: draft designs. Audience: contributors designing future releases.

These documents describe Phase 2 targets and their implementation status, not an
established standard. M1/M2 have [current runnable guidance](../portable-scenarios.md).
Start with the [roadmap](../../roadmap.md) for direction
and milestones. Use the [current guides](../README.md) for supported behavior.

Read in this order:

1. [Format and schema architecture](schema.md): portable document kinds,
   JSON and Markdown, references, ownership, profiles, and versioning.
2. [Host protocol and embodiment](host-protocol.md): perspectives, tools,
   asynchronous actions, clocks, optional bodies, and replay capabilities.
3. [Playground and authoring](playground.md): authoring, running, inspection,
   interventions, sharing, and contribution workflows.
4. [Conformance and release gates](conformance.md): proposed fixtures,
   compatibility claims, behavioral evaluation, migration, and release evidence.

The guiding constraint is emergent behavior: structure the world and its
consequences while letting characters choose how to act. Headless operation,
embodiment, and simulated versus physical execution are independent concerns.

Keep contracts, rationale, open questions, and acceptance criteria here.
Temporary task ordering and agent handoffs belong in the ignored local workspace.
As implementations land, update proposal status and link to current guidance;
follow the [documentation policy](../documentation-policy.md).
