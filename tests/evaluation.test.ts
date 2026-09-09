import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it.each([
  ['HTTP 400', 'new Response("incompatible schema", {status:400})'],
  ['HTTP 429', 'new Response("rate limited", {status:429})'],
  ['HTTP 429', 'Response.json({error:{code:429}})'],
  ['Provider failure', 'Promise.reject(new Error("offline"))'],
])('stops a live evaluation on %s and preserves its report and archive', (message, response) => {
  const output = mkdtempSync(join(tmpdir(), 'simkind-evaluation-'));
  try {
    const mock = 'data:text/javascript,' + encodeURIComponent(`globalThis.fetch = async () => ${response};`);
    expect(() => execFileSync(process.execPath, ['--import', 'tsx', '--import', mock,
      'scripts/evaluate-long-memory.ts', '--phase', 'memory', '--model', 'fixture/incompatible',
      '--max-calls', '60', '--output', output], {
      env: { ...process.env, OPENROUTER_API_KEY: 'fixture-not-a-secret' }, stdio: 'pipe', timeout: 20000,
    })).toThrow();
    const report = JSON.parse(readFileSync(join(output, 'memory-report.json'), 'utf8'));
    expect(report.failure).toContain(message);
    expect(report.completedHistory).toBe(false);
    expect(report.stopReason).toBe('failure');
    expect(report.globalCallsUsed).toBeGreaterThan(0);
    expect(report.globalCallsUsed).toBeLessThanOrEqual(2);
    expect(report.turns).toBeLessThan(100);
    expect(report.errors).toHaveLength(report.globalCallsUsed);
    expect(report.resumable).toBe(true);
    expect(readFileSync(join(output, report.recording, 'run.json'), 'utf8')).toContain('run:');
  } finally { rmSync(output, { recursive: true, force: true }); }
}, 30000);


it('reports a local call budget stop without contacting a provider', () => {
  const output = mkdtempSync(join(tmpdir(), 'simkind-budget-'));
  try {
    const mock = 'data:text/javascript,' + encodeURIComponent('globalThis.fetch = async () => { throw new Error("must not call"); };');
    execFileSync(process.execPath, ['--import', 'tsx', '--import', mock,
      'scripts/evaluate-long-memory.ts', '--phase', 'memory', '--model', 'fixture/budget',
      '--max-calls', '1', '--output', output], {
      env: { ...process.env, OPENROUTER_API_KEY: 'fixture-not-a-secret' }, stdio: 'pipe', timeout: 20000,
    });
    const report = JSON.parse(readFileSync(join(output, 'memory-report.json'), 'utf8'));
    expect(report.stopReason).toBe('call-budget');
    expect(report.globalCallsUsed).toBe(0);
    expect(report.errors).toEqual([]);
  } finally { rmSync(output, { recursive: true, force: true }); }
}, 30000);
