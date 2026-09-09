import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('stops a live evaluation on an incompatible transport and preserves its report and archive', () => {
  const output = mkdtempSync(join(tmpdir(), 'simkind-evaluation-'));
  try {
    const mock = 'data:text/javascript,' + encodeURIComponent('globalThis.fetch = async () => new Response("incompatible schema", {status:400});');
    expect(() => execFileSync(process.execPath, ['--import', 'tsx', '--import', mock,
      'scripts/evaluate-long-memory.ts', '--phase', 'memory', '--model', 'fixture/incompatible',
      '--max-calls', '60', '--output', output], {
      env: { ...process.env, OPENROUTER_API_KEY: 'fixture-not-a-secret' }, stdio: 'pipe', timeout: 20000,
    })).toThrow();
    const report = JSON.parse(readFileSync(join(output, 'memory-report.json'), 'utf8'));
    expect(report.failure).toContain('HTTP 400');
    expect(report.globalCallsUsed).toBeGreaterThan(0);
    expect(report.globalCallsUsed).toBeLessThanOrEqual(2);
    expect(report.turns).toBeLessThan(100);
    expect(report.errors).toHaveLength(report.globalCallsUsed);
    expect(report.resumable).toBe(true);
    expect(readFileSync(join(output, report.recording, 'run.json'), 'utf8')).toContain('run:');
  } finally { rmSync(output, { recursive: true, force: true }); }
}, 30000);
