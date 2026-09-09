# Long-run character memory

The optional `simkind.context` profile keeps recent experience and current intentions
in the decision context while storing original experiences and model-authored episodes
in an indexed archive. It requires `simkind.continuity`. The playground's economy
setup enables it; existing configurations and recording readers retain their old behavior.

This is a measured baseline for long sessions, not a guarantee of perfect recall.
A summary can omit or misinterpret something. The original evidence remains available
for retrieval and inspection.

## Context and consolidation

A decision contains the persona, explicit current intentions, current authorized
observations, complete delivered experience from the protected recent turns,
unprocessed older experience, a bounded working summary, and selected older memories.
It no longer receives the entire action ledger or repeated character-state snapshots.

When an older batch is ready, a separate model request writes independent episodes
and updates the working summary. Maintenance instructions preserve parties, direction, conditions, source perspective,
and uncertainty. A batch without a completion receipt must not predict the outcome
or its properties; subjective feelings remain attributed interpretations. These
are model instructions, not an entailment guarantee. Episode citations must name supplied memory IDs;
the request's tool schema enumerates those IDs. Each episode retains links to its
original evidence. Successful consolidation advances a versioned processing cursor.
It cannot alter goals, inventories, contracts, or other world state.

The character can call `simkind.recall` with words, a lifetime turn range, or exact
memory IDs, then choose its action within the same opportunity. Recall searches
both original experience and interpreted episodes, always within that character's
knowledge cutoff. A private message delivered to someone else is unavailable.
Branching copies the frozen archive; sibling futures never enter that copy.

New runners use the [situational memory policy](memory-policies.md). It searches
current events and circumstances, unchanged intentions and model-maintained
concerns through separate bounded cues, then ranks original and interpreted
memories together. Configure an embedding adapter for independent semantic
candidates and hybrid retrieval. Without one, the mode is explicitly lexical.

Automatic selection is bounded by
`min(maxRecallChars, maxAutomaticRecallChars ?? 6000)`. Explicit recall retains
its separate allowance and source expansion. Set `maxAutomaticRecallChars` to
zero to disable automatic reminders without disabling deliberate recall.

The core enforces original evidence, actor visibility, historical cutoffs, and
context capacity independently of the selected policy. Retrieval is asynchronous,
shares the original opportunity budget, and records the selected evidence and
actual model context. The policy guide describes cancellation, usage, index
coverage, current limitations and custom adapters.

Old checkpoints without a memory-policy identity retain the earlier selective
lexical policy: at most three direct reminders from changed textual observations
or changed intentions, without automatic citation expansion. New summary versions
or unchanged intentions alone do not trigger that legacy policy. Original
evidence remains searchable under either policy.

## Configuration

Add this profile alongside continuity in a run configuration:

```json
{
  "profiles": {
    "simkind.continuity": { "version": "0.1.0", "required": true },
    "simkind.context": { "version": "0.1.0", "required": true }
  },
  "features": {
    "simkind.continuity": { "enabled": true, "config": {} },
    "simkind.context": {
      "enabled": true,
      "config": {
        "recentTurns": 4,
        "batchRecords": 24,
        "batchTurns": 8,
        "maxContextChars": 128000,
        "maxBatchChars": 48000,
        "maxSummaryChars": 6000,
        "maxRecallChars": 24000,
        "maxAutomaticRecallChars": 6000,
        "maxInternalCalls": 4
      }
    }
  }
}
```

These are character-count limits, not tokenizer estimates. Provider input usage is
recorded separately. Output-token allowance is independent: the compatible transport
omits `max_tokens` unless you explicitly configure `maxOutputTokens`.

`batchRecords` and `batchTurns` trigger processing of older evidence; the batch character
volume can trigger earlier. Recent turns remain protected. With this profile,
`simkind.memory-retrieval.maxItems` does not control the archived retrieval path;
`maxRecallChars` and bounded search pages do. Keep continuity enabled.

Context assembly also measures the fully bound request. If selected older memories
push it over capacity, it removes the lowest-priority selections from this request;
their originals remain searchable. If protected input still exceeds capacity, the
runner can consolidate eligible older experience before the routine batch threshold.
This uses the same maintenance budget and never compacts protected recent turns.

Consolidation, recall, and correction count against the run's request limit and the
opportunity's internal-call allowance. They share its original knowledge cutoff.
By default they also share its original deadline. For turn-based hosts, optional
`maintenanceTimeoutMs` (0–300000) in the context config gives an initial
consolidation stage its own bounded allowance, followed by up to
`requestTimeoutMs` for decision work. Retries do not reset either stage. Omitted
or zero preserves the shared deadline. `settleDecisions()` waits for those calls and the resulting decision without
advancing host time. Realtime hosts still own their stepping policy: internal calls
are real latency, and may miss an opportunity if the world advances.

