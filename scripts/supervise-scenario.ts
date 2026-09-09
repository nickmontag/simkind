import { spawn } from 'node:child_process';
import { mkdir, open, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// The supervisor owns no world state and never silently replays external effects.
const args = process.argv.slice(2);
const detached = args.includes('--detach');
if (detached) args.splice(args.indexOf('--detach'), 1);
if (args.includes('--check') || args.includes('--replay')) throw new Error('Use the ordinary scenario CLI for launch checks or replay verification.');
const outputIndex = args.indexOf('--output');
if (outputIndex >= 0 && (!args[outputIndex + 1] || args[outputIndex + 1].startsWith('--'))) throw new Error('Supply an output path.');
const output = resolve(outputIndex >= 0 ? args[outputIndex + 1] : `.internal/runs/session-${randomUUID()}`);
if (outputIndex < 0) args.push('--output', output);
await mkdir(dirname(output), { recursive: true });
const log = await open(`${output}.log`, 'a', 0o600);
if (detached) {
  const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), ...args], {
    detached: true, stdio: ['ignore', log.fd, log.fd], cwd: process.cwd(), env: process.env,
  });
  child.unref(); await log.close();
  console.log(JSON.stringify({ supervisorPid: child.pid, status: 'starting', output, log: `${output}.log`, supervision: `${output}.supervision.json` }));
} else {
  const path = `${output}.supervision.json`;
  await writeFile(path, JSON.stringify({ state: 'starting', supervisorPid: process.pid, updatedAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
  const update = async (data: object) => {
    await writeFile(`${path}.tmp`, JSON.stringify({ ...data, supervisorPid: process.pid, updatedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
    await rename(`${path}.tmp`, path);
  };
  const entry = args.includes('--recover') || args.includes('--input') ? '../examples/portable/resume.ts' : '../examples/portable/cli.ts';
  const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL(entry, import.meta.url)), ...args], { stdio: ['ignore', log.fd, log.fd], cwd: process.cwd(), env: { ...process.env, SIMKIND_SUPERVISED: '1' } });
  const forward = (signal: NodeJS.Signals) => child.kill(signal);
  const int = () => forward('SIGINT'), term = () => forward('SIGTERM');
  process.once('SIGINT', int); process.once('SIGTERM', term);
  let outcome: { code: number | null; signal: NodeJS.Signals | null };
  try {
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
    await update({ state: 'running', workerPid: child.pid, output });
    outcome = await exited;
    let report: { state?: string } | undefined;
    try { report = JSON.parse(await readFile(`${output}.report.json`, 'utf8')); } catch { /* Worker may have terminated before its first report. */ }
    const terminal = report && ['completed', 'limit-reached', 'interrupted', 'failed'].includes(report.state ?? '');
    await update({ state: terminal ? report!.state : outcome.signal ? 'interrupted' : 'failed', workerPid: child.pid, output, ...outcome,
      ...(!terminal ? { reason: 'Worker exited without a terminal report. Retain the active database; recover its last settled checkpoint into a new output path.' } : {}) });
    process.exitCode = outcome.code ?? 1;
  } catch {
    await update({ state: 'failed', output, reason: 'Worker could not be started or supervised.' }); process.exitCode = 1;
  } finally { process.removeListener('SIGINT', int); process.removeListener('SIGTERM', term); await log.close(); }
}
