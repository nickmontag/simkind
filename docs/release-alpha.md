# 0.2.0-alpha.1 release candidate — 2026-09-07

Local implementation is complete for the scoped M3–M7 alpha capabilities below.
The npm archive is prepared; **registry publication is pending authentication**
(`npm whoami` returned `ENEEDAUTH`). This is not a claim that the package is already
available on npm. The implementation includes the earlier M1/M2 work.
The contributor walkthrough and clean-consumer checks are delivered; independent
human trials and broader behavioral/provider sampling have not been performed.

## Versions and boundaries

| Component | Version / scope |
| --- | --- |
| Runtime package | `0.2.0-alpha.1`, ESM, Node >=22.12 |
| Portable documents | `0.2.0-draft.2`; original draft.1 character reader preserved |
| Continuity | `simkind.continuity` 0.1.0, optional |
| Memory retrieval | 0.1.0 stable IDs without continuity; documented recency selection with continuity |
| Checkpoint | `simkind.checkpoint/1`, settled boundaries only |
| Spatial profile | `simkind.spatial` 0.1.0, optional TypeScript frame contract |
| Playback exchange | `simkind.playback/1`, explicitly no restore or execution |
| Card import | v1/v2 JSON text subset; full source retained inertly |
| Reference hosts | Contract 1.0.0; conversation/settlement implementation 1.1.0 with operator edits, original 1.0.0 replay readers preserved; spatial implementation 1.0.0 |
| Python reader | Draft.2 structural document fixture subset, jsonschema 4.23.0 |

Core contracts are separate from optional runner continuity, Node recording I/O,
provider transports, spatial helpers, reference hosts, and the playground client.
No mandatory planner, reflection loop, social script, or preferred story outcome
was added. Existing host-specific primitives/readers remain available.

## Verification evidence

The repository provides reproducible checks for:

- Strict documents/generated artifacts, private perspective projection, asynchronous
  tool lifecycles, provider timeouts, abort-ignoring concurrency, and request limits.
- Continuity provenance, self-report revisions, stale edit refusal, immutable host
  evidence, settled restore, parent-preserving branches, and corrupt snapshots.
- Spatial frame conversion, swept obstacles, timed progress/partial cancellation,
  and exact headless/viewer record equality.
- Local authoring, save/open/import, checkpoint availability, metadata redaction,
  hash corruption, and local HTTP origin/session protections.
- Schema-derived authoring with validated JSON/Markdown saves and extension
  preservation; pure world previews, atomic stale rejection, private message
  projection, replayable intervention logs, and exact sibling comparisons.
- Card conversion reports and JSON/Markdown extension preservation.
- Independent Python reading of all six positive draft.2 document fixtures and
  negative parser/structure cases; declared exclusions are in the reader guide.
- Three generated run fixtures with exact byte comparison; both legacy deterministic
  demos; scenario CLI and resume/replay commands; external tarball import/typechecks.

Run the full local suite with:

```sh
npm run check
npm run check:runs
npm run check:consumer
npm run demo
npm run demo:soak
.internal/python-reader/bin/python -m unittest discover -s examples/python-reader -v
```

The updated TypeScript suite passed 176 tests across 15 files. All three deterministic
run fixtures reproduced exactly, the clean external consumer passed, and the Python
reader passed its three test methods (including all six document fixtures).
Local verification used Node 24.15.0 and Python 3.14. CI is configured to repeat
Node checks on 22 and 24 and the independent Python subset on 3.12. Local results
do not imply those remote CI jobs have already run. Browser checks exercised the
local fixture start, step, save, playback, and branch flow, plus persona forms,
world previews/edits, and divergent sibling traces; HTTP/session tests
cover the same underlying public APIs. Fixture mode is not live-model evidence.

## Live sample: z-ai/glm-5.3-flash

The user selected this exact model for at most three requests, each capped at
256 output tokens. The one-step Shared Decision sample had one valid model
response, one accepted/succeeded speech action, and two contained provider errors.
The successful request reported 1,243 input tokens, 80 output tokens, and
$0.00022645. Usage and cost for the failed requests are unknown. Raw provider error
messages are intentionally excluded from portable evidence because they may
contain credentials; the original errors cannot be diagnosed from this recording.
No retries or substitute model were used.

The full fictional scenario recording is retained in
[the run fixtures](https://github.com/nickmibarra/simkind/tree/main/fixtures/runs/live-glm-5.3-flash),
alongside its sources and settled checkpoint. This mixed result is limited live
transport evidence, not a clean reliability pass. Ollama and generic compatible
transport behavior is tested with mocks, not a new local-model run. No comparative
benchmark establishes a state-of-the-art character-intelligence claim.

## Supported limits and deferred work

- Restoration requires exact host implementation and effective model/configuration
  compatibility. Child branches reset local budgets, retain host time/provenance,
  and keep the parent prefix as a separate immutable checkpoint.
- Character state and host-defined world interventions are supported; arbitrary world patches,
  cross-provider branch migrations, unresolved-action restoration, and physical
  restore/replay are not. Physical recording readers never execute tools.
- The spatial host is bounded kinematics with point agents and static spherical
  obstacles. It is not rigid-body physics or a production robot driver.
- Playback directory reads have 64 MiB total/32 MiB resource bounds; documents,
  events, checkpoint JSON, and UI imports retain a 1 MiB limit. Large checkpoint
  exports must be omitted or use a future archival profile.
- The playground edits authoritative JSON/Markdown through source and ordinary
  schema-derived fields. Complex arrays/unions use JSON editors; specialized
  graphical editors and multi-user hosting are not included.
- Redaction is coarse: metadata-only export removes all event content. A selected
  perspective is not a share permission. Complete recordings can contain fictional
  private knowledge; credentials from local connections are excluded.
- No production npm release, external human usability validation, or broad model
  evaluation is claimed. The contributor walkthrough is available for that work.

## Publishing the prepared artifact

After npm authentication is available, rerun the checks and inspect the archive,
then publish the alpha tag explicitly:

```sh
npm pack
npm publish simkind-0.2.0-alpha.1.tgz --tag alpha --access public
```

Package metadata defaults to the `alpha` tag. This does not publish Git changes or
claim API stability. Future incompatible checkpoint/host behavior must use new
versions; it must not silently reinterpret an old artifact.
