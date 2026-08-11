# Host-game integration

## 1. Define the legal action vocabulary

Create an engine-owned intent union and runtime schema. Then define a complete
catalog with `defineCapabilityCatalog`. Derive prompt documentation from that
catalog and derive contextual affordances from current world state.

Use `satisfies Record<Intent['kind'], CapabilityDefinition>` when declaring the
catalog so TypeScript reports missing intent kinds. `defineCapabilityCatalog`
preserves the narrower literal type but cannot infer a separate host intent
union by itself.

The catalog answers “what can this engine express?” Contextual affordances and
the executor answer “what is legal for this Character right now?”

## 2. Implement the runtime adapter

Implement `CharacterRuntimeAdapter<World, Context, Input>`:

- `recordInputs`: append exact tick-ordered inputs and optional request context;
- `applyInputs`: validate request identity and apply inputs;
- `expireRequests`: produce deterministic fallbacks when appropriate;
- `interactions`: advance generic social state plus game hooks; and
- `cognition`: update goals, memory/reflection, and enqueue new requests.

Construct the runtime once with `createCharacterRuntime`. Call it from the
engine tick at the documented lifecycle seams.

## 3. Keep model work asynchronous

Build immutable request contexts from engine state. Send them to a provider
outside the deterministic tick. On a later tick, feed parsed results back as
ordinary host inputs. `ModelRuntime` supplies queueing mechanics but leaves
prompting, validation, retries, and fallback content to the host.

`poll` returns request-correlated completion envelopes. Handle both
`fulfilled` and `rejected` outcomes; rejected request IDs stay dispatched, so
retry policy remains explicit in the host. `reset` starts a new generation and
ignores completions from older work. It cannot cancel provider promises, and
older work continues to occupy concurrency until it settles.

## 4. Add a game adapter

Story rules such as a scripted opening, quest handoff, archive consultation,
or village ritual belong in the game adapter. They may decorate generic
conversation behavior without becoming kernel dependencies.

## 5. Persist the decision ledger

Persist `DecisionRecord` alongside the world. Store the originating request
snapshot when the decision came from a model. This makes failures inspectable
and lets deterministic engine replay consume the exact same inputs.
