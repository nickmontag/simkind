/** Two independent short runs per situation; measures evidence, not a preferred story. */
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const { values } = parseArgs({ options: {
  'response-mode': { type: 'string', default: 'schema' }, output: { type: 'string' }, model: { type: 'string' }, fixture: { type: 'boolean', default: false },
} });
if (!values.output || (!values.fixture && !values.model)) throw new Error('Supply a new --output directory and explicit --model, or --fixture.');
if (!['schema', 'json', 'text'].includes(values['response-mode']!)) throw new Error('Use schema, json, or text response mode.');
const output = resolve(values.output);
await mkdir(output, { recursive: true });
const manifest = { model: values.fixture ? 'fixture:no-action-v1' : values.model, responseMode: values['response-mode'], repeats: 2, turns: 8, decisionOpportunitiesPerActor: 8, maxRequestsPerRun: 28,
  maximumCalls: values.fixture ? 0 : 168, scenarios: ['friendship-repair', 'infrastructure-recovery', 'leadership-contest'] };
await writeFile(resolve(output, 'plan.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
const reports: unknown[] = [];
async function run(scenario: string, repeat: number) {
  const path = resolve(output, `${scenario}-${repeat}`);
  const args = ['--import', 'tsx', fileURLToPath(new URL('./supervise-scenario.ts', import.meta.url)),
    '--scenario', `${scenario}.json`, '--config', 'config-behavior-evaluation.json', '--output', path,
    ...(values.fixture ? ['--fixture'] : ['--response-mode', values['response-mode']!])];
  const code = await new Promise<number | null>((done, reject) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit', env: { ...process.env, ...(values.model ? { OPENROUTER_MODEL: values.model } : {}) } });
    child.once('error', reject); child.once('exit', done);
  });
  const report = JSON.parse(await readFile(`${path}.report.json`, 'utf8'));
  console.log(JSON.stringify({ scenario, repeat, state: report.state, steps: report.status.steps, requests: report.status.requests, errors: report.errors, usage: report.usage }));
  // Preserve a failed trial and continue the independent situations; never retry it.
  if (code !== 0) process.exitCode = 1;
  return { scenario, repeat, code, ...report };
}

for (const scenario of manifest.scenarios) {
  reports.push(...await Promise.all([run(scenario, 1), run(scenario, 2)]));
  await writeFile(resolve(output, 'reports.json'), JSON.stringify(reports, null, 2));
}
