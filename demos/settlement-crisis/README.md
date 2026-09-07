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

## Run

Interactive deterministic mode:

```sh
npm run demo:settlement
```

Non-interactive 30-tick run:

```sh
npm run demo:settlement -- --run 30
```

Live Luna mode uses `OPENROUTER_API_KEY` from the repository `.env`:

```sh
npm run demo:settlement -- --live --run 30
```

Interactive controls: `n` advances one tick, `r` advances five, `a` runs to
tick 30, and `q` quits.

## Boundary

This directory imports only the public `simkind` package. It owns all
settlement-specific types and behavior; the core knows nothing about pumps,
bridges, hunger, medicine, notices, or these six simkins.
