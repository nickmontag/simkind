import { emitKeypressEvents } from 'node:readline';
import { createSettlement, settlementReport } from './engine.js';
import { createSettlementOpenRouterProvider } from './openrouter.js';
import { advanceSettlement, runSettlement } from './provider.js';
import { renderSettlement } from './render.js';
import { scriptedProvider } from './scripted.js';
import type { SettlementProvider } from './types.js';

const args = new Set(process.argv.slice(2));
const runIndex = process.argv.indexOf('--run');
const requestedTicks = runIndex >= 0 ? Number(process.argv[runIndex + 1]) : undefined;
const provider: SettlementProvider = args.has('--live')
  ? await createSettlementOpenRouterProvider()
  : scriptedProvider;

let state = createSettlement();

if (requestedTicks !== undefined) {
  if (!Number.isSafeInteger(requestedTicks) || requestedTicks < 0) throw new Error('--run requires a non-negative integer');
  state = await runSettlement(state, provider, requestedTicks);
  console.log(JSON.stringify({ provider: provider.name, report: settlementReport(state), usage: provider.usage, events: state.recentEvents }, null, 2));
} else {
  if (!process.stdin.isTTY) throw new Error('Interactive mode needs a TTY; use --run 30 for non-interactive mode');
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let running = false;

  function render(): void {
    console.clear();
    console.log(renderSettlement(state, provider));
  }

  async function advance(count: number): Promise<void> {
    if (running) return;
    running = true;
    try {
      const target = Math.min(30, state.tick + count);
      while (state.tick < target) {
        state = await advanceSettlement(state, provider);
        render();
      }
    } finally {
      running = false;
    }
  }

  process.stdin.on('keypress', (_text, key) => {
    if (key.ctrl && key.name === 'c' || key.name === 'q') {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      return;
    }
    if (key.name === 'n') void advance(1);
    if (key.name === 'r') void advance(5);
    if (key.name === 'a') void advance(30 - state.tick);
  });
  render();
}
