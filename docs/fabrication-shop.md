# Fabrication shop

Four characters try to make a struggling fabrication shop work over a six-week,
120-turn trial. Ada has cash and the lease, Bram has manufacturing skill and raw
materials, Cleo owns equipment and repairs it well, and Dev has a private customer
lead and cheaper sourcing. Their inventories and ambitions differ. There is no
scripted cooperation, fixed wage, or prescribed winner.

## Start and observe

Run `npm run playground`. In **More → Setup**, choose **fabrication shop**, click
**Load scenario**, review the connection, and **Start new run**. The model must be
explicit; OpenRouter credentials stay in the local environment. The template
enables memory consolidation and original-evidence recall, permits up to 1,200
requests, and sets no model output-token cap. The configured request limit is a
ceiling, not an estimate of a run's cost.

The report leads with each character's actions and quoted speech. Below it,
customer orders show quantities, quality, payment, deadlines and status. Expand a
character's holdings for equipment wear, rental details and available inventory.
**Market & world state** includes binding offers and a cash accounting check.
This is an operator view: seeing a private lead here does not reveal it to the
other characters.

Use **Next turn** to generate a turn, **Play live** to continue automatically,
and **Back** or the slider to inspect prior turns. Playback never makes model
calls. **More → Saved runs** saves, opens and exports recordings. The final closing
boundary is turn 121; it finishes work admitted on turn 120 and charges final rent.

## Customer orders

The initial batch is deliberately competing:

| Customer | Order | Payment | Deadline | Visibility |
| --- | --- | ---: | ---: | --- |
| Night Shift Events | 4 standard units | $18 | Turn 18 | Public |
| Gridline Interiors | 10 standard units | $55 | Turn 36 | Public |
| Vector Robotics | 6 premium units | $66 | Turn 28 | Dev's private lead |

At a settled live turn, click **Add customer order** below the character recaps.
Set a customer, units, minimum quality, total payment, deadline and brief; choose
everyone or a single recipient. **Preview order → Send order** records and saves
the change. Characters learn it on their next turn. The form also works at turn
zero, so you can add to the opening batch before asking anyone to act.

Pause an automatic run first. If manufacturing or repair is still in progress,
**Finish current work** advances the host without requesting new decisions. This
preserves the runner's settled-boundary intervention rule. An outstanding provider
must also finish or complete timeout cleanup before an intervention is available.

To change the initial batch itself, edit the scenario's `initialConditions.orders`
in Setup before starting. To amend an existing order during a run, use
**More → Diagnostics → Change world conditions → amend_order**. Supply the same
ID and recipient with replacement terms. The order revision increments; an old
delivery decision is rejected. Delivered and expired orders cannot be amended.
The equipment-damage operation is available there too, for idle owned equipment.

Only quantity, minimum quality, total payment and deadline are enforced customer
terms. The brief supplies context, not extra executable conditions. Orders are
paid only on full delivery by their claimant, on or before the deadline. Premium
products can satisfy a standard order. A character can release a claim or publish
a private lead. No automatic orders arrive after the initial batch: you control
the subsequent demand shocks.

## Commercial rules

- One productive shift per four-turn day: manufacture, repair, or buy materials.
  Negotiation, delivery, transfers and funding rent do not use that shift.
- Manufacturing consumes one material per unit, with batch size limited by the
  worker's skill. One equipment use is spent per batch. Equipment with 3–4 uses
  at admission makes premium products; 1–2 makes standard. Work finishes next turn.
- Repairs consume a shift and one material, restoring an owned worn tool by the
  character's repair skill, up to four uses. Fully exhausted tools disappear.
- Trades reserve the offered goods. Paid manufacturing jobs reserve wages,
  materials and qualifying equipment; workers receive wages on completion.
- New implementation `1.1.0` rejects a job before escrow if no eligible recipient
  can make its entire batch within their skill limit. Recipient-specific tool
  constraints expose that limit; larger orders can be split into separate jobs.
- Rentals charge the agreed fee at acceptance, then return equipment automatically
  with its remaining uses. The borrower can return idle equipment early. Wear is
  borne by its owner; the fee is not refunded. Rental quality can be constrained.
- The shared fund starts at $20 and owes $12 every 20 turns. Anyone may contribute.
  Rent arrears suspend new manufacturing and repairs. Contributions create no
  ownership stake. Spoken equity, commission and profit-sharing promises remain
  nonbinding; actual payments require supported transfers.

Customer payments bring cash in; supplier purchases and rent take cash out. The
host checks **cash held + supplier payments + rent paid = initial cash + customer
revenue**, including reserved cash. Business failure is a possible valid outcome.

## Verification and boundaries

`npx vitest run tests/fabrication.test.ts` checks private leads, recorded injection,
amended terms, atomic delivery, deadlines, job reservations and payment, rental
wear, cancellation, rent accounting, and exact host restoration. A scripted
121-turn trial includes a completed customer delivery, paid work, a rental, and
an injected order, then verifies archive playback and historical visibility.
It is a mechanical integration check, not evidence of emergent model behavior.

The example lives in `examples/fabrication`; shop mechanics do not enter the
generic runner. It reuses the provider, memory, intervention, archive and turn
cursor APIs. Existing scenarios keep their own contracts and recordings.

This scenario is ready for live observation, but a successful fixture run does
not establish memory accuracy, robust negotiations, or good economics for every
model. The previous general memory/recovery evaluations remain separate evidence.

New runs deliver exact dialogue and participant receipts separately from current
shop state. A completed payment is recorded as a receipt; a quoted promise remains
a statement. Existing implementation `1.0.0` recordings retain their original
rules on resume. See [Building simulations](building-simulations.md) to reuse the
same structures in other domains, and [Durable runs](durable-runs.md) to supervise
a full trial independently of the playground.

Implementation `1.2.0` keeps the same action shapes and economic effects while
clarifying field roles in its actor-specific schemas. For a job, `give` is
compensation to the worker; manufacturing inputs are reserved separately from the
employer's remaining stock. Non-cash compensation remains legal when both
reservations can be funded. Rejections identify this distinction and the remaining
materials and qualifying owned tools, without changing inventory. Earlier `1.1.0`
recordings retain their original descriptions and rejection text.
