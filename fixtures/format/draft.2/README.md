# Draft.2 document fixtures

`cases.json` enumerates the six document kinds. Each input must pass the schema
and local semantic checks, but standalone validity does not assert that its
resources exist or that a host/model can execute it. Tests also compile the
standalone schema wrapper for each kind against the shared local document schema.

`tests/portable-fixtures.test.ts` runs this manifest. `tests/portable-node.test.ts`
exercises file resolution, including duplicate IDs, cycles, hashes, invalid UTF-8,
size limits, and escaping symlinks. `tests/portable-runner.test.ts` covers launch
references, features, private context, and action/runner semantics. Fixtures and
samples contain no live credentials.
