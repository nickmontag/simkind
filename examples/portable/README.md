# Authorable reference hosts

See the [portable scenario guide](../../docs/portable-scenarios.md) for BYOK setup,
file authoring, model slots, limits, embedding, and recording semantics.

```sh
npm run scenario -- --scenario shared-decision.json
npm run scenario -- --scenario workshop.json
npm run scenario -- --scenario pump-crisis.json
```

All commands require an explicit model and key in `.env` or the environment.
The conversation host supports both group decisions without any spatial fields.
The settlement host adds timed travel, local resources, transfers, and repairs.
They use the same public runner, with no host-specific branches in core.

Editable inputs live in `scenarios/`. Keep tool catalogs in sync with the installed
host contract; authoring new prose does not install a tool implementation.
For a deterministic developer check, add `--fixture`. It makes no provider calls
and selects no action; contract tests exercise the consequential host operations.
