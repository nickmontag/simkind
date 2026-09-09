# Building simulations

Use the same runner for social, economic, cooperative, and competitive scenarios.
Keep the meaning of the world in its host, and give characters enough evidence to
interpret it for themselves. Start with [portable authoring](portable-scenarios.md)
for character and scenario files, then implement a host when you need new rules.

## Decide who owns each fact

| Layer | Owns | Does not establish |
| --- | --- | --- |
| Core | Event identity, delivery cursors, evidence provenance, context, memory, scheduling, archives | Friendship, prices, fairness, or a winning strategy |
| Scenario host | Available actions, legality, visibility, clocks, authoritative effects, explicit game rules | Whether a character believes a statement or feels betrayed |
| Character | Goals, choices, beliefs, interpretations, model-authored summaries | Payments, accepted invitations, completed work, or other host effects merely by describing them |

The host can confirm that someone spoke, left a room, accepted an invitation, or
transferred an item. Speech is evidence of what was said; its contents may be
false. A character's inference that someone is angry remains an interpretation.
If a scenario explicitly models relationship scores, the host owns those scores
and their disclosure rules. A score is a declared game mechanic, not a universal
definition of a relationship.

| Scenario | Host occurrence | Possible character interpretation |
| --- | --- | --- |
| Friendship | An invitation was declined; preserve the exact reply | “They are avoiding me,” or “They need some time” |
| Village | A neighbor contributed three meals to the shared store | Generosity, obligation, or a bid for influence |
| Cooperative | A teammate accepted a task and delivered a component | Trust gained, resentment about workload, or uncertainty |
| Competitive | An offer expired; a rival entered a public alliance | A bluff, an insult, or a strategic opening |

None of these interpretations needs to be predetermined by the engine.

## Give characters continuity without scripting their response

Enable `simkind.context` and `simkind.continuity` for long sessions. New runners
use the [situational memory policy](memory-policies.md): current events, observations,
intentions and model-maintained concerns can retrieve older experiences even when
nobody explicitly asks a question. A concern is a fallible interpretation, not a
host obligation, alarm, goal priority or relationship score.

Describe who is present and deliver changes that the character can perceive.
If time matters, expose an appropriate clock or deadline observation. Preserve
speaker identity, literal dialogue, uncertainty and source times. The host should
not tell the model which memory to retrieve or how to feel about it. The same
interfaces support social characters and task-oriented agents.

Keep storage and embedding connections in local application configuration.
Portable scenario files describe the situation and character capabilities;
they should not depend on one vector database or contain provider credentials.
Evaluate whether the character uses relevant experiences in later choices, in
addition to whether it can answer an explicit recall question.

## Separate state, new events, and history

Implement optional `CharacterHost.perceive(actor)` to return:

- `current`: the actor's latest authorized state observations, such as location,
  available inventory, visible commitments, and current rules. These are recorded
  for audit and supplied to the decision, but are not repeatedly added to memory.
- `events`: newly delivered occurrences. Preserve original dialogue and narrative
  wording, order, source, and audience. These become remembered experiences.

The runner supplies both through `DecisionContext.observations`, with
`perception.currentStateIds` and `perception.eventIds` identifying their roles.
Previous delivered events remain in protected recent history, then become eligible
for model-authored consolidation and retrieval. Current deliveries are not also
copied into that request's recent-history section. Action proposals and lifecycle
receipts remain separately attributable evidence; this is not global text deduplication.

Do not embed the last ten messages or transactions in every current snapshot.
If a change should be remembered after it stops being current, publish an event
for it. State alone is not a durable personal experience with this interface.
Legacy hosts that implement only `observe(actor)` retain their previous behavior.

`PerceptionJournal` supplies stable identity and per-recipient delivery cursors:

```ts
import { PerceptionJournal, type HostPerception } from 'simkind/runner';
import { SqliteRunnerStorage } from 'simkind/node';

const storage = new SqliteRunnerStorage('./example.active.sqlite');
const journal = new PerceptionJournal(['simkin:a', 'simkin:b'], 'example.social', storage);
const now = { clockId: 'clock:simulation', value: 7 };

// Publish after the host commits this occurrence. These are the actual witnesses.
journal.publish({
  id: 'dialogue:invitation-7', kind: 'dialogue', authority: 'statement',
  actor: 'simkin:a', recipients: ['simkin:a', 'simkin:b'], capturedAt: now,
  text: 'Will you come with me tomorrow?',
});

// Inside perceive(actor), alongside your own authorized current observations:
const perception: HostPerception = {
  current: [],
  events: journal.drain('simkin:b', 'run:social', now, 1),
};
console.log(perception.events[0].content);
storage.close();
```

