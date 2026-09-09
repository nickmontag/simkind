# Character memory policies

Simkind separates durable evidence and perspective guarantees from replaceable
memory strategy. New runners using `simkind.context` use the situational policy.
It provides useful lexical retrieval without a second service; configure an
embedding adapter to enable hybrid lexical and semantic retrieval. This is an
experimental default with deterministic tests, not a demonstrated SOTA ranking.

## Responsibilities

| Layer | Responsibilities |
| --- | --- |
| Core | Actor-scoped evidence, historical cutoffs, branch isolation, source validation, bounded context, recent-history protection, lifecycle, recording and restoration |
| Memory policy | Situation/concern cues, candidate ranking and selection, optional consolidation scheduling and model guidance |
| Adapters | Storage and embedding connections; applications can replace the policy with a remote retrieval service |
| Character/model | Interpretations, current concerns, intentions, strategy and decisions |
| Host | Observations, tool legality, execution, clocks and disclosure |

The archive preserves what the character received. A report that Bram accused
Cleo is evidence of Bram's allegation, not proof of wrongdoing. Original source
content, source kind and event references survive retrieval unchanged. Model
summaries and concerns remain interpretations, even when their references are
valid. Reference validation does not prove semantic entailment.

## What the default does

Each decision opportunity searches separate, bounded cues from new events,
current observations, current intentions, and model-maintained concerns. The
same intention or concern can prompt recall on later turns. A character need not
ask a factual question to remember an unfinished interaction. Selection is frozen
for format corrections within that opportunity; explicit `simkind.recall` starts
another bounded search.

Search runs over both original evidence and independent episodes. The policy
removes common function words from queries, reranks a wider lexical candidate
pool using content coverage and term rarity, and diversifies across cues. With
embeddings configured, a separate semantic search can retrieve records absent
from the lexical candidate set. Rank fusion combines both paths. The policy
returns references; the core materializes the original records and enforces the
character, cutoff, requested turn range and context allowance again.

Automatic recall considers consolidated originals and older episodes. Intact
recent and unprocessed experience is already present in the context. Up to eight
candidate references are selected, subject to the existing automatic character
allowance (6,000 by default). This is a ceiling, not a requirement to fill the
prompt. Explicit recall can also expand an episode's accessible source evidence
within its separate allowance. It never traverses another character's history.

Consolidation optionally returns `concerns`, up to eight short, source-linked
interpretations of matters the character still considers relevant. Existing
concerns are supplied to subsequent consolidation. Omission preserves them;
`[]` retires them. Each concern cites current batch evidence or sources attached
to prior concerns. Previous memory versions remain archived. This adds no world
action and no mandatory emotion, trust, relationship, or goal-priority schema.
Maintenance cannot change the character's explicit intentions or world state.

The policy uses current circumstances and ongoing concerns, but has no autonomous
alarm scheduler or guaranteed prospective memory. A host must deliver relevant
clock or situation changes, and the model must still interpret and act on them.

## Configure hybrid retrieval

Embedding credentials and connections belong to the embedding application,
separately from portable character and scenario files:

```ts
import { createCharacterRunner, createSituationalMemoryPolicy } from 'simkind/runner';
import { compatibleMemoryEmbeddings } from 'simkind/providers';

const memoryPolicy = createSituationalMemoryPolicy({
  embeddings: compatibleMemoryEmbeddings({
    id: 'openai-text-embedding-3-small:256:v1',
    model: 'openai/text-embedding-3-small',
    dimensions: 256,
    endpoint: 'https://openrouter.ai/api/v1/embeddings',
    apiKey: process.env.OPENROUTER_API_KEY,
  }),
});

// bundle, host, connections and storage are supplied by the embedding application.
const result = createCharacterRunner(bundle, host, connections, 'run:example', {
  storage, memoryPolicy,
});
```

The HTTP adapter also accepts compatible HTTPS endpoints and loopback HTTP
servers. Model availability and requested dimensions depend on that server.
Changing embedding weights, dimensions or text preprocessing requires a new
vector-space identity. The built-in policy identity also records its version and
index batch size. Credentials and endpoint URLs are not included in that identity.

For the repository CLI and playground, configure locally before starting a new
run/server:

```sh
SIMKIND_EMBEDDING_MODEL=openai/text-embedding-3-small
SIMKIND_EMBEDDING_DIMENSIONS=256
```

These use the existing `OPENROUTER_API_KEY`. Optional
`SIMKIND_EMBEDDING_ENDPOINT`, `SIMKIND_EMBEDDING_API_KEY`, and
`SIMKIND_EMBEDDING_ID` select another compatible service and vector space.
No embedding model is silently selected. Fixture mode makes no embedding calls.
The same connection configuration is needed to resume a hybrid run.

