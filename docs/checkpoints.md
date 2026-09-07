# Playback, replay, resume, and branches

These are separate capabilities. A recording alone never authorizes execution.

| Operation | API | Calls models? | Executes host commands? |
| --- | --- | --- | --- |
| Verified playback | `loadRun(directory)` from `simkind/node` | No | No |
| Simulated-host replay verification | `replayCheckpoint(checkpoint, host)` | No | Reconstructs a declared deterministic local simulation |
| Exact supported resume | `CharacterRunner.restore(checkpoint, host, connections)` | Only when subsequently stepped | Reconstructs host state, then permits continuation |
| New branch | Same restore API, with a new run ID | Only when subsequently stepped | New continuation after compatible reconstruction |

## Settled checkpoints

`runner.checkpoint()` returns a JSON-only `simkind.checkpoint/1` artifact with:

- Frozen source bytes and resolved launch configuration, models, profile versions,
  and definitions; current character state and revisions.
- Ordered request, proposal, observation, and action history.
- Host-owned snapshot and exact contract/implementation versions.
- Scheduler step/request counters, request identity sequence, actor rotation,
  dispatch state, and any branch lineage.

No pending provider requests, abort-ignoring providers, unresolved actions, or
stopped runs qualify. Pausing dispatch alone does not establish a checkpoint.
There is no pending-action recovery protocol in this alpha. External physical
hosts must not advertise replay/restore through these local simulated examples.

Hosts opt in with `checkpoint()` and `registration.restore(launch, snapshot)`.
The conversation, settlement, and independent spatial reference hosts record all
local commands and reconstruct clocks, world state, event counters, and
per-run deduplication. They compare the reconstructed state against the recorded
state. Their simulations have no random source or external input stream. A new
host with randomness must persist its complete generator state or equivalent
recorded inputs; it cannot inherit these hosts' claims automatically.

Replay equality is exact canonical JSON for each versioned reference host.
Provider response timing and new model choices are not reproduced. The generic
run manifest remains playback-only until an exporter includes settled artifacts;
`saveRun` then advertises restore/branch. Deterministic replay remains an explicit
host verification operation, not an unconditional run-manifest claim.

## Saving and opening

```ts
import { saveRun, loadRun } from 'simkind/node';
import { CharacterRunner } from 'simkind/runner';

const checkpoint = runner.checkpoint('checkpoint:before-change');
await saveRun(newDirectory, runner.manifest(), runner.events(),
  runner.inspect().launch.bundle, [checkpoint]);
const recording = await loadRun(newDirectory);
const resumed = CharacterRunner.restore(recording.checkpoints[0], host, connections);
```

Destinations must be new directories. Source bytes, compiled Markdown, event
streams, and checkpoints carry SHA-256 hashes. Paths and symlinks must stay within
the recording root; UTF-8, event IDs, sequence, counts, clocks, and checkpoint
prefixes are validated before opening. Hashes detect changes, not authorship.
Interrupted writes have no finalized `run.json` and are not valid recordings.
Readers cap total input at 64 MiB and individual resources at 32 MiB. Documents,
individual events, and checkpoint JSON retain the strict 1 MiB parser limit.
Oversized checkpoints are rejected before export; omit them for playback-only
export. Authoring sources must match the documents actually launched.

## Fresh continuations

```ts
const child = CharacterRunner.restore(checkpoint, host, connections, 'run:alternative');
const actor = 'simkin:aya';
const revision = child.inspect().launch.states[actor].revision;
child.intervene(actor, {expectedRevision: revision, intentions: []}, 'operator:researcher');
child.pauseDispatch(false);
child.step();
await child.settleDecisions();
```

A branch keeps the inherited host clock, character state, and provenance; resets
its local step/request budgets; and continues a unique request identity sequence.
It starts with dispatch paused. Child events start at sequence zero under the new
run ID. The immutable parent prefix is stored separately in the parent checkpoint;
include it alongside the child's checkpoint in `saveRun`. The child manifest links
the parent run, checkpoint, and recorded intervention IDs. The source checkpoint
and live parent runner remain unchanged.

This alpha requires exact effective model/configuration matching at restoration.
Changing providers, model settings, host versions, or the world schema is not a
migration. Supported branch interventions edit character intentions/interpretations
or invoke [host-defined operator operations](interventions.md). Arbitrary world
patches and physical-state mapping are not implemented. New conversation and
settlement runs use implementation 1.1.0 with interventions; exact 1.0.0 readers
remain installed for existing recordings.

`compareRuns(leftEvents, rightEvents)` reports request counts, reported token/cost
totals, and action statuses. The playground labels parent-prefix and child-
continuation totals separately; ticks are not presented as matched experimental
conditions. Missing usage is unknown, not a free request.

`compareBranches(left, right)` accepts two `{ manifest, events, parent }` evidence
sets. It verifies both child links and exact equality of their parent checkpoints,
then returns a shared-prefix identity and separate continuation events/totals.
It rejects unrelated checkpoints, reused run IDs, and malformed event sequences.
The prefix is excluded from continuation totals; independent clocks are not aligned.

In the playground, save a parent, **open that same saved parent** before creating
each branch, and save the first continuation. On the second branch, choose the
first saved continuation under Branch comparison. Expand either trace to inspect
dialogue, delivered information, self-reports, and world outcomes. A live Branch
creates a new checkpoint identity, even if its current world happens to equal
another saved checkpoint. One sibling pair is not a causal finding.

## CLI

```sh
npm run scenario:resume -- --input path/to/run --replay
npm run scenario:resume -- --input path/to/run
npm run scenario:resume -- --input path/to/run --branch
```

The exact provider/model is read from the checkpoint, with credentials supplied
locally. `--fixture` permits no-action continuation only for explicitly recorded
fixture models. A new continuation is never labeled deterministic model replay.
Historical 0.1 recordings keep their existing example readers. Missing host inputs
or clocks cannot be invented to promote them into this checkpoint profile.
