# Living Character Kernel

A small, game-agnostic TypeScript kernel for characters whose decisions may
come from an LLM while the game engine remains authoritative.

The kernel owns stable policy and orchestration seams:

- an engine-owned capability catalog used by prompts and validation;
- deterministic, evidence-ranked memory retrieval;
- measurable commitment criteria and goal progress;
- conversation lifecycle policy;
- exact decision recording and replay inputs;
- a non-blocking, provider-neutral model request runtime;
- character lifecycle orchestration through a game adapter; and
- focused evaluation counters.

It deliberately does **not** own maps, pathfinding, inventories, combat,
relationship formulas, story scripts, prompt prose, model providers, or legal
action execution. Those stay in the host game.

## Core rule

The LLM proposes. The engine validates, executes, and records.

```text
world snapshot -> game adapter -> model request -> proposed decision
      ^                                      |
      +--- validate / execute / record <-----+
```

## Use

```ts
import {
  createCharacterRuntime,
  defineCapabilityCatalog,
  rankMemories,
} from 'living-character-kernel';
```

See [the integration guide](docs/integration.md) and
[`examples/reference-world.ts`](examples/reference-world.ts). The reference
world is intentionally tiny but executable:

```sh
npm install
npm run check
npm run example
```

## Maturity

Version `0.1.0` is an extraction boundary, not a frozen universal agent API.
The exported interfaces are intentionally narrow so additional games can
challenge them without importing Cozy Village concepts.

## Documentation

- [Architecture](docs/architecture.md)
- [Host-game integration](docs/integration.md)
- [Goals and memory](docs/goals-and-memory.md)
- [Determinism and evaluation](docs/determinism-and-evaluation.md)
- [Testing strategy](docs/testing.md)

