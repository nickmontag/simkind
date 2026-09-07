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
available credits. You choose the model; there is no default. The portable adapters support OpenRouter, Ollama, and compatible JSON-text chat endpoints. See [provider setup](docs/providers-and-spatial.md).

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

### 3. Open the local playground

```sh
npm run playground
```

Open `http://127.0.0.1:4317`. Load a situation, edit its cast and private knowledge,
review the model slots, then start and step or run. Inspect actual perspectives,
memories, proposals, and consequences. Pause, save a settled checkpoint, and branch
with a recorded intervention. Edit ordinary fields through schemas, preview
host-defined world changes, and compare sibling continuations from the same
checkpoint. Open saved runs without making provider calls.
See the [playground guide](docs/playground.md).

### Run headlessly or embed the same loop

```sh
npm run scenario -- --scenario shared-decision.json
npm run scenario -- --scenario pump-crisis.json
npm run scenario -- --scenario orbital-greenhouse.json
```

The conversation, resource-constrained settlement, and independent 3D hosts use
the same public runner. Edit ordinary JSON/character Markdown, model assignments,
tools, and limits without changing TypeScript. `workshop.json` offers another
situation on the conversation host. See [portable authoring](docs/portable-scenarios.md)
and the [embedding starter](https://github.com/nickmibarra/simkind/tree/main/examples/embedding).

The older demos remain available with `npm run demo:openrouter`,
`npm run demo:openrouter:soak`, and `npm run demo:settlement -- --live`.
They retain their existing host-specific replay readers.

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
- Portable document schemas, a local scenario loader, and an optional shared
  character runner with private contexts and asynchronous host outcomes.
- Optional continuity, revision-checked intentions and interpretations, and complete
  supplied-memory provenance.
- Local authoring/inspection, verified playback, settled restore, immutable branches,
  character-card conversion reports, and an independent Python document reader.

The central rule is: **the model proposes; the engine validates, executes, and
records.** Your host supplies world state, action schemas and executors, prompts,
model providers, timeout policies, and persistence. The optional runner handles
the common loop. Simkind's core does not include a simulation engine, renderer,
or pathfinding system; reference hosts supply their own world rules.

```text
world snapshot -> host adapter -> model request -> proposed decision
      ^                                               |
      +-------- validate / execute / record <---------+
```

See the [integration guide](docs/integration.md) for the host contract.
[`examples/two-simkins.ts`](https://github.com/nickmibarra/simkind/blob/main/examples/two-simkins.ts) connects the complete loop;
[`examples/reference-world.ts`](https://github.com/nickmibarra/simkind/blob/main/examples/reference-world.ts) is a smaller tour
with trusted scripted inputs, not a model-output validation example.

## Use in another project

Simkind is not published to the npm registry. The package is ESM-only and
includes TypeScript declarations. To install a locally built snapshot:

```sh
# In the Simkind checkout:
npm ci
npm pack
# In your own project, install the generated archive:
npm install /path/to/simkind/simkind-0.2.0-alpha.1.tgz
```

The path above is a placeholder for your checkout. Then use the public exports:

```ts
import { defineCapabilityCatalog, renderCapabilityPrompt } from 'simkind';

const catalog = defineCapabilityCatalog({
  Wait: { description: 'Remain in place for one tick.', examples: ['Wait'] },
});
console.log(renderCapabilityPrompt(catalog));
```

The archive contains the library and current user and contributor guides. Run
the playground and examples from the Git checkout. Version `0.2.0-alpha.1` is prepared
for the npm `alpha` tag; registry publication is pending npm authentication.
See the [release evidence](docs/release-alpha.md).

## Development checks

Scripted scenarios exercise validation, fallbacks, and replay during development.
They run without provider calls and are the CI baseline:

```sh
npm run check
npm run demo
npm run demo:soak
npm run check:runs
npm run check:consumer
```

`npm run example` and `npm run example:station` show smaller host integrations.
See [Contributing](CONTRIBUTING.md) for the development workflow. Live demos
send scenario snapshots to OpenRouter and are excluded from CI. Keep keys in
`.env`; the public-file check rejects tracked environment files and common
credential patterns.

## Status and limitations

Version 0.2.0-alpha.1 is an experimental library with no API stability guarantee.
Deterministic tests cover its contracts; live results are individual behavioral
samples, not quality or performance guarantees. Replay requires the host to
preserve its initial state and deterministic execution. Resetting the model
runtime discards stale results but does not cancel in-flight provider requests.
The earlier settlement demo remains an isolated prototype. The portable reference
hosts now support settled checkpoints; physical restore, arbitrary world patches,
and provider/configuration migration across branches are outside this alpha.

## Documentation and contributing

The [documentation index](docs/README.md) covers the current alpha: architecture,
host integration, goals and memory, replay, and testing. See
[Contributing](CONTRIBUTING.md) to make a change.

The [Phase 2 roadmap](https://github.com/nickmibarra/simkind/blob/main/roadmap.md)
and [design proposals](https://github.com/nickmibarra/simkind/blob/main/docs/design/README.md)
track M1–M7 implementation evidence and remaining release gates.
They are explicitly drafts, separate from current usage instructions.

Licensed under the [MIT License](LICENSE).
