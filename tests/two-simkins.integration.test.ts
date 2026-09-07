import { describe, expect, it } from 'vitest';
import { runTwoSimkinScenario } from '../examples/two-simkins.js';

describe('two-simkin scenario', () => {
  it('completes Aya’s promise to Mira and replays to the same state', async () => {
    const result = await runTwoSimkinScenario();

    expect(result.summary).toMatchObject({
      ticks: 4,
      aya: { place: 'square', mint: 0, commitmentComplete: true },
      mira: { place: 'square', mint: 1 },
      replayMatched: true,
    });
  });

  it('turns malformed output and provider failure into recorded fallbacks', async () => {
    const result = await runTwoSimkinScenario();

    expect(result.summary).toMatchObject({ invalidPlans: 1, fallbacks: 2 });
    expect(result.decisions.filter((decision) => decision.input.fallback !== undefined)).toHaveLength(2);
  });
});
