# Small Economy: four people, unequal starts, negotiated work

This scenario runs on `example.economy` 1.0.0, a separate example host. The shared
runner supplies decisions, continuity, recordings, and branches. The host supplies
production and contract rules; it contains no market-making strategy or target price.

## Start and watch live

```sh
npm run playground
```

Open `http://127.0.0.1:4317`. In **More → Setup**, choose **small economy**
and **Load scenario**. Open **Connection slots** and choose your explicit model.
The OpenRouter key comes from `.env`; credentials do not belong in scenario files.
**Validate**, then **Start new run**. Creation makes no model request.

The main screen is a **per-character turn report**. **Next turn** advances the
world and requests the next decisions. Settled boundaries are checkpointed in the
active archive. **Play live**
continues to the configured limit; **Pause** lets the current decisions finish.
**Back** and the recorded-turn slider pause automatic progression and browse
history. **Return to live** returns to the current boundary without starting it.
**Play replay** only traverses existing turns and stops at the end.

The default run is 12 days with four negotiation rounds per day plus a closing
boundary: 49 steps and at most 192 model requests. Simkind does not impose an
output-token cap by default; the selected provider/model determines its limit.
An explicit `maxOutputTokens` connection setting can override that default.
Each decision has a five-minute timeout, configurable with `requestTimeoutMs`.
Each round can be conversation, an offer, acceptance, production, or no action;
there is no prescribed order. Model latency determines wall-clock duration.
The limits and model settings are editable in the run configuration and connection
slot JSON. Requests use your provider account. No live run is started automatically.

Each character has an ordered list of their recorded activity: speech (including
its exact text and recipient), offers, trades, production, and job payments.
Incoming transfers appear under the recipient as well as the actor who accepted
the trade. Earlier work completing appears before later decisions. Meals and
expired offers explain automatic resource changes. A failed request is distinct
from choosing no action; pending production is not presented as delivered goods.

Changes and pending work appear below the activity. Current available resources
stay beside each character; expand them for reserved resources and tool durability.
Click an activity to inspect its original evidence. The raw inspector respects the
selected turn and does not disclose later outcomes as if they had already happened.

**Market & world state** expands the order book, completed exchanges, private/public
messages, and daily coin history. It follows the same selected turn as the report.
Asking prices are not settled prices, and coin balances do not assign an invented
monetary valuation to food, timber, or tools.

This is an **operator view**. Characters initially see only their own holdings,
public skills, offers, completed exchanges, and permitted messages. Operator
perspective filters do not change model input. **More → Diagnostics** retains
request contexts, provider usage, interventions, and advanced execution controls.
**Advance host only** pauses dispatch and advances due work without new decisions.

## Review after completion

At the configured step limit the playground automatically saves a new recording.
Under **More → Saved runs**, use **Open saved recording** to inspect it without model calls. You can also
save manually while paused and reopen it from **Saved recordings** after restarting
the server. New economy runs use [archived memory](long-run-memory.md), including
recovery of the last settled checkpoint into a new file. Explicit Save creates the
portable recording directory.
Recordings live in `.internal/playground-runs/recording-…` and contain source files,
hashed event chunks, a frozen SQLite archive, and a settled checkpoint.

The **Recorded turns** slider reconstructs past dashboard states from
operator observations already in the event stream. **Return to live** returns to the current live boundary. In a completed recording,
move the slider to the final turn. **Download daily CSV** exports day-end holdings and
missed meals through the selected snapshot. A partial day remains inspectable in
the dashboard but is not presented as a completed day in the CSV. Full playback
exports include private operator evidence; metadata-only exports remove it.

New economy runs use compact archive checkpoints and can restore or branch from
a settled saved boundary. Older recordings exceeding the legacy checkpoint's
1 MiB allowance remain playback-only. Playback reads do not instantiate hosts or
providers.

For a headless run and an independent read-only report:

```sh
npm run economy
npm run economy:report -- --input path/to/saved-run --csv market-days.csv
```

The report refuses to overwrite an existing CSV. The headless runner prints its
saved directory. Use `simkind/node` to open it programmatically; the playground's
recording selector lists only its own recording directory.

## Rules and starting positions

| Person | Coins | Food | Timber | Tools (remaining uses) | Food / timber / tool output per shift |
| --- | ---: | ---: | ---: | --- | --- |
| Ada | 40 | 8 | 0 | 4 | 4 / 1 / 1 |
| Bram | 8 | 2 | 8 | none | 1 / 4 / 1 |
| Cleo | 15 | 3 | 2 | 4, 4 | 1 / 1 / 2 |
| Dev | 2 | 2 | 0 | none | 2 / 2 / 1 |

