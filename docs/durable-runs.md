# Durable and supervised runs

The browser is convenient for stepping and playback. For unattended turn-based
sessions, run the scenario in a separate worker supervised independently of the
browser. The worker checkpoints settled turns and writes a report throughout the
run. The supervisor detects worker termination, including a hard kill.

From a checkout, with an explicit model and credentials configured:

```sh
npm run scenario:supervise -- --detach \
  --scenario fabrication-shop.json --config config-fabrication.json \
  --structured-outputs --output .internal/runs/shop-session
```

Use a new output path for every run. Add `--fixture` for a no-action mechanical
test without paid calls. Omit `--detach` to keep the supervisor in the foreground.
Use a configuration enabling `simkind.context` and `simkind.continuity`, such as
`config-fabrication.json` or `config-economy-memory.json`; this workflow requires
SQLite archive checkpoints, not the legacy in-memory recording path.

The detached command prints the supervisor PID and file paths. It does not mean
the simulation has already completed. Inspect these files:

| Output | What it tells you |
| --- | --- |
| `<output>.supervision.json` | Supervisor and worker PIDs, process status, exit code or signal |
| `<output>.report.json` | Latest runner status, checkpoint, observed usage, error count, and terminal world state |
| `<output>.log` | Launch configuration, worker output, and startup errors |
| `<output>.active.sqlite` | Durable evidence and settled recovery checkpoints |
| `<output>/` | Frozen archive exported on normal completion or a handled interruption |

The report refreshes approximately every second and at turn boundaries. Its states
are `running`, `completed`, `limit-reached`, `interrupted`, and `failed`.
`completed` requires the host's explicit completion signal. A configured horizon
or request ceiling produces `limit-reached`; it does not establish story success.
`usage` sums provider-reported values available in recorded outcomes. Missing
usage, especially after timeouts, is unknown rather than zero-cost execution.

Successful provider outcomes can retain provider routing, generation ID, finish
reason, cached input, and reasoning-token counts when returned by the transport.
Runner evidence labels maintenance and decision stages. Live CLI/playground runs
enable wall-clock timing diagnostics; embeddings opt in with
`{ storage, recordTimings: true }`. Timings are off by default to keep deterministic
event comparisons stable. These diagnostics do not include credentials or arbitrary
response headers, and provider metadata is not guaranteed on every outcome.

For a graceful stop, send `SIGTERM` to the printed supervisor PID (or Ctrl-C in
foreground mode). It forwards the signal to the worker, which stops dispatch,
requests provider cancellation, and writes interruption evidence before export.
If the worker cannot reach a settled boundary, the final archive is explicitly
evidence-only. Already committed effects are not undone.

If the worker is killed, its own report may still say `running`. The supervisor's
terminal record identifies the interruption; use the last settled checkpoint.
Killing both processes or losing power can leave only a stale heartbeat. This is a
local supervisor, not a system service that automatically restarts after reboot.
It does not silently restart paid calls or replay external effects.

## Recover into a new continuation

For a stopped worker with an active SQLite file:

```sh
npm run scenario:supervise -- --detach --recover --branch \
  --input .internal/runs/shop-session.active.sqlite \
  --output .internal/runs/shop-recovered
```

For a normal saved archive, use `--input <archive-directory>` and omit `--recover`.
Add `--fixture` when resuming fixture recordings. Resume uses the original model
identity and exact installed host implementation; the current environment supplies
credentials. It does not change limits or extend a run that already reached its
horizon. You can also use `npm run scenario:resume` without the supervisor.

Recovery copies the source and rewinds the copy to its last settled checkpoint.
Original evidence remains intact. Work after that boundary is retained in the
source trace but is not part of the recovered world. Simulated hosts can support
this rollback; external systems require their own reconciliation and idempotency.

Open the exported recording through the saved-run/archive APIs for playback and
inspection. The standalone worker is not automatically attached to the playground's
live turn controls; its report and log are the live monitoring surfaces.
See [checkpoints](checkpoints.md) and [long-run memory](long-run-memory.md) for archive
verification, branch isolation, and evidence-only playback.

## Embed the same lifecycle

`runDurably(runner, storage, output, { signal, heartbeatMs })` is exported from
`simkind/node`. It is a turn-based execution helper: it steps and settles decisions,
checkpoints when safe, emits reports, and exports the final archive. Supply a
checkpoint-capable host, a runner with the context profile, and its SQLite storage.
The caller owns that storage and must keep it open until outstanding provider
callbacks settle. Realtime hosts should use their own stepping policy instead.
