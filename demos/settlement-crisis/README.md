# Settlement crisis demo

> PROTOTYPE — isolated from the Simkind core and safe to delete as a directory.

## Question

Can several locally informed simkins coordinate through scarce resources,
trust, requests, notices, and changing infrastructure without the host losing
authority or the behavior collapsing into repetitive global planning?

The settlement contains six simkins, four locations, a weakening pump, an
unsafe bridge, scarce food, medicine, and repair parts. Information is local:
simkins act only on their memories, what they observe, direct requests, and a
public noticeboard. The host validates every proposed action and records its
outcome.

## Run with your API key

From the repository root, run `npm run setup`, then put your OpenRouter key in
`.env` as `OPENROUTER_API_KEY=your-openrouter-api-key` and choose a model with
`OPENROUTER_MODEL=provider/model-id`. See the
[root quick start](../../README.md#quick-start-bring-your-own-api-key) for key
creation and model selection instructions. There is no default model. Live
mode consumes credits from your OpenRouter account.

Interactive live mode:

```sh
npm run demo:settlement -- --live
```

Controls: `n` advances one tick, `r` advances five, `a` runs to tick 30, and
`q` quits. To run without interaction and print a report:

```sh
npm run demo:settlement -- --live --run 30
```

For deterministic development checks, omit `--live`:

```sh
npm run demo:settlement -- --run 30
```

## Boundary

This directory imports only the public `simkind` package. It owns all
settlement-specific types and behavior; the core knows nothing about pumps,
bridges, hunger, medicine, notices, or these six simkins.
