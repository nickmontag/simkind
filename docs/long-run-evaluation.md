# Long-run memory evaluation — 2026-09-07

This implementation was tested procedurally first, then with `z-ai/glm-5.3-flash`
through OpenRouter. It separates mechanical scaling, retrieval, model interpretation,
and emergent simulation behavior. These are local engineering results, not a SOTA
ranking or evidence that every important fact survives summarization.

## Implemented boundary

The optional context profile protects recent delivered experience and explicit
intentions, archives actor-private originals, and records independent model-authored
episodes plus a bounded working summary. Consolidation, recall, and correction are
visible requests with shared opportunity deadlines and bounded additional calls.
SQLite storage, compact checkpoints, frozen recordings, paging, source inspection,
and recovery are integrated with the playground and CLI. Legacy readers remain.
See [Long-run memory](long-run-memory.md) for APIs and supported limits.

## Procedural scaling

Three actors on each of two hosts, at 100, 1,000, and 10,000 turns per actor. The
fixture performs repeated self-revision and deterministic consolidation. All six
workloads finished with zero model/protocol errors, unchanged intentions, empty
resident historical-memory arrays, and exact state restoration.

| Host / turns per actor | Maximum input characters | Elapsed | First / last 100 turns | Restore current state | Checkpoint |
| --- | ---: | ---: | ---: | ---: | ---: |
| Conversation / 100 | 16,974 | 0.53 s | 0.53 / 0.53 s | 50 ms | 19,005 B |
| Conversation / 1,000 | 17,093 | 5.24 s | 0.50 / 0.53 s | 46 ms | 19,029 B |
| Conversation / 10,000 | 17,197 | 58.73 s | 0.48 / 0.55 s | 56 ms | 19,053 B |
| Settlement / 100 | 29,937 | 0.55 s | 0.55 / 0.55 s | 73 ms | 24,950 B |
| Settlement / 1,000 | 30,151 | 7.08 s | 0.57 / 0.82 s | 70 ms | 24,974 B |
| Settlement / 10,000 | 30,323 | 225.37 s | 0.58 / 4.72 s | 76 ms | 24,998 B |

At 10,000 turns, frozen databases were about 625 MB and 1.07 GB; process RSS was
below 310 MB. Each host made 33,330 fixture requests, including 3,330 consolidations.
Restore timings exclude copying the database and verifying all recording hashes.
Those operations necessarily read archive bytes. SQLite searches become slower as
matching history grows; the settlement timings expose that cost rather than proving
constant-time processing.

Tests also cover actor/future cutoffs, rollback, invalid citations, stale memory
versions, input overflow, bounded correction attempts, crash recovery into a copy,
tampering, original-request inspection, playback export, and sibling comparison.
The full suite has 209 passing tests. Build, typechecking, generated files, external
package consumption, public-file checks, and CLI archive save/report/restore passed.

## Controlled live memory

Two expedition-log keepers received 1,009 turns of controlled history. Ordinary
world decisions were scripted idle; consolidation and checkpoint-question decisions
used the real model. This is **not 1,009 fully live decisions per character**.

Facts were introduced at widely separated turns: an unaccepted seven-token offer,
an accepted nine-token agreement due at turn 1200, an incidental gasket color,
an unverified visitor claim, separate private locker codes, and a later amendment
raising the price to eleven while preserving the deadline. Questions arrived at
turns 980–1008.

The initial complete trial used 90 actual model calls, made 29 successful
consolidations per actor, and answered 14 of 16 questions correctly:

| Question | Aya | Mira |
| --- | --- | --- |
| Current amended price | Correct: eleven | Correct: eleven |
| Original deadline remains effective | Correct: turn 1200, after recall | Correct: turn 1200, after recall |
| Initial unaccepted price | Chose no action | Correct: seven, after recall |
| Visitor claim and its uncertainty | Correct; unverified | Correct; unverified |
| Own private locker code | Correct after recall/corrections | Correct |
| Incidental gasket color | Incorrectly abstained without searching | Correct: saffron |
| Other person's private code | Correctly unknown | Correctly unknown |
| Unspecified meeting date | Correctly unknown | Correctly unknown |

There were ten rejected model outputs within that trial: seven malformed decisions
and three invalid consolidation outputs. Bounded correction recovered them without
an exhausted context operation. Requesting strict JSON Schema did not eliminate
provider format errors. The largest reported input was 19,125 tokens; the largest
context was 63,271 characters.

An earlier 14-call setup/debugging phase found ambiguous evidence IDs: the model
cited nested observation IDs instead of the top-level memory IDs. Dynamic citation
enums and explicit tool instructions fixed that ambiguity. Its calls remain in
the cost and authorization accounting, including three interrupted calls without
billing receipts.

### Changes driven by the findings

Working summaries did drop old facts. Keeping originals was necessary but not
sufficient: Aya did not always request a search. Automatic retrieval now also uses
newly changed textual observations, so a new question can bring its source into
context without relying on the character to remember that the source exists.
Static host descriptions do not generate a fresh situational query every turn.

