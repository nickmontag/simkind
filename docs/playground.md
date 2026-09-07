# Local playground

Start with the README's BYOK setup and explicit `OPENROUTER_MODEL`, then:

```sh
npm run playground
```

Open `http://127.0.0.1:4317`. The application runs locally; there is no hosted
service. It binds loopback, checks Host/Origin, requires a random local session
token for API access, and renders authored content as text. Keys stay in the
server process. The browser receives model IDs and connection availability.
Restart after editing `.env`. Do not expose this operator interface publicly.

1. Load Shared Decision, Workshop, Pump Crisis, or Orbital Greenhouse.
2. Edit the authoritative scenario, character JSON/Markdown, or run-config source.
   Alternatively, open Edit document fields and Load fields from source. Ordinary
   fields use the shipped schemas, including host-specific initial conditions.
   Complex arrays/unions retain JSON editors. Apply fields validates the document
   and writes it back in its original representation. Optional extensions survive
   unchanged; changed source must be reloaded before applying an older form.
   Download sources to keep edits; Import sources opens those bundles later.
3. Open Connection slots. Choose an explicit provider/model. The primary fields
   edit `primary`; the JSON editor supports any additional per-character slots.
   Keys are referenced by local environment variable names, never pasted here.
4. Validate to inspect effective configuration, overlay sources, and initial
   character states. Invalid contracts block launch.
5. Start, then Step once or Run to the configured step limit. Pause dispatch stops
   automatic progression after the current opportunity finishes. Advance host
   progresses the simulation with dispatch paused; Step enables one new decision
   opportunity. Stop aborts local requests and marks incomplete evidence.
6. Select a perspective and event. Decision records show the actual context;
   actions link proposals, supplied contracts, and outcomes. The operator can
   inspect all records. The perspective selector is an operator filter, not an
   access-control or redaction mechanism, and never changes model input.
7. Save checkpoint / run writes a new immutable recording. Settled runs include a
   checkpoint; unresolved or stopped runs retain playback evidence. Open playback
   loads and verifies the saved files without calls to models or host tools.
8. Branch from a supported checkpoint. Select a character, open Character state /
   intervention, review its current revision and edit, and apply the recorded
   transaction. Change world conditions lists the installed host's operator
   operations, with schema-based fields, expected revision, and a read-only effect
   preview. Apply revalidates and records the change. Resume with Run or Step.
9. For sibling comparison, open the same saved parent before creating each branch.
   Save the first continuation, then choose it in Branch comparison on the second.
   The view proves a shared checkpoint and presents separate traces and totals.
   Unrelated checkpoints are refused. Parent prefix totals remain separately labeled.

The local recording browser lists directories created by the playground. The
CLI can verify/open other recording directories with `simkind/node`.
Downloaded playback JSON can be opened through Import playback on another local
playground without a key. These exports omit original sources and checkpoints,
explicitly reducing capability to playback. Export metadata only removes all event
content and effective model assignments; it is an intentionally coarse redaction.
A normal playback export can contain private character knowledge. Review it before
sharing. The file-input/API import limit is 1 MiB; directory playback supports the
larger limits documented in [Checkpoints](checkpoints.md).

Orbital Greenhouse adds a read-only orthographic 3D viewer. It consumes the same
host snapshots as headless execution. The viewer does not control the clock,
advance physics, or modify observations.

## Development

```sh
npm run playground -- --fixture --port 4317
```

Fixture mode is for deterministic checks and supplies an explicit no-action
provider. It is separate from the live onboarding flow. HTTP/session tests cover
editing, validation, save/open, immutable branches, redaction, and local API access.
The browser is a client of the public package through `playground/session.ts`;
there is no second simulation runtime in the UI.
