# Behavioral evaluation

Simkind separates mechanical correctness from character behavior. A legal refusal,
failed negotiation, changed goal, or unreconciled friendship is not automatically a
bug. Test whether a character can perceive, remember, choose, and act consistently
within its authorized perspective; report what it actually chooses separately.

## September 9 evaluation protocol

This bounded local evaluation uses the current shared runner and host implementations.
It does not add scenario-specific reasoning rules to the core or require a preferred
ending. Preserve all repeats, errors, and source configurations in the run archives.

| Situation | Host | What it probes |
| --- | --- | --- |
| Friendship repair | Conversation | Private confidences, attribution, disagreement, changing intentions, dialogue continuity |
| Infrastructure recovery | Settlement | Shared physical problem, different priorities, movement and asynchronous work, actual outcomes |
| Leadership contest | Conversation | Persuasion, competing goals, public revisable votes, unsupported promises versus recorded effects |

Run each situation twice independently for eight turns and three characters, with
at most 28 requests per run including maintenance and corrections. The suite ceiling
is 168 live calls. Repeats use identical source configurations but new run identities;
provider nondeterminism remains. A request ceiling can end a run before all desired
opportunities finish; report that rather than treating it as a complete eight-turn trial.

```sh
node --import tsx scripts/evaluate-scenarios.ts \
  --fixture --output .internal/evaluation-dry-run

node --import tsx scripts/evaluate-scenarios.ts \
  --model z-ai/glm-5.3-flash --output .internal/evaluation-live
```

Use a fresh output directory. The no-action fixture proves launch/run/archive plumbing,
not interesting behavior. The live suite runs both repeats concurrently, each under the local supervisor
and writes a plan plus cumulative reports. It never automatically restarts a failed
worker. A process interruption can leave a partial suite; inspect each supervision
record and retain its evidence.

The scenario files and config are ordinary portable documents under
`examples/portable/scenarios`. Change the examples for your own use, but freeze them
before a comparison. Core source, tool contracts, and scoring rules must remain fixed
during the measured runs. Do not repair a surprising legal strategy mid-evaluation.

## Same-history model comparison

Use the controlled 1,009-turn memory history from the existing evaluation harness.
Ordinary turns use scripted idle decisions; consolidation and the final questions use
the selected real model. This is a memory test, not a fully autonomous thousand-turn
simulation. The two actors have different private codes. Questions test an amended
price, unchanged deadline, unaccepted original offer, uncertainty, incidental detail,
own private code, inaccessible peer code, and unspecified information.

For each explicitly selected model, use a separate directory and a 60-call ceiling:

```sh
node --import tsx scripts/evaluate-long-memory.ts \
  --phase memory --model z-ai/glm-5.3-flash --max-calls 60 \
  --batch-records 192 --batch-turns 160 \
  --output .internal/memory-comparison-glm
```

Repeat with the comparison model and identical batch settings. These larger batches
are a declared evaluation configuration, not a new production default. Both models
receive the same authored history and questions but can produce different summaries
and retrieval requests. Budget exhaustion, failed maintenance, or missing answers
must remain visible. A model that never reaches the questions has not earned an
accuracy score for them. Counts include attempted calls, not only successful receipts.

## Assessment

Record these separately:

- Structural validity: malformed decisions, recovered retries, host rejections, lost
  decision opportunities, timeouts, and context failures.
- Evidence integrity: cash/resource rules where defined, source hashes, exact supported
  restore, duplicate event delivery, and actor/branch visibility.
- Memory fidelity: exact source terms, direction and participants, completed versus
  proposed actions, later corrections, uncertainty, and unsupported claims.
- Behavioral observations: changes of position, disclosure, negotiation, specialization,
  coordination, refusal, and repetition. Cite turns and original speech/actions.
- Operational cost: all requests and maintenance, provider-reported tokens/cost,
  missing receipts, latency, context size, and archive size.

For each memory answer, inspect original evidence and distinguish a retrieval miss
from a wrong reading of retrieved evidence. Valid source IDs do not certify that a
summary is true. Evaluate unknown-information abstention without penalizing a character
for refusing a known obligation in an autonomous scenario.

Two repeats are exploratory evidence, not a statistically reliable model ranking.
This protocol does not measure huge populations, production external tools, rich
spatial behavior, or general narrative quality. Broader models, paraphrased/indirect
cues, and independent human scenario-authoring trials remain further work.

## Results

The six no-model dry runs completed all eight turns with zero errors and exported
archives. Live runs and the model comparison are being assessed; completion and
behavioral claims will be recorded here only after their evidence is reviewed.