The first saved-history recheck recovered the missed color and initial price for
both actors. It also revealed confusion between a current question and a quoted
previous question: both actors answered with their own code when asked about the
other person's code. Current observations now appear last in the decision context,
and transport instructions explicitly distinguish new deliveries from historical
requests. Maintenance instructions separately distinguish questions, intentions,
proposals, completed actions, and resulting inventory totals.

The final recheck answered all eight targeted questions correctly: gasket color,
initial price, own code, and other-person unknown, for both actors. It used eleven
calls including two consolidations and one recovered malformed decision. This is
a repeated, small targeted check against the same saved history, not an independent
16-question benchmark or proof of perfect general memory.

Some summaries still contain inaccurate aggregate counts or confuse an experience
sequence number with a turn. Citation validity establishes source availability,
not semantic truth. The immutable originals, recent deliveries, and authoritative
host state remain essential. Better temporal presentation, semantic retrieval,
correction-link navigation, and broader fidelity evaluations remain warranted.

## Fully live economy

A separate four-character economy ran six days / 25 turns with real model decisions
throughout. It completed in approximately 5.6 minutes using 109 calls, including
13 consolidation attempts. Its largest input was 30,084 reported tokens and
100,418 context characters, within the configured input allowance. No output-token
cap was set by Simkind.

One network error interrupted Dev's maintenance opportunity; the next turn could
continue from retained evidence. One malformed Ada decision was corrected. Nine
host rejections protected real rules, including spent shifts, unavailable/expired
offers, and stale self-revision requests. They are not successful world actions.

The resulting dynamics included twelve trades and one paid job. Specialization
and barter appeared early: Bram acquired a tool and traded timber for food, while
Cleo sold tools to Bram and Dev. Dev spent his two coins and two food on a tool,
then failed to secure food from his offers and missed one meal. Later he worked
for Cleo for three coins plus food, and negotiated further timber sales to Ada.
At turn 19 he explicitly offered Ada a mixed coin/timber payment and priority to
regular trading partners. This supports an interesting observed sequence, not a
causal claim that memory improvements created it.

| Character | Final coins | Food | Timber | Tools | Missed meals |
| --- | ---: | ---: | ---: | ---: | ---: |
| Ada | 40 | 14 | 13 | 3 | 0 |
| Bram | 2 | 6 | 20 | 1 | 0 |
| Cleo | 17 | 5 | 10 | 5 | 0 |
| Dev | 6 | 4 | 3 | 1 | 1 |

All 65 coins were conserved. The final boundary had no outstanding actions or
requests. The recording can be opened, inspected, and resumed with its exact
model/host configuration. The economy has a finite horizon and a growing market
history; this sample does not establish an indefinitely bounded host-world snapshot.

## Follow-up validation: September 8, 2026

The six general improvements now cover independent provider completion, revisions
bound to the original request, explicit memory evidence and action lifecycle,
retrieval of original sources behind interpretations, bounded timeout cleanup
with evidence-only saving, and host-defined input constraints. The economy uses
the last interface to enforce negotiated tool durability; recaps show actual uses
remaining when recorded.

The implementation passed the 216-test suite, build, type checking, generated
schema checks, external consumer checks, and deterministic fixture replay. Two
additional deterministic soaks ran 1,000 turns per actor across three actors in
each of the conversation and settlement hosts. Both restored exactly with zero
errors. Maximum decision contexts were 21,016 and 43,174 characters respectively.
These bounded-context checks do not establish constant total storage or runtime
at arbitrary history sizes.

A separate controlled live check used 12 actual LLM calls with
`z-ai/glm-5.3-flash`. Both agents answered both historical fact questions correctly
(4/4), and both successfully updated their intentions without supplying revision
bookkeeping (2/2). Existing intentions were retained. Successful receipts reported
$0.01412707; one timed-out request had no usage receipt.

The initial attempt encountered one malformed compaction response and one
300-second provider timeout. Cleanup preserved a resumable checkpoint at turn 6;
after fixing the evaluation harness to drain providers before intervening, the
same trial resumed and completed turn 14 without new errors. This checks recovery
and targeted recall, not a new autonomous economy run. Summaries remain fallible,
and the changes do not eliminate provider latency or timeouts.

## Usage and reproduction

Across setup/debugging, the complete memory trial, two rechecks, and the economy:
**234 actual LLM calls**, below the 300-call ceiling. The 230 successful response
receipts reported **$0.4325145956**, 3,395,888 input tokens, and 111,072 output tokens.
One network error and three interrupted calls had no usage receipt, so this is
reported cost rather than a complete billing reconciliation. Fixture calls do not
count toward that LLM-call total.

Use the commands in the [memory guide](long-run-memory.md#verification). Live results
vary with model and provider routing. Record failures, refusals, retrieval misses,
and unsupported statements separately from valid JSON and legal host actions.
