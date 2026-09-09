import { mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { CharacterRunner } from './runner.js';
import type { SqliteRunnerStorage } from './sqlite-storage.js';
import { saveArchivedRun } from './archived-run.js';
import type { JsonValue } from '../format/index.js';
import type { ProviderUsage } from './contracts.js';

export interface SessionReport {
  version: 'simkind.session/1.0.0';
  runId: string;
  state: 'running' | 'completed' | 'limit-reached' | 'interrupted' | 'failed';
  reason?: string;
  updatedAt: string;
  status: ReturnType<CharacterRunner['status']>;
  latestCheckpoint?: string;
  world?: JsonValue;
  events: number;
  errors: number;
  usage: ProviderUsage;
  archive?: { directory: string; resumable: boolean };
}
export async function writeSessionReport(path: string, report: SessionReport): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  await rename(temporary, path);
}

/** Browser-independent execution, durable checkpoints, and terminal evidence on ordinary interruptions.
 * A process supervisor must detect hard termination; no process can catch SIGKILL or power loss.
 * Storage belongs to the caller and must remain open until outstanding providers settle.
 */
export async function runDurably(runner: CharacterRunner, storage: SqliteRunnerStorage, directory: string,
  options: { signal?: AbortSignal; heartbeatMs?: number } = {}): Promise<SessionReport> {
  await mkdir(dirname(directory), { recursive: true });
  const path = `${directory}.report.json`;
  let report: SessionReport = { version: 'simkind.session/1.0.0', runId: runner.manifest().runId,
    state: 'running', updatedAt: new Date().toISOString(), status: runner.status(), events: 0, errors: 0, usage: {} };
  await writeFile(path, JSON.stringify(report), { flag: 'wx', mode: 0o600 });
  let writes = Promise.resolve();
  const update = () => {
    for (;;) {
      const events = runner.events(report.events, 256);
      for (const event of events) {
        const data = event.data as { usage?: ProviderUsage; phase?: string };
        if (['model-error', 'model-timeout'].includes(event.type) || event.type === 'memory-retrieval' && ['failed', 'timeout'].includes(data.phase ?? '')) report.errors++;
        for (const key of ['inputTokens', 'outputTokens', 'cachedInputTokens', 'reasoningTokens', 'cost'] as const) {
          const value = data.usage?.[key];
          if (typeof value === 'number' && Number.isFinite(value) && value >= 0) report.usage[key] = (report.usage[key] ?? 0) + value;
        }
      }
      report.events += events.length;
      if (events.length < 256) break;
    }
    report.status = runner.status(); report.updatedAt = new Date().toISOString();
    report.latestCheckpoint = storage.get<string>('runner', 'latestCheckpoint');
    const snapshot = structuredClone(report);
    writes = writes.then(() => writeSessionReport(path, snapshot));
    return writes;
  };
  const interrupt = () => runner.stop();
  options.signal?.addEventListener('abort', interrupt, { once: true });
  let heartbeatFailure = false;
  const timer = setInterval(() => { void update().catch(() => { heartbeatFailure = true; runner.stop(); }); }, Math.max(100, options.heartbeatMs ?? 1000));
  try {
    if (options.signal?.aborted) interrupt();
    if (!runner.status().stopped && !runner.status().unresolvedActions && !runner.status().activeProviders && !runner.status().pendingRequests) runner.checkpoint();
    runner.pauseDispatch(false);
    while (!runner.status().stopped && !runner.status().completed && runner.status().steps < runner.launchSnapshot().config.limits.maxSteps) {
      runner.step(); await runner.settleDecisions();
      await runner.drainProviders(1000);
      const status = runner.status();
      if (Object.keys(status.contextFailures ?? {}).length) { report.state = 'failed'; report.reason = 'Character context or opportunity capacity failed.'; break; }
      if (!status.stopped && !status.unresolvedActions && !status.pendingRequests && !status.activeProviders) runner.checkpoint();
      await update();
      if (status.opportunityLimitReached) { report.state = 'limit-reached'; report.reason = 'Per-character decision opportunity limit reached; successful decisions are not implied.'; break; }
      if (status.requests >= runner.launchSnapshot().config.limits.maxRequests) { report.state = 'limit-reached'; report.reason = 'Request budget reached.'; break; }
    }
    if (report.state === 'running') {
      report.state = heartbeatFailure ? 'failed' : runner.status().stopped ? 'interrupted' : runner.status().completed ? 'completed' : 'limit-reached';
      if (report.state === 'limit-reached') report.reason = 'Configured step horizon reached; scenario completion is not implied.';
    }
  } catch {
    report.state = 'failed'; report.reason = 'Host execution or protocol validation failed.'; runner.stop();
  } finally {
    clearInterval(timer); options.signal?.removeEventListener('abort', interrupt);
    await writes.catch(() => {}); writes = Promise.resolve();
    // Persist the outcome before exporting so a failed export cannot erase the report.
    report.world = runner.inspect().host;
    await update();
    try {
      const archived = await saveArchivedRun(directory, runner, runner.launchSnapshot().bundle, storage);
      report.archive = { directory, resumable: archived.resumable };
    } catch { report.state = 'failed'; report.reason = 'Archive export failed; active database and checkpoint remain available.'; }
    await update();
  }
  return report;
}