The bundled index is an incremental, actor-local, persistent **exact vector
scan**, not an ANN service. Each retrieval embeds at most 32 new records by
default (configurable 1–64) and one batch of up to twelve query cues: at most two
embedding requests. Indexing may lag; `indexComplete` exposes coverage. Embedding
text is a bounded 6,000-character content projection per record; full originals
remain available to lexical search and inspection. Large individual records can
therefore contain details absent from their semantic projection.

This reference index suits modest local archives and needs measurement at your
cast size. Vector reads scale with indexed history. Large casts or archives can
supply a policy backed by an external index; Simkind does not require a graph
service or copy an external index into its portable character schema.

## Replace the policy

A `MemoryPolicy` has a public `identity`, an async `retrieve(input, signal)`,
and optional `consolidationInstruction` and `shouldConsolidate(batch)`.
`shouldConsolidate` can defer or accelerate eligible batches; core capacity
pressure can still require consolidation, and protected recent experience is
never made eligible by the policy.

`input.context` is a copy of the permitted decision context. `input.view` exposes
only frozen actor-local search, pages, exact references, and derived vector-index
operations. There is no host or raw storage handle. Every returned reference is
revalidated, including explicit recall ranges. A foreign or future reference
fails the operation instead of being injected. View methods reject use after
completion or cancellation. They are bounded per page; plugins must also honor
the abort signal and their declared workload limits.

Plugins are trusted application code, not sandboxed processes. These capabilities
prevent accidental access through Simkind's API; they cannot constrain arbitrary
network or filesystem access performed by a plugin itself. Custom services must
scope their own indexes and report their external usage honestly.

## Async lifecycle and evidence

Retrieval runs as a preflight stage in the same scheduler slot as the decision.
Storage reads stay synchronous. It shares the original opportunity deadline,
with an optional `simkind.context.config.retrievalTimeoutMs` ceiling (default
10,000 ms). There is no new world turn or fresh decision deadline for retrieval.
A timeout or adapter failure prevents that opportunity's model decision and is
visible in `contextFailures`; configured semantic search does not silently fall
back to a different policy. Abort-ignoring work retains its concurrency slot until
it settles, and late results cannot start a decision or mutate the memory view.

`memory-retrieval` run events record start, completion, failure or timeout. Successful
completion includes policy identity, mode, queries, selected references, actual
injected IDs, index coverage, embedding call count and reported usage. The subsequent
`request` event contains the exact context sent to the character model. Playback
uses this evidence; it does not rerun approximate search.

The run request budget reserves a character call before retrieval. Retrieval
failure may therefore consume one reservation without issuing a character-model
call. Embedding attempts are separate from that counter, bounded by the policy
per retrieval and included in reported usage. A failed or timed-out call without
a receipt has unknown cost, not proven zero cost. Custom policy services can incur
additional costs; the core cannot meter unreported calls inside arbitrary code.

Checkpoints pin policy identity. Exact restore requires the same policy and its
configured adapters. Old checkpoints without a policy identity retain the legacy
selective lexical behavior; `memoryPolicy: 'legacy'` also creates that behavior
explicitly. Restoring old archives never silently upgrades memory policy. To compare policies
from the same history, copy the frozen archive and explicitly pass a different
`memoryPolicy` together with a new branch run ID to `CharacterRunner.restore`.
The child records the new identity and retains its parent reference; the original
checkpoint is unchanged. The
new event type extends the draft.2 reader schema; older readers may need updating.

## Evaluation and limits

September 9 verification: 261 tests passed, with build/typecheck, external package
consumer, deterministic recordings and Python reader checks. Two scripted
1,000-turn-per-character runs restored exactly and preserved intentions; maximum
serialized contexts were 21,877 and 25,149 characters. Neither run used embeddings
or autonomous model decisions.

The regression suite covers distant details among distractors, semantic candidates
with no lexical overlap, recurring concerns, conflicting testimony, actor/time
isolation, immutable source content, index reuse/coverage, correction reuse,
retrieval cancellation, exact recorded context, and policy compatibility on restore.
Semantic unit tests use scripted orthogonal vectors to test the mechanism. They
do not establish real embedding quality or character believability.

For live evaluation, compare legacy, situational lexical, and hybrid policies
using identical frozen history, reader model, context allowance and completed
opportunities. Include a diagnostic condition supplied with the relevant evidence.
Measure evidence recall separately from the character's answer/action, then run
longer unscripted interactions to test spontaneous commitments, relationship
continuity, corrections and differentiated perspectives. Preserve disagreement
and refusal as valid outcomes. Report ingestion, retrieval and decision costs,
latency, missing receipts and incomplete indexing separately.

Consolidated summaries and concerns are historical interpretations. Their `evidenceThrough` is an actor-local archive sequence, not a turn number; `temporalScope` tells the model to reconcile them with recent experiences and current observations. Consolidation only sees its eligible historical batch, so a concern can legitimately lag a recent resolution. Recent context remains available separately; no extra synchronization call is required.