The host must declare the clock and supply valid observation envelopes. Event IDs
are portable IDs, at most 128 characters. Re-publishing the same ID and identical
payload is a no-op; changing its payload is an error. A second utterance of the
same sentence gets a different ID. Repetition, hesitation, and ritual can matter
to a story and must survive. `capturedAt` is when it occurred; `deliveredAt` is
when the character received it. Do not invent an earlier delivery to backfill memory.

Use these event types deliberately:

| `kind` | `authority` | Meaning |
| --- | --- | --- |
| `dialogue` | `statement` | This speaker said these exact words |
| `narrative` | `host` | This observable occurrence happened, within the host's stated scope |
| `receipt` | `host` | This operation or explicit state change occurred |
| `interpretation` | `interpretation` | This is a perspective or belief, not an authoritative effect |

Optional `data` carries structured details and `references` links prior evidence.
For uncertain measurements, describe the measurement and uncertainty rather than
claiming omniscient truth. Keep emotional readings in character memory or private
interpretation events; the host does not need to generate them every turn.

Publish only to actual authorized recipients, including the speaker when appropriate.
Do not infer that all characters heard an exchange because the operator can inspect
it. The event payload includes its recipient list, so do not mix recipients whose
identities must be hidden from each other: publish separate audience-specific events.
An operator message is a recorded statement, not an automatic amendment to a contract.

## Receipts and enforceable actions

After committing an effect, send a receipt to every participant who should know
about it. The requesting actor's action ledger alone does not inform a counterparty.
For example, report who paid whom, the amount, the originating action, and whether
the operation posted an offer, accepted it, or actually completed the exchange.
Use the same pattern for accepted invitations, assigned tasks, cancellations, and
departures. Reveal no private terms to bystanders unless the scenario permits it.

Publish after commit, never during validation or operator preview. Failed operations
must not produce success receipts. Preserve partial effects and uncertain outcomes
explicitly. Journal delivery deduplication is not exactly-once execution of external
effects; the host must also deduplicate effects using action identity.

The tool catalog defines executable actions. `toolConstraints(actor)` narrows it
using current host state; the runner intersects these constraints with the catalog,
and the host revalidates at execution because circumstances may have changed.
Use typed JSON Schemas for these constraints. Existing schema `description`
annotations can explain field roles and interactions without adding required fields.
Describe prerequisites separately from compensation or other effects. Rejection
reasons should name the affected argument paths, the violated constraint, and
relevant actor-visible state. Explain what failed without prescribing a strategy.
The runner's schema-correction feedback includes up to three field diagnostics;
host legality errors remain host-defined `reason` text. No extra verification call
or character preview tool is required. If a paid job is permanently beyond
its recipient's skill, reject it before reserving payment. Temporary shortages may
still be legal future commitments if that is a deliberate scenario rule.

Do not offer an equity, promise, alliance, or relationship action unless the host
implements its effects. Characters may discuss unsupported arrangements in dialogue,
but the simulation must not present that discussion as a completed transfer or a
binding contract. Describe what the available actions actually guarantee.

## Memory, budgets, and long sessions

