# Village evaluation — 2026-08-11

Status: historical. Archived 2026-09-07; retained as a dated observation, not
current setup guidance or a benchmark. See the [current testing guide](../testing.md)
for supported commands and model selection.

Evaluated 2026-08-11 with the 30-tick village scenario. Aya promises to bring
Mira the world's only mint while also personally wanting to keep it. Mira knows
where mint grows and needs it to brew tea. Their engine-backed commitments are
complete only after the transfer and brewing events actually occur.

## Results

| Measure | Deterministic stress provider | OpenRouter `openai/gpt-5.6-luna` |
| --- | ---: | ---: |
| Aya promise completed | tick 13 | tick 3 |
| Mira tea completed | tick 16 | tick 5 |
| Model requests | 14 | 10 |
| Applied decisions | 12 | 9 |
| Rejected decisions | 2 | 1 |
| Fallbacks | 1 timeout | 0 |
| Conversation memories created | 1 | 1 |
| Decisions with that memory ID in context | 5 | 3 |
| Repeated identical actions | 5 | 0 |
| Stalled ticks | 5 | 0 |
| Maximum pending / in flight | 2 / 2 | 2 / 2 |
| Replay matched | yes | yes |
| Save/reload matched | yes, with 2 requests pending | deterministic gate |
| Tokens / reported cost | local scripted provider | 3,955 / $0.0006555 |

The deterministic provider deliberately produced one contextually illegal
gather, one timeout fallback, and one late completion; all three were contained
and recorded. The world was serialized at tick 5 with two requests pending,
reloaded, and reached the exact same final state and ledger as the uninterrupted
run.

Luna discovered a different legal coordination strategy. Mira told Aya the mint
location, followed Aya to the grove, attempted to gather after Aya had taken the
only mint (correctly rejected), received the mint there, returned to the square,
and brewed tea. It completed both commitments without a fallback and replayed
exactly. The live result is a behavioral smoke sample, not a deterministic
benchmark; repeated runs may choose different legal plans.

The memory count records inclusion of a recalled ID, not proven causal influence
or delivery of its full text to the model. Costs
and model behavior above describe the original sample. Current live demos
require an explicit model choice and may produce different outcomes.

## Commands used for this scenario

```sh
npm run demo:soak
npm run demo:openrouter:soak
```
