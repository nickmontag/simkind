# Architecture

## Authority boundary

Simkind coordinates a simkin's cognition; the host engine owns truth. Model
output is always untrusted input. A host validates its schema, checks contextual
legality, resolves outcomes, mutates world state, and emits events.

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
| Evaluation | Small stable counters | Game-specific quality rubric and later soak scenarios |
| Host helpers | Validation, explicit outcomes, completion fallback, tick ordering | Contextual legality and action effects |

The deepest seam is `SimkinRuntimeAdapter`. It lets the engine call three
cohesive operations without knowing the internal sequence of request expiry,
social flow, goal maintenance, reflection, or planning.

## Lifecycle

```text
applyInputs
  record exact decisions -> apply valid inputs -> expire requests/fallbacks

advanceInteractions
  conversations -> game story hooks -> proposals

host engine phase
  movement / combat / perception / other procedural consequences

advanceCognition
  motives -> urges -> criteria-backed goals -> reflection -> memory -> planning
```

The split around the host phase is deliberate: a simkin can interact before
combat and perception resolve, then deliberate from the resulting world.

## Design constraints

- No Simkind function calls an LLM synchronously from a simulation tick.
- No model-generated action bypasses the host executor.
- Capability documentation is derived from the same engine-owned catalog used
  to describe the legal action vocabulary.
- Retrieval and replay ordering have explicit deterministic tie breakers.
- Provider failures are returned as ordinary model outcomes rather than unhandled promises.
- Applied, rejected, and fallback outcomes can be attached to their exact decision records.
- Story-specific behavior enters through adapters or hooks, never generic
  conversation code.
