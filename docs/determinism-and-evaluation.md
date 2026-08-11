# Determinism and evaluation

The LLM is nondeterministic; the simulation does not need to be.

Record every external decision at the tick where it is applied, in exact
order. For model decisions, also snapshot the immutable request context that
produced the result. `recordDecisionBatch` validates persisted tick ordering,
continues after the greatest existing order, generates stable IDs, and
deep-copies serializable inputs and requests. `replayInputsForTick` validates
that the selected tick is unambiguous and returns defensive copies of the
ordered input stream.

String tie breakers use ECMAScript code-unit ordering rather than locale
collation, so host locale does not change memory, decision, evaluation, or
model-request ordering. Hosts should still use stable, persisted string IDs.

Replay verifies procedural integrity: given the same initial world and input
ledger, the engine should reach the same state. It does not claim a provider
would generate the same prose again.

During construction, keep evaluation small and diagnostic:

- invalid-plan and fallback counts;
- capabilities actually used;
- decisions with request provenance;
- memory evidence selected;
- commitment outcomes; and
- conversation closure health.

Broader behavioral soaks belong after architecture and content stabilize.
They should evaluate scenario outcomes, not exact dialogue text.
