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
and writes a plan plus cumulative reports. It preserves failed trials and continues independent situations, without automatically
restarting a failed worker. A process interruption can leave a partial suite; inspect each supervision
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
must remain visible. The harness stops on nonretryable HTTP 400/401/403/404 or three
consecutive transport failures, retaining its report and archive. It records target
turns and whether the full history was reached. A model that never reaches the questions has not earned an
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

## Results: contrasting scenarios

The corrected six-run suite made **150 calls**, with **$0.12498938** reported usage.
The model was `z-ai/glm-5.3-flash`, with structured outputs and no Simkind output cap.
All results are retained, including unsuccessful trials.

| Situation / repeat | Final tick | Calls | Model/protocol errors | Observed result |
| --- | ---: | ---: | ---: | --- |
| Friendship / 1 | 7 | 28 | 2 | All three voted pause; maintenance stopped at the call ceiling |
| Friendship / 2 | 7 | 28 | 6 | All three voted continue; maintenance stopped at the call ceiling |
| Infrastructure / 1 | 8 | 19 | 0 | Parts gathered and coordination discussed; pump still broken |
| Infrastructure / 2 | 8 | 19 | 0 | Parts gathered and coordination discussed; pump still broken |
| Leadership / 1 | 8 | 28 | 0 | All three voted Sol after negotiating attribution and workload conditions |
| Leadership / 2 | 7 | 28 | 4 | All three voted Sol; maintenance stopped at the call ceiling |

These are final **host ticks**, not eight completed decisions per actor. Travel
occupies multiple ticks in the infrastructure host. The four conversation trials
also hit their request ceilings; even leadership repeat 1 did not dispatch all
three actors' eighth decisions. The deliberately frequent compaction configuration
(recentTurns 2, batchRecords 12, batchTurns 4) stresses continuity in a short trial
and is not the production default. Its maintenance cost and output corrections
consume the same total call budget. Future comparisons should allocate maintenance
separately or budget enough calls to reach a common decision boundary.

Across the suite there were four invalid tool outputs, six invalid JSON/envelope
outputs, one network error, and one invalid compaction (an extra `episodes_note`
field). No model-timeout events were recorded. Three runs reported internal/opportunity
budget exhaustion; this is distinct from a prompt-size overflow. The largest serialized
request context was 47,637 characters.

All four conversation archives restored their exact final worlds without model calls.
Both infrastructure archives are explicitly evidence-only because travel remained
in progress at the configured stop; the evidence was preserved without pretending
to restore unresolved work. Neither infrastructure result establishes a successful
repair, and eight ticks are a short window for travel, gathering, and negotiation.

### Behavioral observations

The friendship repeats provide a useful contrast: one trio agreed to take space,
while the other agreed to continue under more explicit consent and organizing
expectations. The corrected initial Sol contexts did not contain Aya's private
memory. Inspecting initial payloads establishes that isolation; later disclosure
must be assessed from the speakers' actual dialogue, not keyword absence alone.

The leadership repeats both converged on Sol, with Mira trading support for visible,
rotating coordination work and Aya demanding named credit. This is bargaining and
revision, but not broad evidence of competitive diversity. Some dialogue blurred
its own commitments: in repeat 2 Sol told Mira she had earned his vote, then said
he was voting for Sol. The recorded vote remained unambiguous. Proposed charters
and future logs were speech, not new executable world rules.

The infrastructure actors took legal actions but coordinated incompletely. Gathering
parts and asking who should bring them did not itself repair the pump. This distinction
is essential: narrative plausibility and valid tools are weaker than achieving a
shared operational objective.

### Excluded setup and transport findings

An initial friendship setup accidentally narrated Aya's private departure intention
in the shared introduction. It was stopped after 12 calls and retained as an invalid
setup run, excluded from the table above. The introduction was corrected before both
measured repeats. Those 12 calls still count toward the overall evaluation budget.

The planned end-to-end Gemini 2.5 Flash memory comparison did not reach its questions.
All 56 attempts returned HTTP 400; the old harness continued across later turns until
its budget guard stopped it at turn 75. One additional diagnostic request confirmed
that the full compaction JSON Schema exceeded the provider's constraint complexity
limit. This is a transport compatibility failure, not a zero memory-accuracy score.
The new fail-fast guard prevents that repetition and has a subprocess regression test.