Enable `simkind.continuity` and `simkind.context`; see the complete
[memory configuration](long-run-memory.md#configuration). Keep explicit goals,
current state, protected recent events, the working interpretation, and cited older
evidence distinct. Consolidation uses a separate model call to choose what matters
and summarize older experience. It preserves original evidence in the archive;
it cannot rewrite the world or silently remove protected recent turns. Require
summaries to preserve parties, direction, conditions, source attribution, and gaps
in evidence; do not force narrative memories into a universal contract schema.
Automatic reminders select up to three direct matches within a default 6,000-character
ceiling. Unchanged goals do not repeatedly refill it, and automatic episode matches
do not expand into every cited original. Explicit recall still accesses those originals.
See `maxAutomaticRecallChars` in the memory guide for tuning this tradeoff.

For a turn-based host, opt into a bounded maintenance stage:

```json
{
  "simkind.context": {
    "enabled": true,
    "config": { "maintenanceTimeoutMs": 300000 }
  }
}
```

This belongs in the run configuration's `features` object. When an opportunity
starts with consolidation, it gets up to this maintenance allowance followed by
up to `limits.requestTimeoutMs` for decision work. Retries do not reset either
stage. The opportunity's knowledge cutoff, request ceiling, and internal-call
allowance remain fixed. A longer allowance increases possible latency and does not
guarantee success. Omitted or zero preserves the shared deadline, suitable for hosts
that must react in realtime. Output-token settings are independent and optional.

Use SQLite for long runs and share the runner's storage with the host journal.
Journal identities, delivery cursors, host state, and runner memory must be included
in the same recoverable checkpoint. Small in-memory hosts can use `snapshot()` and
`restore()`; that snapshot contains their full journal and is not a long-run storage
strategy. Keep the host's active world bounded too: archiving core memory cannot
shrink an ever-growing array of domain history in a world snapshot.

Return `isComplete()` only for an explicit terminal world state. An empty list of
decision actors can mean waiting or in-progress work, and is not completion.
Use the [supervised run workflow](durable-runs.md) for sessions that must continue
independently of the browser and produce an observable terminal status.

## Versioning and verification

New reference launches use conversation and settlement implementation `1.2.0`,
economy `1.2.0`, and fabrication `1.2.0`. Their host contract versions remain
unchanged. Recordings select their exact implementation version; resuming an older
recording does not silently apply the new perception or job-admission rules.
Version your own implementation whenever observation or rule semantics change.

Evaluate mechanics separately from behavior:

1. Test exact private dialogue, identical words on different turns, witnessed
   narrative, and conflicting interpretations. Check every actor's actual context.
2. Test counterparty receipts, failed admissions, previews with no effects,
   amendments, and restore without duplicate deliveries or leaked future events.
3. Run long procedural histories, then restore and compare state and memory cutoffs.
   Record maximum request size, maintenance counts, and checkpoint size.
4. Use live probes for old agreements, corrections, uncertain claims, private facts,
   and appropriate abstention. Inspect answers against original evidence.
5. Across scenario variants, rotate resources, private information, actor order,
   and model settings. Compare call count, reported input/cache usage, latency,
   failures, and behavioral outcomes. A successful story or valid JSON alone is
   not a general quality score.

`npm run check:long-runs -- --turns 1000` exercises the current conversation and
settlement implementations. Add `--legacy` for the earlier snapshot-based baseline.
`npm run evaluate:memory` provides opt-in live memory and economy phases with an
explicit call ceiling; see [the harness instructions](long-run-memory.md#verification).

## Comparable decision opportunities

For bounded comparisons, set `limits.maxDecisionOpportunitiesPerActor` alongside
`maxRequests`. For example, three characters with a target of 10 and `maxRequests: 50`
reserve 30 primary decision attempts and leave at most 20 chat requests for
consolidation, explicit-recall continuations and format corrections. The hard total
ceiling remains 50. A configuration that cannot fund the cast's target fails launch.
Without the optional target, existing request-budget behavior is unchanged.

This is an admission cap and a reservation, not a promise of successful decisions.
The host must offer enough opportunities; asynchronous work, host completion, step
limits, provider failures and protected-context capacity can prevent the target.
A primary attempt can choose dialogue, a world action, an internal operation, or idle.
Routine consolidation is skipped once auxiliary allowance is exhausted; originals
and protected recent history are never discarded to make a decision fit. If that
protected context is too large, the existing capacity failure remains explicit.

`status().decisionBudget` reports per-character `opportunities`, `primaryRequests`,
`completedDecisions`, and `budgetExhaustions`. Primary requests are reservations and
may fail during retrieval before reaching a model. Completed decisions mean parsed
terminal decisions (including idle), not successful host effects; consult action
receipts for actual outcomes. Auxiliary budget/internal-call/deadline exhaustion
ends that opportunity and increments `budgetExhaustions`, without aborting the whole
comparison as a context failure. Other provider and retrieval failures remain in
recorded events. Counters survive exact restore and reset on an explicit branch.

The reservation limits chat request dispatch, not monetary cost or embedding calls.
Embedding attempts and receipts are reported separately by memory retrieval; its
batch limits, deadline and shared concurrency still apply. Report admitted and
completed decisions, maintenance/recall/correction calls, tokens, cost and elapsed
time separately. Equal host ticks alone are not comparable decision exposure.
