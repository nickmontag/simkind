# Agent context and long-run continuity

Status: original proposal; an initial implementation now exists. See
[Long-run memory](../long-run-memory.md) for the implemented scope and limits. This assessment follows a 192-decision live
economy run. It applies to conversation, constrained-world, and spatial hosts.

The [critical scaling review](agent-context-scaling-review.md) identifies required
refinements before this proposal supports hundreds to thousands of turns. Its
revised priorities supersede the implementation order below: indexed storage,
bounded episodes, and recall must be designed together, with explicit runtime
and memory-quality acceptance evidence.

## What the run establishes

The largest reported request contained 267,779 input tokens. This was partly an
assembly defect: `CharacterRunner.applyStateEdit` places the complete revised
character state in a successful action result, and subsequent requests include
every actor outcome through `ActionLedger.eventsFor`. Repeated state snapshots
therefore resend accumulated memories. At turn 45, one character's outcomes
alone occupied approximately 845,000 characters.

`selectContinuityMemories` separately chooses the latest non-superseded records
by count. It neither budgets tokens nor assesses importance. That limit does not
apply to memories embedded inside outcome snapshots. Observation retention also
stores entire delivered observations, which can contain overlapping histories.

The run had 24 invalid outputs, four timeouts, and one network failure among
192 decisions. This establishes reliability problems, but does not establish
that large contexts caused them. Some failures occurred before context growth.
Nine additional host/tool rejections must remain separate from provider failures.

The current checkpoint embeds history and retained character state. Its 1 MiB
artifact limit can prevent long runs from being saved with continuation support.
Reducing prompts alone will not resolve archival/checkpoint growth.

## Recommended architecture

Separate the complete evidence archive from the character's working context.
Retain original records; choose what must accompany each decision. Begin with a
single context module alongside the portable runner, reusing existing evidence,
revision, and recording contracts. Do not introduce a mandatory vector database
or a fixed psychological planning pipeline.

Each decision should receive:

| Layer | Contents and preservation rule |
| --- | --- |
| Identity and intentions | Current persona, goals, and explicitly maintained intentions. Compaction cannot silently rewrite or abandon them. |
| Current situation | Latest actor-visible observations, available tools, pending actions, and host-verified commitments where the host exposes them. Preserve timestamps, uncertainty, and perspective. |
| Recent experience | Several complete host turns of delivered observations, speech, proposals, and outcomes, with original content and order. The host configures what a turn means and the protected window. |
| Consolidated memory | Model-authored accounts of older experiences, important episodes, relationships, unresolved questions, and evolving interpretations, each linked to evidence. Categories guide the prompt rather than requiring a universal social ontology. |
| Retrieved evidence | Original older episodes selected for the present situation or explicitly requested by the character. |

Current situation must not become omniscient state: a physical observation is
what the host reported, and another character's speech remains a claim. In the
economy, balances should come from current inventory observations rather than
an old autobiographical summary. In other hosts, retain equivalent provenance
and freshness without imposing an inventory-shaped model.

Use compact action receipts in model context: correlation ID, action, status,
effects, revision, and evidence references. A self-revision receipt should name
the revision and changes rather than include every memory. Keep the complete
existing event for audit and backward-compatible playback. Host results need a
defined model-facing projection when their payloads are large; arbitrary JSON
truncation is not a semantic projection.

Deduplicate references to the same delivered event across recent experience,
selected memories, and receipts. Distinct observations must retain their own
provenance even when their content overlaps.

## Model-driven consolidation

Trigger an internal consolidation call before older experience exceeds its
working-context allowance, and allow the character to request consolidation.
The runtime manages capacity; the model decides what the experience means and
what deserves preservation. Use the character's configured model by default,
with a separately configurable consolidation assignment, not an implicit
cheaper-model substitution.

Supply the previous consolidated memory, a bounded batch of newly aging-out
original experience, and current identity, intentions, and visible situation.
Ask it to retain meaningful episodes and exact details when those details matter;
merge redundant experience; preserve promises, reversals, doubts, and unresolved
questions; and distinguish witnessed events, others' claims, and its own beliefs.
It may nominate particularly important evidence for continued inclusion.

For example, an episode could retain: “I told Cleo I had only two coins. She
accepted two timber plus two coins for a tool,” with the speech and transaction
IDs. The terms remain recoverable even if routine intervening conversation is
summarized. It must not infer that Cleo will always grant concessions.

Store the result as a versioned interpretation with source IDs and the exact
event interval it covers. Do not replace the underlying observations. Validate
structure, actor access, reference existence, coverage metadata, and budget;
these checks cannot prove semantic faithfulness. Retain earlier versions so
drift can be inspected and corrected against originals.