Everyone has one productive shift per day. Food and timber come from common
resources without inputs; crafting consumes two timber per batch. Skills set
batch output. A tool adds two food or timber to a shift and loses one of four
uses. It cannot boost tool crafting. Transferring or lending a tool preserves its
remaining durability. Output arrives next round, before any day-end consumption.

Each person consumes one **available** food at day end. Food reserved in an open
offer cannot be eaten until reclaimed. A missed meal halves the following day's
production, rounded down with a minimum of one. There is no death or debt. Everyone
can gather enough food for bare subsistence without buying access to a job.
Food does not spoil in this first version. The total 65 coins are conserved across
inventories, offers, and work. There is no bank, price setter, automatic wage, or
unlimited buyer. Personal motivations are prose and editable intentions, not hard
rules requiring cooperation, exploitation, or a chosen ending.

## Contracts

`produce`, `offer`, `accept`, `cancel`, and `say` are the economy tools. Optional
`simkind.revise` lets characters revise their own intentions and interpretations.

An offer contains `kind`, `to`, `give`, `want`, `task`, `useTool`, and `expiresAt`.
The offer's ID is its recorded action ID, returned in the action result and order
book. All contract terms are public; a recipient restricts who may accept.

- **Trade:** reserve `give`, request `want`, set `task=null` and `useTool=false`.
  Acceptance exchanges resources atomically. A different price is a new offer;
  speech never changes an existing contract.
- **Job:** reserve `give` as payment, set `want={}`, and name production in `task`.
  The employer also reserves required timber and any borrowed tool. Acceptance
  spends the worker's shift, fixes the yield from current skill/hunger/conditions,
  and schedules completion next round. Output goes to the employer and the wage
  to the worker only after completion. The worn borrowed tool returns to its owner.
- **Cancellation/expiry:** owners may withdraw open offers and reclaim escrow.
  Offers expire before acceptance at the named absolute round. Jobs already
  accepted finish even if the offer subsequently reaches its expiry round. The
  runner's action cancellation API can cancel unfinished work, returning inputs
  and payment; the attempted shift remains spent. There is no partial wage or output.

Each owner may keep three open offers. A deadline must fall within three days and
the simulation horizon. Admission always rechecks balances and ownership; two
characters cannot spend or accept the same resources twice. Competing acceptances
are ordered by actual admission, which is recorded for replay.

## Experiments and development evidence

Save an early settled parent, open it, and branch. **Change world conditions** can
change food productivity or reveal inventories. Harvest changes affect future
shifts, not work already admitted. Set productivity back later to end a temporary
shock. Rehiding inventories cannot erase memories of information already revealed.
Create two continuations from the same saved parent to compare their traces.

Ask whether Dev becomes dependent on wages, whether specialists form repeat trading
relationships, whether tool ownership changes productivity, and whether bargains
change after a harvest shock. Record refusals, failures, and alternative outcomes;
no single story or branch pair establishes a general causal result.

`tests/economy.test.ts` covers escrow, conservation, wear, stale offers, wages,
cancellation, private perspectives, branch restore, and a full recorded horizon.
For an explicitly scripted plumbing sample with jobs and barter:

```sh
npm run economy:fixture
```

That sample is saved in the playground recording directory and labeled as a
fixture by the dashboard. It demonstrates mechanics, not emergent LLM behavior.

### Negotiated tool quality (host contract 1.1)

Offers may specify `giveToolMinUses` and/or `wantToolMinUses`, from 1 to 4, when that
side includes tools. Four means fresh. Posting reserves qualifying offered tools;
acceptance rechecks qualifying payment tools atomically. Omitting quality accepts
any usable tool, preserving quantity-only behavior. Transaction receipts record the
actual transferred holdings, including remaining uses. The host never infers quality
from speech or chooses a bargaining strategy.

Character observations and action receipts label available, reserved, and owned
balances. Posting an offer explicitly reports reservation, not a sale. Existing 1.0
recordings remain available for playback; exact restoration requires their original
host implementation. New scenarios use host/tool-catalog contract 1.1.0.

## Perception and long runs

New implementation `1.2.0` supplies current holdings and open offers separately
from exact dialogue and transaction receipts. Public trades and wages remain
public events; private speech retains its original audience. Identical dialogue
on another turn is a new occurrence. Earlier recordings resume with their exact
implementation. See [Building simulations](building-simulations.md) for the
general scenario contract and [Durable runs](durable-runs.md) for unattended
execution, monitoring, and checkpoint recovery.
