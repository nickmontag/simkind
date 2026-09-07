# Goals and memory

## Two kinds of goals

A host may represent subjective direction—identity, aspirations, or desires—
in its own character model. `north_star` is a conceptual label, not an exported
Simkind type or required goal category. Use the exported `Commitment` interface
when the host needs to evaluate explicit evidence criteria. Characters remain
free to choose how to pursue their goals.

Simkind supports criteria backed by memories, events, inventory, and
relationships. The host implements `GoalEvidenceAdapter`, because only the
host knows how those records live in its world.

The adapter reports a numeric `matched` value. Memory and event criteria compare
it with `count`, inventory criteria compare it with `qty`, and relationship
criteria require one threshold match.

Criteria-backed commitments should resolve from engine evidence rather than
an LLM's assertion. Subjective goals may remain reflection-owned.

## Retrieval

`rankMemories` uses importance, confidence, recency, access recency, subject,
and lexical overlap. It returns original records so provenance is preserved.
Use `touchMemories` only after selected evidence is actually emitted in a
request—not merely considered during retrieval.

Model contexts should receive structured evidence, including memory IDs and
provenance, rather than an untraceable prose summary. Limit evidence sharply;
more context is not automatically better simkin reasoning.