Two isolated ordinary-JSON probes then exercised the same compaction input. The first
returned an oversized citation list, rejected by local schema validation. A follow-up
with specific field feedback passed local validation. Neither probe changed a world.
This supports an explicit JSON-mode compatibility path, not an automatic fallback
or proof that the full memory pipeline works equally well across models.

## Long-memory results

The GLM history reached **turn 1,009** using **65 actual model calls**, including
48 successful compactions. Ordinary world turns were scripted; this was not 1,009
fully live decisions per actor. The initial 60-call allocation stopped conservatively
at 55 calls after turn 992. Ten further calls finished the unchanged remaining history
from a restored copy, using unused scenario budget. Original evidence was preserved.

| Question | Aya | Mira |
| --- | --- | --- |
| Current amended price | Correct: eleven | No answer: network error |
| Unchanged delivery deadline | Correct: turn 1200 | Correct: turn 1200 |
| Original unaccepted offer | Correct: seven | Correct: seven |
| Visitor's claim and uncertainty | Correct: COBALT-53, unverified | Correct: COBALT-53, unverified |
| Own private locker code | Correct | Correct, with additional uncertainty |
| Incidental gasket color | Correct: saffron | Incorrectly abstained without further search |
| Other keeper's private code | Correctly unknown | Correctly unknown |
| Unspecified meeting date | Correctly unknown | Correctly unknown |

That is **14 correct answers, one retrieval miss, and one lost provider answer** across
16 assigned questions. It is not a statistically reliable accuracy estimate. Both
actors kept the other actor's private code inaccessible. Mira's qualifying language
about her own code did not change the correctly recalled value; it illustrates the
extra caution that provenance instructions can encourage.

The gasket miss is directly attributable to missing supplied evidence followed by
no explicit search: Mira's automatic reminders contained two prior checkpoint
questions and an unrelated grant note. Her summary omitted the color. An offline
actor-scoped search for `gasket` immediately returned original `experience:52`, with
the saffron fact. Aya's context included that original and she answered correctly.
This exposes a relevance problem in the limited lexical retrieval selection, not
lost archive bytes. The smaller automatic recall budget is a tradeoff, not a
universal improvement in memory quality.

The run's maximum reported input was 19,992 tokens; maximum serialized context was
74,383 characters. Provider receipts for the initial history plus continuation
reported **$0.15086573**. The final turn-1,009 archive restored exactly without model
calls. Preserved originals and a successful restore do not establish that all facts
survived interpretation.

### Common-context reading comparison

After the end-to-end Gemini run failed at the transport boundary, a separate,
explicitly narrower comparison used **Aya and all eight question types**, with her
last recorded GLM decision context for each question. Any recalled evidence in those
contexts remained present. Only the public model identity changed. Gemini used
ordinary JSON mode, with the same local tool schema checks. No returned world action
was applied, and no additional recall was executed.

Gemini answered **8/8 correctly**, all passing local schema validation. Aya's original
GLM answers were also **8/8** on those contexts. This supports the importance of
supplying the right evidence; it does not compare independent memory formation,
automatic retrieval, or full-pipeline reliability between models. It does not repair
the failed Gemini end-to-end benchmark or establish a model ranking.

### Overall accounting and next gates

Including the excluded setup, rejected Gemini attempts, three diagnostic/correction
probes, GLM continuation, and common-context reading, the evaluation used **294 calls**
under its 300-call ceiling. Available receipts reported **$0.34108951**, 2,132,819 input
tokens and 188,934 output tokens. Some failures and interrupted attempts supplied no
usage; this is not a complete billing reconciliation.

To reproduce a complete GLM memory history in one process, allocate a fresh, explicit
budget such as `--max-calls 80` with the same batch settings. That is a separate future
run allowance, not permission to exceed the original evaluation's ceiling. The new
fail-fast behavior intentionally will not reproduce the 56 rejected Gemini requests.

The next priorities supported by this evidence are:

1. Improve recall relevance for distinctive facts without letting generic question
   wording displace them; compare selective lexical retrieval with alternatives.
2. Separate provider-enforced schema complexity from authoritative local validation,
   with explicit supported transport modes and no silent weakening of world rules.
3. Budget short comparisons for maintenance and corrections so they reach comparable
   decision boundaries; preserve partial results when they do not.
4. Expand repeated social, competitive, and cooperative trials before claiming broad
   behavioral quality. More character machinery is not justified by these samples.
