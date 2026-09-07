# Architecture

This describes the current alpha. For proposed Phase 2 contracts, start with the
[roadmap](https://github.com/nickmibarra/simkind/blob/main/roadmap.md) and [format architecture](https://github.com/nickmibarra/simkind/blob/main/docs/design/schema.md).

## Authority boundary

Simkind coordinates an LLM-driven simkin's cognition; the host owns action
execution and authoritative records of effects. Model output is untrusted input.
The host validates its schema, checks contextual legality, resolves outcomes,
mutates world state, and emits events. Physical-world hosts may observe uncertain
state; their measurements are not assumed to be omniscient ground truth.

## Modules and seams

| Module | Simkind responsibility | Host implementation |
| --- | --- | --- |
| Capabilities | One catalog format and prompt rendering | Intent union, shape schema, contextual affordances, executor |
| Memory | Deterministic ranking and access touch | Memory creation, provenance, compaction, disclosure rules |
| Goals | Criterion vocabulary and progress aggregation | Evidence queries and resolution operations |
| Conversation | Lifecycle directive | Participants, dialogue generation, story hooks, relationship effects |
| Runtime | Stable lifecycle ordering | Each phase through `SimkinRuntimeAdapter` |
| Model runtime | Async dispatch, priority, request-correlated outcome polling | Provider, prompt, schema parsing, retry, fallback |
| Decisions | Exact input ledger and tick replay | Input type, request snapshot, persistence |
| Evaluation | Small stable counters | Simulation-specific quality rubric and later soak scenarios |
| Host helpers | Validation, explicit outcomes, completion fallback, tick ordering | Contextual legality and action effects |

The deepest seam is `SimkinRuntimeAdapter`. It lets the engine call three
cohesive operations without knowing the internal sequence of request expiry,
social flow, goal maintenance, reflection, or planning.

## Lifecycle

```text
applyInputs
  record exact decisions -> apply valid inputs -> expire requests/fallbacks

advanceInteractions
  conversations -> host event hooks -> proposals

host engine phase
  movement / resource changes / perception / other procedural consequences

advanceCognition
  motives -> urges -> criteria-backed goals -> reflection -> memory -> planning
```

The cognition sequence above illustrates possible host work, not a mandatory
LLM workflow. The runtime calls the adapter; characters remain free to choose
their strategy, and reflection or planning policies remain host-defined.

The split around the host phase is deliberate: a simkin can interact before
world updates and perception resolve, then deliberate from the resulting world.

## Design constraints

- No Simkind function calls an LLM synchronously from a simulation tick.
- No model-generated action bypasses the host executor.
- Capability documentation is derived from the same engine-owned catalog used
  to describe the legal action vocabulary.
- Retrieval and replay ordering have explicit deterministic tie breakers.
- Provider failures are returned as ordinary model outcomes rather than unhandled promises.
- Applied, rejected, and fallback outcomes can be attached to their exact decision records.
- Domain-specific behavior enters through adapters or hooks, never generic
  conversation code.
