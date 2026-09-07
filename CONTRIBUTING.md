# Contributing

Simkind is experimental. Open an issue to discuss changes to public interfaces
or new host responsibilities before investing in a large change. Bug reports
should include the Node version, a minimal reproduction, expected behavior,
and actual behavior. Remove credentials and private scenario data from reports.

## Development

Use Node 24 (or Node >=22.12), then run:

```sh
npm ci
npm run check
npm run demo
npm run demo:soak
```

Before committing, stage the intended files and run `npm run check:public`.
It checks the Git index, including staged content, for environment files and
common credential patterns without printing matching values. This is a focused
safeguard, not a complete secret scanner. CI runs it on every push and PR.

Keep game-specific rules in examples or demos. Changes to core should explain
which host contract they improve and include a focused regression test when
behavior changes. Add or update documentation when public behavior changes.
Keep live-provider tests opt-in: they cost money and are nondeterministic.

## Repository layout

- `src/`: provider-neutral library exported through `src/index.ts`.
- `tests/`: contract and deterministic integration tests.
- `examples/`: small host integrations and scripted/live scenarios.
- `demos/`: isolated experimental hosts using the public package exports.
- `docs/`: architecture, integration contracts, and evaluation notes.

`npm pack` builds a local installable archive. The package is not currently
published to the npm registry. Contributions are distributed under the project's
MIT license.