Protected input overflow produces an explicit `status().contextFailures` entry.
The runner does not silently discard intentions or truncate recent turns. Increase
capacity, reduce the host's delivered volume, or change the character's intentions
explicitly. Capacity failure and a character choosing no action are different outcomes.

## Storage, saving, and recovery

The core accepts a `RunnerStorage`; its default in-memory adapter is convenient for
small runs and tests. Use the Node SQLite adapter for durable long sessions. It uses
Node's built-in SQLite and requires Node 22.16 or later for the
[backup API](https://nodejs.org/api/sqlite.html#sqlitebackupsourceDb-path-options).

```ts
import { createCharacterRunner, CharacterRunner } from 'simkind/runner';
import {
  SqliteRunnerStorage, saveArchivedRun, openArchivedRun,
  recoverArchivedCheckpoint,
} from 'simkind/node';

const storage = new SqliteRunnerStorage('./active.sqlite');
const result = createCharacterRunner(bundle, host, connections, 'run:example', { storage });
if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
const runner = result.value;
runner.step();
await runner.settleDecisions();
runner.checkpoint(); // durable settled boundary; requires a checkpoint-capable host
await saveArchivedRun('./recording-example', runner, bundle, storage);

const recording = await openArchivedRun('./recording-example');
const page = recording.events(0, 128); // zero-based event cursor
recording.close();

// After interruption, recover into a NEW writable file. The source stays intact.
const recovered = await recoverArchivedCheckpoint('./active.sqlite', './recovered.sqlite');
const resumed = CharacterRunner.restore(recovered.checkpoint, host, connections,
  undefined, { storage: recovered.storage });
// Close storage after its runner has stopped and outstanding callbacks have settled.
```

`simkind.checkpoint/2` stores current state and archive cutoffs rather than lifetime
history. `simkind.archive/1.0.0` recordings contain a frozen SQLite database, a compact
checkpoint, hashed input sources, and JSONL event chunks. They require
`openArchivedRun`; `loadRun` remains the legacy reader and refuses this profile.
Save only at a settled boundary into a new directory. Opening verifies all resource
hashes with streaming reads. That verification and database copying still take time
proportional to archive size; restoring current state does not replay lifetime actions.

Crash recovery rewinds a copy to the last settled checkpoint. It does not guess the
outcomes of interrupted external effects. Physical hosts need their own reconciliation
policy and should not advertise simulated rollback capabilities.

Reference conversation and settlement hosts archive delivered messages and restore
current state directly. Other hosts must bound their own active world representation.
The economy host still retains its operator market history; its world snapshot is
not intended to grow indefinitely. The checkpoint profile has a 16 MiB current-state
allowance, independent of the history archive.

## Observing a run

The turn report continues to show each character's ordered actions and outcomes.
Consolidation appears as memory maintenance, separately from a world action.
Select an item to load its original evidence on demand.

In **More → Diagnostics**, choose a character under **Perspective**, expand
**Character memory**, and select **Inspect memory**. This reads the current summary,
intentions, recent memory versions, and searchable original evidence without an LLM
call. It is the current saved/live boundary, not a reconstruction at the playback slider.

**More → Saved runs** saves or opens the archive. Back, the slider, and recorded
playback only browse evidence. Branching creates a separate continuation. CSV export
uses the full market report for the selected turn. Single-file playback exports have
a 32 MiB bound; larger sessions use the saved archive directory.

The browser pages evidence and keeps compact timeline projections. It still accumulates
those small rows and turn frames; browser memory is not constant over arbitrarily long
playback. Full prompts remain on disk until explicitly inspected.

## Verification

```sh
npm run check
npm run check:consumer
npm run check:long-runs
# Shorter deterministic pass:
npm run check:long-runs -- --turns 100,1000
```

The deterministic workload exercises conversation and settlement hosts at 100, 1,000,
and 10,000 turns per actor, including repeated self-revision, consolidation, indexed
retrieval, and exact restore. Tests separately cover private/future evidence cutoffs,
failed transactions, rejected/stale consolidation, bounded correction attempts,
capacity overflow, crash recovery, archive tampering, playback, and sibling branches.
Fixture consolidation proves lifecycle mechanics, not semantic memory quality.

Earlier snapshot-based implementation measurements at 10,000 turns with three actors each: conversation requests stayed
below 18k characters and settlement below 31k; checkpoints stayed below 26 KiB;
restoring current state took under 80 ms. Frozen archives were approximately
625 MB and 1.07 GB. Indexed retrieval slowed as matching history accumulated: the
settlement's last 100-turn block took about 4.7 seconds versus 0.6 seconds initially.
These are single-machine measurements, not a comparative intelligence benchmark.

A separate, opt-in live harness preserves its call counter across phases in the
output directory. It requires an explicit ceiling and a model supporting JSON Schema:

```sh
npm run evaluate:memory -- --phase memory --model YOUR_MODEL --max-calls 300
npm run evaluate:memory -- --phase economy --model YOUR_MODEL --max-calls 300
```

The first phase delivers 1,009 turns of controlled history to two actors. World
actions are scripted idle except for checkpoint questions; consolidation and
question/recall answers use the real model. It tests amended terms, a distant
deadline, an initial unaccepted offer, an uncertain claim, an incidental detail,
private codes, and abstention. The economy phase uses real decisions throughout
a six-day economy. Calls include retries and maintenance. Do not run multiple
harness processes against the same counter directory. The raw call trace, usage,
reports, and immutable recordings stay local; inspect answers rather than treating
valid JSON or a summary's source links as evidence of correctness.

See the [dated evaluation](long-run-evaluation.md) for live recall answers, failures,
follow-up fixes, the economy outcome, and complete reported usage.

### Decision isolation, evidence, and recovery

Each completed provider call now wakes the runner independently. Compaction, recall,
and correction continue within that actor's bounded opportunity (with separate
maintenance time only when explicitly configured); a slow
peer cannot prevent a fast actor from processing its result. Global concurrency and
request ceilings still apply. Timed-out work retains its slot until the provider
actually settles. `drainProviders(timeoutMs = 1000)` provides bounded cleanup and
returns false when work remains; it does not grant another opportunity.

