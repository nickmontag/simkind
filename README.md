# Simkind

A TypeScript toolkit for **LLM-driven simulated characters** that remember
events, pursue commitments, and act within a world governed by a host simulation.
Use it for simulations, including games: language models propose character
actions, and the host controls which actions are allowed and what happens.

Each character is a **simkin**; collectively, they are **simkind**.

For example, Aya remembers a promise to bring Mira mint. A model can propose
moving, gathering, and giving, but the simulation checks each action and only marks
the promise complete when the mint actually changes hands. Recorded decisions
let the simulation replay the same sequence without calling the model again.

## Quick start: bring your own API key

You need **Node.js 22.12 or later**, npm, and an **OpenRouter API key** with
available credits. You choose the model; there is no default. The included live
adapters use OpenRouter, and Simkind's core can work with other providers through
your own adapter.

### 1. Install

```sh
git clone https://github.com/nickmibarra/simkind.git
cd simkind
npm run setup
```

Setup installs dependencies, builds the library, and creates `.env`. It keeps
any existing `.env` unchanged. If you use nvm, run `nvm use` before setup to
select the project's Node 24 default.

### 2. Add your key and choose a model

Create an API key in [OpenRouter settings](https://openrouter.ai/settings/keys)
and add credits to your account. See the
[OpenRouter quickstart](https://openrouter.ai/docs/quickstart) for provider setup.
Use an OpenRouter key here; a direct model-provider key will not authenticate
with these adapters.

Choose a model from the [OpenRouter catalog](https://openrouter.ai/models) that
supports [structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs).
Copy its exact model ID. Open `.env` in the Simkind folder with your editor,
fill in both values, and save:

```dotenv
OPENROUTER_API_KEY=your-openrouter-api-key
OPENROUTER_MODEL=provider/model-id
```

Replace both placeholders with your own values. If you already had a `.env`,
add the `OPENROUTER_MODEL` line. Change that line whenever you want to try a
different model; all live demos use it.

The demos read this file directly; you do not need to export or source it.
Environment variables override the file if you prefer configuring runs from a
shell or CI. `.env` is ignored by Git. Requests use your account and consume credits.

### 3. Run the characters

```sh
npm run demo:openrouter
```

This runs a short live scenario: Aya tries to fulfill her promise to bring Mira
mint, while the simulation validates each model-proposed action. At the end,
you get the action log, goal status, `replayMatched`, and reported token usage
and cost. Live choices and goal completion can vary; `replayMatched: true`
means the recorded decisions reproduced the final simulation state.

Then try six characters in an interactive settlement:

```sh
npm run demo:settlement -- --live
```

Press **n** for one tick, **r** for five, **a** to advance to tick 30, or **q** to
quit. Each advance requests model decisions and updates the settlement.

| Live command | Scenario |
| --- | --- |
| `npm run demo:openrouter` | Short two-character promise scenario |
| `npm run demo:openrouter:soak` | Longer village scenario with competing goals |
| `npm run demo:settlement -- --live` | Interactive six-character settlement |
| `npm run demo:settlement -- --live --run 30` | Run the settlement for 30 ticks and print a report |

### Setup troubleshooting

- **Node version error:** use Node 22.12 or later, then rerun `npm run setup`.
- **Missing key or model:** rerun setup, then fill in `OPENROUTER_API_KEY` and
  `OPENROUTER_MODEL` in the root `.env`. Setup preserves existing files.
- **No successful model requests or provider-error fallbacks:** check that your
  key is valid and your OpenRouter account has credits and access to the selected
  model. Verify its model ID and structured-output support. `replayMatched`
  alone does not prove that provider calls succeeded.

## What the toolkit provides

- Capability descriptions derived from an engine-owned action catalog.
- Deterministic memory ranking and evidence-backed commitment evaluation.
- Conversation lifecycle rules and character lifecycle ordering.
- Asynchronous, provider-neutral model requests with correlated results.
- Decision recording, replay inputs, host validation helpers, and evaluation counters.

The central rule is: **the model proposes; the engine validates, executes, and
records.** Your host supplies world state, action schemas and executors, prompts,
model providers, timeout policies, and persistence. Simkind does not include a
simulation engine, renderer, pathfinding system, or turnkey autonomous character.

```text
world snapshot -> host adapter -> model request -> proposed decision
      ^                                               |
      +-------- validate / execute / record <---------+
```

See the [integration guide](docs/integration.md) for the host contract.
[`examples/two-simkins.ts`](examples/two-simkins.ts) connects the complete loop;
[`examples/reference-world.ts`](examples/reference-world.ts) is a smaller tour
with trusted scripted inputs, not a model-output validation example.

## Use in another project

Simkind is not published to the npm registry. The package is ESM-only and
includes TypeScript declarations. To install a locally built snapshot:

```sh
# In the Simkind checkout:
npm ci
npm pack
# In your own project, install the generated archive:
npm install /path/to/simkind/simkind-0.1.0.tgz
```

The path above is a placeholder for your checkout. Then use the public exports:

```ts
import { defineCapabilityCatalog, renderCapabilityPrompt } from 'simkind';

const catalog = defineCapabilityCatalog({
  Wait: { description: 'Remain in place for one tick.', examples: ['Wait'] },
});
console.log(renderCapabilityPrompt(catalog));
```

The archive contains the library and documentation. Run demos from the Git
checkout. Registry publication remains disabled with `private: true` while the
API is experimental.

## Development checks

Scripted scenarios exercise validation, fallbacks, and replay during development.
They run without provider calls and are the CI baseline:

```sh
npm run check
npm run demo
npm run demo:soak
```

`npm run example` and `npm run example:station` show smaller host integrations.
See [Contributing](CONTRIBUTING.md) for the development workflow. Live demos
send scenario snapshots to OpenRouter and are excluded from CI. Keep keys in
`.env`; the public-file check rejects tracked environment files and common
credential patterns.

## Status and limitations

Version 0.1.0 is an experimental library with no API stability guarantee.
Deterministic tests cover its contracts; live results are individual behavioral
samples, not quality or performance guarantees. Replay requires the host to
preserve its initial state and deterministic execution. Resetting the model
runtime discards stale results but does not cancel in-flight provider requests.
The settlement demo is an isolated prototype.

## Documentation and contributing

Phase 2 plans are design targets, not features already implemented in this alpha:

- [Phase 2 roadmap](roadmap.md)
- [Portable format and schema architecture](schema.md)
- [Host protocol and embodiment](docs/phase-2-host-protocol.md)
- [Playground and authoring](docs/phase-2-playground.md)
- [Conformance and release gates](docs/phase-2-conformance.md)

Current alpha documentation:

- [Architecture](docs/architecture.md)
- [Host simulation integration](docs/integration.md)
- [Goals and memory](docs/goals-and-memory.md)
- [Determinism and evaluation](docs/determinism-and-evaluation.md)
- [Testing strategy](docs/testing.md)
- [Evaluation sample](docs/evaluation.md)
- [Contributing](CONTRIBUTING.md)

Licensed under the [MIT License](LICENSE).
