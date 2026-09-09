# 0.2.0-alpha.1 release candidate — September 9, 2026

The scoped Phase 2 alpha capabilities are implemented locally. The package remains
an experimental release candidate, not a stable API or an established standard.
Registry publication remains pending: `npm whoami` on September 9 returned
`ENEEDAUTH`. Independent human onboarding trials and comparative
character-intelligence benchmarks remain open.

## Current capabilities and versions

| Component | Current scope |
| --- | --- |
| Runtime | `0.2.0-alpha.1`, ESM, Node >=22.16 |
| Portable documents | `0.2.0-draft.2`; original draft.1 character reader retained |
| Characters and situations | File-authored casts, personas, private context, tools, model slots, and limits |
| Continuity and context | Optional `simkind.continuity` and `simkind.context` 0.1.0; explicit intentions, attributed interpretations, original evidence, model-authored episodes, and bounded recent history |
| Checkpoints | Legacy `simkind.checkpoint/1` and indexed-storage `simkind.checkpoint/2`; compatible settled boundaries |
| Archives | Indexed SQLite evidence, paged reads, verified source hashes, resumable or explicitly evidence-only exports |
| Current reference hosts | Conversation, settlement, economy, and fabrication implementation 1.2.0; spatial implementation 1.0.0; exact legacy implementations retained |
| Playground | Character-first economy/shop recaps, turn stepping and playback, state inspection, source authoring, saved runs, and supported branching |
| Durable execution | Separate supervised worker, status/usage reports, settled checkpoints, and recovery into a new copy |
| Embedding and spatial | Public runner/provider/Node/spatial entry points; independent kinematic 3D reference host with headless/viewer equality |
| Interoperability | Playback exchange, v1/v2 character-card JSON text subset with loss reports, and independent Python structural reader subset |

World rules remain in hosts. The shared runner does not require a planner,
relationship ontology, economic incentives, cooperation, or a preferred story.
Speech and personal interpretations cannot overwrite authoritative host effects.
New host versions preserve exact readers for earlier supported recordings.

## Engineering evidence

The latest completed implementation checkpoint passed **261 tests across 25 files**,
generated-artifact checks, build, and typechecking. External tarball consumer checks,
three deterministic run reproductions, public-file checks, and documentation links
also passed. Local results do not imply that remote CI has run.

Tests cover perspective isolation, stale edits, asynchronous action outcomes,
provider deadlines and cleanup, bounded correction attempts, memory citation and
cutoff validation, host-specific tool constraints, archive integrity, exact restore,
branch isolation, playback, and local playground APIs. Browser checks from the
implementation work exercised per-character recaps, stepping, playback, source
editing, and evidence inspection; independent human usability testing is still open.

Earlier procedural workloads reached 10,000 turns per character on conversation
and settlement hosts, with exact restore and bounded decision context. The latest
changes were rechecked at 1,000 turns per character on both hosts. These are scripted
mechanical tests, not thousands of autonomous model decisions. Indexed lexical
search still slows as matching history grows. See [long-run evaluation](long-run-evaluation.md).

Run the main checks from a checkout:

```sh
npm run check
npm run check:runs
npm run check:consumer
npm run check:public -- --worktree
npm run demo
npm run demo:soak
python -m unittest discover -s examples/python-reader -v
```

The Python subset requires the dependencies described in its reader guide.

## Live evidence and its limits

Live economy and fabrication runs have produced barter, paid work, equipment
rental, bargaining, refusals, information sharing, and completed customer orders.
These demonstrate observed behavior; they do not establish that a particular memory
mechanism caused it, or that the same quality holds in friendship or narrative sims.

The latest completed ten-turn fabrication trial used 46 calls: 40 initial decision
requests, four compactions, and two successful schema-correction retries. Provider
receipts reported about $0.06487. There were no timeouts or context-capacity failures,
but one invalid provider response lost a final decision and supplied no usage
receipt. Four host rejections protected rules; all report-boundary cash checks
balanced. The final archive restored exactly without model calls.