For model-authored `simkind.revise`, omit `expectedRevision`. The runner attaches
`stateRevision` from the original decision context, including after maintenance or
correction retries. A supplied legacy value must match that frozen revision. The
host application still checks for intervening character changes. Operator edits
continue to require an explicit revision; no stale update is silently rebased.

`DecisionContext.memoryEvidence` distinguishes action proposals, lifecycle receipts,
observations, dialogue, narrative, and interpretations, including the authority
of perceived events. Archived action evidence includes its originating
proposal so that “succeeded” has an explicit operation: successfully posting an offer
is different from completing an exchange. Hosts describe the actual effects of
operations, and expose reservations separately from available and owned totals.
These are evidence semantics, not model-selected strategies.

The working summary is explicitly an interpretation, with `evidenceThrough` identifying
its last consolidated evidence sequence. Current observations remain the current
state source; intentions are separate agent-authored plans. Recall of an episode
also retrieves accessible cited originals within the same actor, history cutoff,
and character allowance. If evidence does not fit, request its IDs directly.
Citation validation establishes provenance, not factual entailment; summaries can
still misinterpret their sources. No second model audits every compaction.

`saveArchivedRun` returns `{ resumable }`. It first allows bounded provider cleanup.
If no settled checkpoint is possible, it saves an evidence-only archive using
`simkind.archive` version `1.1.0`: hashed SQLite history, event chunks, frozen inputs,
and `launch.json`, with restore and branch explicitly disabled. `openArchivedRun`
returns `checkpoint` only for resumable recordings, plus `launch` and `eventCount`
for either kind. Version `1.0.0` settled archives remain readable. The playground can
replay and inspect both kinds. A failed checkpoint never turns into a fabricated
resumable boundary; the active database still retains any earlier recovery checkpoint.
The live evaluation harness saves its report before export, including failed trials.

## Event delivery and supervised execution

Current reference hosts separate current state from event history. Repeated world
snapshots stay in the audit archive without becoming new personal memories each
turn. Dialogue and meaningful changes arrive once by occurrence ID, preserving
exact wording and authorized audiences; identical words on another turn remain a
distinct event. See [Building simulations](building-simulations.md) for authoring
requirements, including receipts for counterparties and private interpretations.

The long-run harness defaults to these current implementations; `--legacy` retains
the earlier workload. A current 1,000-turn procedural pass with three actors per
scenario held conversation requests under 18k characters and settlement under
24k, with exact restore and no model/context failures. These idle/self-revision
workloads do not measure rich dialogue or semantic recall quality.

Use [Durable runs](durable-runs.md) for heartbeat reports, independent supervision,
settled checkpoints, explicit interruption detection, and recovery commands.
