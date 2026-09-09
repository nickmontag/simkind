# Small Economy reference host

See [setup, live observation, playback, and rules](../../docs/economy.md).

`model.ts` contains resource/accounting rules; `catalog.ts` defines character
contracts; `host.ts` owns legality, time, and private observations; `report.ts`
reads immutable operator evidence without executing the host. Character definitions
and starting positions live in `examples/portable/scenarios/small-economy.json`
and its referenced files. `fixture.ts` is a separate scripted development check,
never selected for live runs.
