# Simkind

An experimental TypeScript toolkit for game characters that remember events,
pursue commitments, and request decisions from language models. Your game
controls which actions are allowed and what actually happens.

Each character is a **simkin**; collectively, they are **simkind**.

For example, Aya remembers a promise to bring Mira mint. A model can propose
moving, gathering, and giving, but the game checks each action and only marks
the promise complete when the mint actually changes hands. Recorded decisions
let the game replay the same sequence without calling the model again.

## Try it locally

Requires **Node.js 22.12 or later** and npm. Node 24 is the development default
(`nvm use` reads `.nvmrc`). The scripted demos need no API key or paid service.

```sh
git clone https://github.com/nickmibarra/simkind.git
cd simkind
npm ci
npm run check
npm run demo
```

The four-tick demo completes Aya's promise, handles malformed model output and
a provider failure with scripted fallbacks, and prints `replayMatched: true`.
`npm ci` builds the library automatically.

| Command | What it demonstrates |
| --- | --- |
| `npm run demo` | Two characters completing a promise, with validation and replay |
| `npm run demo:soak` | 30 ticks covering timeouts, late results, save/reload, and replay |
| `npm run demo:settlement` | Interactive six-character settlement prototype |
| `npm run demo:settlement -- --run 30` | Non-interactive scripted settlement run |
| `npm run example` | Small memory, goal, and lifecycle example |
| `npm run example:station` | A second host using a space-station world |

## What the toolkit provides

- Capability descriptions derived from an engine-owned action catalog.
- Deterministic memory ranking and evidence-backed commitment evaluation.
- Conversation lifecycle rules and character lifecycle ordering.
- Asynchronous, provider-neutral model requests with correlated results.
- Decision recording, replay inputs, host validation helpers, and evaluation counters.

The central rule is: **the model proposes; the engine validates, executes, and
records.** Your host supplies world state, action schemas and executors, prompts,
model providers, timeout policies, and persistence. Simkind does not include a
game engine, renderer, pathfinding system, or turnkey autonomous character.

```text
world snapshot -> game adapter -> model request -> proposed decision
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

## Optional live demos

Live demos send scenario snapshots to OpenRouter and consume API credits.
They currently select `openai/gpt-5.6-luna`; availability and pricing depend on
the provider. Scripted demos are the reproducible baseline.

```sh
cp .env.example .env
# Edit .env and set OPENROUTER_API_KEY locally.
npm run demo:openrouter
# Longer scenarios:
npm run demo:openrouter:soak
npm run demo:settlement -- --live --run 30
```

The adapters read the repository's `.env` file. `.env` and `.env.*` are ignored,
except the blank `.env.example`. Never put credentials in source, examples,
issue reports, or committed logs. CI checks tracked files for environment files
and common credential patterns. Live demos report provider-returned token usage
and cost, and are excluded from CI.

## Status and limitations

Version 0.1.0 is an experimental library with no API stability guarantee.
Deterministic tests cover its contracts; live results are individual behavioral
samples, not quality or performance guarantees. Replay requires the host to
preserve its initial state and deterministic execution. Resetting the model
runtime discards stale results but does not cancel in-flight provider requests.
The settlement demo is an isolated prototype.

## Documentation and contributing

- [Architecture](docs/architecture.md)
- [Host-game integration](docs/integration.md)
- [Goals and memory](docs/goals-and-memory.md)
- [Determinism and evaluation](docs/determinism-and-evaluation.md)
- [Testing strategy](docs/testing.md)
- [Evaluation sample](docs/evaluation.md)
- [Contributing](CONTRIBUTING.md)

Licensed under the [MIT License](LICENSE).
