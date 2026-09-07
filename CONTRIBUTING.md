# Contributing

Simkind is experimental. Open an issue to discuss changes to public interfaces
or new host responsibilities before investing in a large change. Bug reports
should include the Node version, a minimal reproduction, expected behavior,
and actual behavior. Remove credentials and private scenario data from reports.

## Phase 2 implementation

Read the [roadmap](https://github.com/nickmibarra/simkind/blob/main/roadmap.md),
[schema architecture](https://github.com/nickmibarra/simkind/blob/main/docs/design/schema.md), and linked
host, playground, and conformance documents before implementing Phase 2 work.
They distinguish current capabilities from proposed contracts and acceptance
criteria. Preserve character freedom: host constraints and tool schemas must
not become prescribed strategies or mandatory social scripts.

## Development

Use Node 24 (or Node >=22.12), then run:

```sh
npm ci
npm run check
npm run demo
npm run demo:soak
```

Before committing, stage the intended files and run `npm run check:public`.
It checks the Git index, including staged content, for private note folders,
environment files, and common credential patterns without printing matching values. This is a focused
safeguard, not a complete secret scanner. CI runs it on every push and PR.

Keep simulation-specific rules in examples or demos. Changes to core should explain
which host contract they improve and include a focused regression test when
behavior changes. Add or update documentation when public behavior changes.
Keep live-provider tests opt-in: they cost money and are nondeterministic.

## Repository layout

- `src/`: provider-neutral library exported through `src/index.ts`.
- `tests/`: contract and deterministic integration tests.
- `examples/`: small host integrations and scripted/live scenarios.
- `demos/`: isolated experimental hosts using the public package exports.
- `docs/`: current guides and the [documentation index](docs/README.md).
- `docs/design/`: public draft proposals, clearly separated from shipped behavior.
- `docs/archive/`: dated results and useful superseded guidance.
- `.internal/`: ignored local planning, agent handoffs, research, and scratch files.

Follow the [documentation policy](docs/documentation-policy.md) when adding,
moving, or retiring a document. Keep public design decisions self-contained;
private session notes are not a dependency for contributors.

`npm pack` builds a local installable archive. The package is not currently
published to the npm registry. Contributions are distributed under the project's
MIT license.