A controlled reconstruction of two earlier post-compaction contexts reduced total
characters by 35.4% and 28.8%, keeping protected recent history, observations, goals,
and summary identical. This measures redundant payload reduction, not equal semantic
retrieval quality or a measured whole-run cost saving. That earlier selective policy returned
at most three direct records within a default 6,000-character cap. New runners now
use a [replaceable situational policy](memory-policies.md), with recurring concerns
and optional hybrid embedding retrieval. The payload reductions above do not
measure this new policy. Explicit recall retains its larger allowance.

Compactions still sometimes retain stale balances, contradictions, or mistaken
interpretations. Structured output and clearer instructions do not guarantee factual
consistency. The [memory guide](long-run-memory.md) describes these tradeoffs; the
[behavioral evaluation plan](behavioral-evaluation.md) separates structural correctness,
source retrieval, interpretation, and character choice.

The latest situational-policy procedural checks completed 1,000 turns per character
on both reference hosts with exact restore, preserved intentions, and zero recorded
model errors. Maximum serialized contexts were 21,877 and 25,149 characters. These
checks used lexical retrieval and scripted decisions. Semantic-channel unit tests
use scripted vectors; a live embedding/behavior comparison remains open.

The original three-call GLM transport sample and earlier test counts are historical
checkpoints. They are not the current reliability sample. Remote/local compatible
adapters have mock coverage; broad live provider compatibility is not established.
The September 9 cross-scenario evaluation used 150 calls in six retained trials;
three ended during maintenance at their call ceilings. The controlled GLM memory
history reached turn 1,009 with 14/16 questions correct (one retrieval miss, one lost
network response). A Gemini full-pipeline trial failed on schema complexity; a
separate common-context JSON-mode reading check passed 8/8. See the
[complete methods and results](behavioral-evaluation.md) for exclusions and limits.
No SOTA ranking is claimed.

## Supported limits and deferred work

- Restore requires the exact supported host implementation and effective configuration.
  Arbitrary world patches, cross-host migration, and unresolved external-effect rollback
  are not supported. Physical recording readers never execute real-world actions.
- The spatial reference is bounded kinematics with point agents and static spherical
  obstacles, not rigid-body physics or a production robot driver.
- Legacy playback retains 32 MiB/resource and 64 MiB total bounds. Larger long-session
  recordings use the separate indexed archive path; readers retain metadata/resource
  validation. Do not treat a legacy playback bundle as an unlimited archive.
- Protected recent observations and goals must fit their configured context allowance.
  The runner cannot promise both arbitrarily large verbatim observations and bounded
  input. Hosts remain responsible for useful, bounded current-state projections.
- The supervisor is local, not a reboot-persistent service. Its worker is not attached
  automatically to playground live controls. Reports/logs are its live monitoring surface.
- Complete recordings can contain private fictional knowledge. A selected perspective
  is not permission to share the whole recording. Local connection credentials are excluded.
- Complex authoring fields use JSON editors. Multi-user hosting, huge populations,
  distributed execution, production robotics, and universal psychology are deferred.

## Remaining release gates

The implementation is consolidated in commit `030edc7`, with evaluation findings
recorded separately. Local engineering and package checks pass. Remaining gates are
an independent contributor walkthrough and publishing
an explicitly reviewed alpha artifact when registry authentication is available.
Publishing to npm and pushing Git history are separate actions.

```sh
npm pack
npm publish simkind-0.2.0-alpha.1.tgz --tag alpha --access public
```

The commands document the release procedure; their presence does not mean publication
has occurred. Package metadata defaults to the `alpha` tag.


Provider and execution-budget follow-through: 272 tests pass across 26 files.
Explicit schema/JSON/text transports share local validation. Optional per-actor
opportunity reservations preserve the hard total request ceiling and survive restore.
Six scripted eight-turn comparisons each completed eight decisions per actor with
27/28 requests, zero errors, and resumable archives. Package-consumer and exact run
fixture checks passed. This is mechanical evidence; no new paid provider or embedding
quality comparison was performed for these changes.