Consolidate incrementally. A compactor that receives the entire accumulated
archive simply relocates the 267k-token problem. Preserve useful older episodes
as separately retrievable records so a single continually rewritten paragraph
does not become the only representation of a character's life.

Compaction is memory maintenance, not a world action or a covert opportunity to
change goals. Record its request, model, usage, source cutoff, and accepted
result. Validate the base memory version before committing atomically. New
observations arriving during the call remain outside its cutoff and cannot be
overwritten. Explicit intention changes continue through self-revision.

If consolidation fails, retain the prior version and the unprocessed interval.
Retry within an explicit maintenance allowance; never silently drop important
context or substitute empty memory. If the protected context cannot fit, expose
that condition and pause the affected dispatch rather than truncate invisibly.

## Recall without sacrificing the opportunity to act

Expose read-only search and event reading over each character's own accessible
history. Automatic retrieval can offer relevant episodes, while the character
can ask for the original conversation, agreement, or outcome before deciding.
Reading memory should happen inside the decision opportunity and then return
to deliberation; it should not use up the host turn as an ordinary world action.

Start with source IDs, time ranges, participant filters, and text search.
Retrieval implementations can evolve behind that interface if evaluations show
a need. Enforce actor visibility on every read, including archived and branched
records. Operator-only observations and another character's private memory must
not leak through search or summarization.

Full access means originals remain available, not that every original is always
included. Recent protected turns are lossless by default. If even that window is
too large, surface an explicit capacity decision; do not quietly summarize it.

## Other project-wide work this exposes

1. **Structured decisions.** Provider capabilities currently distinguish text
   and JSON, not schema enforcement. Add explicit support for schema-constrained
   decisions or native tool calls where supported, retaining host validation.
   A bounded correction attempt may repair malformed decisions before any world
   action is admitted. Record every attempt; never execute multiple objects
   because the model emitted more than one. Unknown execution outcomes must
   not be blindly retried.
2. **Internal request lifecycle.** Decision, recall, consolidation, and correction
   requests need distinct purposes and correlated usage. Maintenance must share
   concurrency and spending controls without consuming host action opportunities
   or running indefinitely. Maintain the distinction between wall-clock model
   latency and host-defined simulation time.
3. **Inspectable cognition.** Per-character inspection should show current goals,
   recent experience, consolidated memory, retrieved evidence, and actual supplied
   context. Let the observer compare memory versions and follow source links.
   Show input size by section, maintenance cost, and failures separately from
   chosen idle or lawful rejection. These are observable records, not hidden
   chain-of-thought or proof that a memory caused an action.
4. **Long-run persistence.** Introduce a versioned checkpoint representation with
   compact current state and references to validated archive chunks included in
   the portable recording. Preserve older readers and verify referenced content
   before restoration. Replay uses recorded consolidation results; a fresh model
   continuation may differ. Never promise reproducibility by rerunning a summary
   prompt against a nondeterministic provider.

Input-context budgets and model output allowances are separate settings. This
proposal does not restore the rejected small output cap. Context targets should
be configurable by model and host, leave room for completion, and be calibrated
with measured token usage. Track estimates separately from provider receipts.

## Implementation sequence and acceptance evidence

1. Remove repeated snapshots from model-facing outcomes, add section-size
   telemetry, and preserve recent complete turns plus unresolved work. Exercise
   repeated self-revision to prove the context no longer resends all old states.
2. Add recorded incremental consolidation and accessible original-history recall
   together. Checkpoint the memory versions and coverage cursors. Retrieval must
   be available before relying on summaries to exclude older details.
3. Extend provider capability handling and bounded correction; implement long-run
   archive/checkpoint references and the character memory inspector.
4. Evaluate across at least conversation and constrained-world hosts, with long
   deterministic lifecycle tests and separately labeled live behavioral samples.

Required checks include exact recent-turn preservation; unchanged intentions
through compaction; retrieval of old exact terms and later corrections; retained
uncertainty and contradictory reports; actor privacy; concurrent delivery during
compaction; failed/stale compaction; and restoration with identical memory
versions and coverage. Measure complete costs, including maintenance and retries.

Use controlled histories containing delayed obligations and surprising later
relevance to assess semantic retention. Compare full available history,
recency-only selection, and consolidation plus recall within provider capacity,
using repeated live samples where needed. Evaluate factual recovery and feasible
actions rather than rewarding cooperation, a preferred strategy, or a scripted
ending. Bounded prompts are a necessary engineering property; retained character
continuity must be demonstrated separately.

## Implementation status

The first implementation is described in [Long-run memory](../long-run-memory.md).
The proposal remains a design record; the current guide states implemented guarantees
and outstanding retrieval/semantic evaluation limitations.
