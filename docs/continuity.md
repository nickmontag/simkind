# Continuity and character state

The portable runner supports the optional `simkind.continuity` profile, version
`0.1.0`, alongside draft.2 documents. Enable it through
`config-continuity.json`, or declare it in a run configuration:

```json
{
  "profiles": {"simkind.continuity": {"version": "0.1.0", "required": true}},
  "features": {"simkind.continuity": {"enabled": true, "config": {}}}
}
```

This is a fragment to merge into a complete run-config. The profile adds two
capabilities: retention of delivered observations and the `simkind.revise` tool.
It does not schedule reflection, choose priorities, enforce cooperation, or
require a character to maintain intentions.

## Evidence and interpretation

Retained experiences contain the full delivered observation, including recipient,
source, revision, capture/delivery times, uncertainty, and content. They reference
the original run and observation. Redelivery is idempotent; conflicting reuse of
an observation ID fails. Each character retains only its own delivered content.
A host observation is a record of what the host reported, not universal truth.

Authored memories, observations, reports, and interpretations have distinct
`source.kind` values. Model-written interpretations cannot overwrite an
observation. An interpretation can supersede an earlier interpretation; both
remain in the exported state. Speech is an observed utterance, not proof of its
claims. State edits have no world effects and cannot fulfill host commitments.

Every request includes actual memory text, original provenance, current
intentions, and `stateRevision`. With continuity enabled, selection uses the most
recent non-superseded records in insertion order, capped by the memory-retrieval
profile's `maxItems`. This deliberately makes no relevance or causal-influence
claim. Without continuity, memory-retrieval `0.1.0` retains its stable-ID ordering.
Disabling retrieval sends no memories but keeps stored experiences exportable.
Disabling continuity stops new retention and removes the self-revision tool.

## Optional self-revision

The character may choose `simkind.revise` as its decision:

```json
{
  "toolId": "simkind.revise",
  "arguments": {
    "expectedRevision": 4,
    "intentions": [{"id": "intention:listen", "description": "Find out what Mira needs."}],
    "interpretation": "Mira may value timing more than quantity.",
    "evidence": ["experience:2"]
  }
}
```

Omit `intentions` to preserve them; `[]` abandons them. Evidence and supersedes
references must be among the memories supplied to this request. Stale edits,
duplicate IDs, malformed revisions, and attempts to supersede observations are
rejected atomically. Accepted edits increment the character revision and produce
normal proposal/admission/outcome records labeled `character-self-report`.
The tool's permissions apply only to the requesting character's state.

`reviseState` is also available as a pure transaction from `simkind/runner`.
`runner.intervene(actor, edit, operator)` applies an operator-authored transaction
at a settled boundary. Its result is labeled `operator`; rejected attempts remain
in the event history. Operator edits do not become evidence of model reasoning.

## Optional recipes

Recipes are authoring suggestions, not extra schedulers:

- **Reflection:** make `simkind.revise` available. A persona may invite the
  character to reconsider an interpretation when contrary evidence appears.
  The character may instead act, wait, refuse, or leave the belief unchanged.
- **Agreement:** use `say` to propose terms and another participant's `say` to
  accept, negotiate, or refuse. Characters can record their own intentions. A
  claimed agreement remains a report until the host defines and verifies its
  terms. Applications needing verified fulfillment can use the existing
  `evaluateCommitment` primitive with actual action evidence.
- **Changing plans:** let the character replace its intention list or abandon it.
  Tests protect evidence and permissions; they do not require a preferred ending.

Memory retention is bounded by the run's step limit, not by a separate store
quota. Large histories can exceed the settled checkpoint profile's 1 MiB artifact
limit; save playback evidence or use host-owned archival storage. No vector store,
universal social ontology, automatic summarizer, or mandatory planner is included.

Legacy examples now supply recalled text and evidence as well as memory IDs.
The village report's `recalledMemoryDecisions` measures co-occurrence; the old
`memoryInfluencedDecisions` field remains as a deprecated compatibility alias.
Neither field demonstrates that a memory caused a decision.

`simkind.revise.supersedes` contains supplied interpretation-memory IDs. It does not accept intention, goal, observation, or action IDs. Change intentions with `intentions`; superseding an interpretation retains its original evidence.
