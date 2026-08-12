# Simkind

Engine-authoritative cognition for living game characters.

Each simulated character is a **simkin**; collectively, they are **simkind**.
Their decisions may come from an LLM, but the host game remains authoritative.

Simkind owns stable policy and orchestration seams:

- an engine-owned capability catalog used by prompts and validation;
- deterministic, evidence-ranked memory retrieval;
- measurable commitment criteria and goal progress;
- conversation lifecycle policy;
- exact decision recording and replay inputs;
- a non-blocking, provider-neutral model request runtime with correlated outcomes;
- simkin lifecycle orchestration through a game adapter; and
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
  createSimkinRuntime,
  defineCapabilityCatalog,
  rankMemories,
} from 'simkind';
```

See [the integration guide](docs/integration.md) and
[`examples/reference-world.ts`](examples/reference-world.ts). The reference
world is intentionally tiny but executable:

```sh
npm install
npm run check
npm run example
npm run example:station
```

## Maturity

Version `0.1.0` is an extraction boundary, not a frozen universal simkin API.
The exported interfaces are intentionally narrow so additional games can
challenge them without importing Cozy Village concepts.

## Documentation

- [Architecture](docs/architecture.md)
- [Host-game integration](docs/integration.md)
- [Goals and memory](docs/goals-and-memory.md)
- [Determinism and evaluation](docs/determinism-and-evaluation.md)
- [Testing strategy](docs/testing.md)
