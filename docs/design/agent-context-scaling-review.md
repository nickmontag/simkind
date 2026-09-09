# Critical review: hundreds to thousands of turns

Status: design review informing the initial implementation. See the
[current memory guide](../long-run-memory.md) for delivered behavior, measurements,
and remaining evaluation gaps. Reviews [agent context](agent-context.md).

## Verdict

The separation of evidence, recent experience, current intentions, and interpreted
memory is sound. The proposal is not yet sufficient for a thousand-turn claim.
It leaves retrieval effectiveness, repeated summarization, storage complexity,
and maintenance scheduling underspecified. Prompt size can remain bounded while
memory quality degrades, the archive grows quadratically, or slow maintenance
changes which characters get to act.

Keep model-driven consolidation. Strengthen the surrounding storage, retrieval,
and runtime contracts rather than giving procedural rules authority over what
a character values. No compact representation can guarantee preservation of
every detail that might become important later. Exact evidence retention plus
tested discovery is the defensible promise.

## 1. A lifetime summary is an unsafe center of memory

The original proposal already retains episodes, but still suggests sending the
previous consolidated memory into successive rewrites. Unless tightly scoped,
that either grows without bound or repeatedly subjects the same old experiences
to lossy rewriting. A source link can establish where a statement came from; it
does not prove the statement faithfully represents that source.

Make bounded, independently addressable episodes the durable interpreted memory.
Generate each episode from original experience. Let the model identify meaningful
groupings within bounded input batches; record continuation links if an episode
crosses batches. Retain separate source intervals and processing cursors, since
having processed every event does not mean every detail survived interpretation.

Maintain a small working summary and selected topic/person interpretations above
those episodes. Update only relevant records. Model-directed rewrites should be
able to consult original evidence; avoid deriving every revision solely from
earlier prose. Old versions remain accessible, but never load all versions into
every decision. Corrections supersede interpretations without erasing history.

Do not require a deep summary tree or a graph database initially. A shallow
working summary plus indexed episodes is a simpler hypothesis to test. Add
hierarchical navigation only if flat retrieval demonstrably fails at target size.

## 2. Retrieval is necessary infrastructure

“The character can ask for originals” is insufficient when it has forgotten that
an event exists. Automatic retrieval should be cued by the current situation,
active intentions, participants, and relevant time ranges. The model should also
be able to broaden a search or follow an episode's evidence before acting.

Index original experience as well as interpreted memory. Otherwise a detail
omitted by consolidation may effectively disappear even though its bytes remain
on disk. Retrieve coherent event/turn chunks with adjacent context; isolated facts
can lose qualifications, speakers, or sequence. Return source time, delivery time,
and known correction links so stale claims can be recognized.

Start with indexed text and temporal/entity filters as a measured baseline. Compare
semantic retrieval or model-expanded queries on paraphrased and indirect cues;
do not assume lexical search is sufficient. A dedicated vector service is not
required to keep retrieval replaceable. Bound results, original-event expansions,
and deliberation calls. Record both selected evidence and the retrieval version.

LongMemEval evaluates recall, multi-session reasoning, changes, temporal reasoning,
and abstention. Its reported experiments show that granularity and time-aware
retrieval matter, and that correct retrieval alone does not guarantee correct
reading. These support separate retrieval and interpretation evaluations; they
do not establish performance for Simkind's models or interactive simulations.
[Primary source](https://xiaowu0162.github.io/long-mem-eval/).

## 3. Every growing structure needs an explicit policy

For a fixed number of actors and a bounded volume of new experience per turn,
target the following properties:

| Structure/work | Target |
| --- | --- |
| Decision input | Bounded working context, independent of archive age. |
| Consolidation input | Bounded new batch plus selected prior memory, never all episodes. |
| Original archive | Approximately linear growth in delivered bytes and recorded operations. |
| Resident character memory | Working set plus bounded caches, not the entire archive. |
| Event admission | Touch affected actions; do not clone all past actions. |
| Inspection | Cursor/page reads and compact current state. |
| Resume | Load a checkpoint and bounded journal tail, not replay the lifetime ledger. |

Indexed queries may grow with archive size; measure that growth rather than promise
constant-time retrieval. Total model work should grow approximately linearly with
turn count under a fixed workload and bounded maintenance/retrieval allowances.
If a decision uses D tokens, consolidation uses C every k turns, and additional
recall/correction uses R tokens, an illustrative accounting is T*D + ceil(T/k)*C
+ R. Include generated tokens and all attempts in actual cost accounting.

“All important memories stay pinned” is not a capacity policy. Pins, intentions,
relationships, and open commitments can themselves grow. Keep core persona and
the explicit current intention set protected; expose overflow rather than silently
discarding them. Let the character explicitly retire or reprioritize intentions.
Keep host obligations durable and queryable, with exact relevant/due items
surfaced through the actor's authorized observations. The host's complete
obligation registry must not depend on a summary remembering it.

Several complete recent turns also have no fixed size. Define the guarantee in
terms of host-delivered content and an explicit supported volume. Large spatial
or document observations need host-defined representations and original access.
If protected content cannot fit, pause or use an explicitly configured host policy;
do not claim both arbitrary-size verbatim inclusion and a fixed context ceiling.
Compaction should trigger with enough headroom for new observations and an in-flight
maintenance call. Output-token allowance remains a separate setting.

## 4. Storage work must move earlier

The current implementation has additional costs outside the model prompt:

- `ActionLedger.receive` clones the whole action map and copies the event-ID map
  for each received batch. `unresolved` scans all actions, including completed ones.
- `retainObservation` scans and expands retained memory; `reviseState` clones the
  accumulated character state. Full revision snapshots also duplicate archive data.
- `CharacterRunner.inspect` clones launch state, and playground polling returns
  that retained character state even when event delivery uses a cursor.
- Checkpoints include launch state and the entire event history. `saveRun` builds
  the complete serialized event stream in memory. `loadRun` loads all events and
  enforces 32 MiB per resource and 64 MiB total playback limits, in addition to
  the 1 MiB checkpoint constraint.

A local, single-process probe admitted one accepted/succeeded event pair per tiny
action after a warmup: 100 actions took 17 ms, 1,000 took 1,523 ms, and 3,000 took
14,014 ms. The last 100 actions respectively took 17, 284, and 891 ms. This is a
single ledger microbenchmark, not full-run latency or a production benchmark.
It corroborates the quadratic cumulative copying implied by the source, even
before large memory payloads are introduced.

Preserve atomic validation by staging only affected action records, not removing
transactionality. Index active actions separately, keep historical deduplication
checks in indexed storage, and append evidence durably. Store revision deltas or
references to immutable state records in a new recording version; merely hiding
duplicated snapshots from prompts leaves archive amplification intact.

Use chunked evidence, bounded caches, compact checkpoints, and paged inspection
as part of the first long-run implementation. A local indexed store with portable
chunk export is a plausible starting point. Existing recording formats remain
readable. Do not merely raise existing limits: version the larger-run profile
and preserve resource checks, hashes, actor visibility, and crash recovery.
Branches share immutable history only through their fork cutoff; sibling future
events must remain inaccessible to recall.

## 5. Extra model calls need simulation semantics

Recall, consolidation, and correction need an explicit request lifecycle with
purpose, actor, observation cutoff, deadline, cancellation, and cost accounting.
Within a decision opportunity, reads must use the same authorized knowledge
cutoff. New observations require an explicit refresh or a new decision, rather
than leaking later information into an older request.

Background consolidation may commit a new memory version only against the expected
base version and recorded cutoff. It cannot modify a dispatched context. Persist
unprocessed experience and unfinished maintenance so a crash does not create a gap.

Maintenance demand must remain below available capacity over sustained operation.
Monitor backlog age/bytes and reserve capacity so it cannot indefinitely starve
world decisions. Conversely, decision traffic cannot indefinitely starve necessary
consolidation. Use bounded retries and headroom before overload.

“Doesn't consume a turn” is an action-accounting rule, not a latency guarantee.
Turn-based hosts should define whether the decision boundary waits. Real-time
hosts need their own deadline/degradation behavior. An arbitrary per-character
pause can change opportunities and economic outcomes; that behavior must be
explicit and observable. Optional reflection remains a character choice, distinct
from operational memory maintenance.

## 6. Required evidence before claiming scale

Run deterministic workloads at 100, 1,000, and 10,000 turns per character across
at least two hosts. Vary delivered bytes, event density, active obligations, and
actor count separately. Include idle polling, repeated self-revision, large
observations, failures, crashes, and forks. Measure input size, archive bytes,
resident memory, per-turn processing, maintenance backlog, and restore time.
These tests establish mechanics, not model memory quality.

Use separately budgeted live evaluations with original evidence from early,
middle, and late history: exact terms, a promise due hundreds of turns later,
later-corrected information, uncertain claims, details unimportant when formed,
paraphrased cues, and multi-episode deductions. Test unknown-information abstention
and privacy across actors and branches. Compare direct retrieval, consolidation
plus retrieval, and available-history baselines; preserve episodes in all variants
where needed to isolate the value of the working summary.

Report source retrieval recall, factual reconstruction, unsupported claims,
action validity, cost, and latency separately. Repeated compactions require
repeated quality checks, not only an end-of-run success case. A delayed-obligation
test should measure whether the agent recalls and reasons about the obligation;
the character may still knowingly refuse it. Behavioral success must not become
a compulsory cooperative script.

## Revised priority

Keep three distinct responsibilities: evidence storage/access, model-maintained
memory/retrieval, and decision-context assembly. Integrate internal requests into
the existing scheduler rather than hiding their lifecycle inside a prompt builder.
These can remain local modules in the same package.

First fix snapshot duplication and measure the full data path. Next build indexed
archival storage, paging, and compact restoration together with bounded episodes,
consolidation, and recall. Prove the mechanics and semantic retention before adding
deeper memory hierarchies or claiming thousand-turn readiness. Provider reliability
can proceed independently, but memory evaluation must report its failures.
