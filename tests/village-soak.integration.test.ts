import { describe, expect, it } from 'vitest';
import { runVillageSoak } from '../examples/village-soak.js';

describe('village soak scenario', () => {
  it('sustains two simkins through latency, conflict, memory, reload, and replay', async () => {
    const result = await runVillageSoak();

    expect(result.report).toMatchObject({
      ticks: 30,
      goals: {
        ayaPromiseComplete: true,
        ayaPersonalMintGoalComplete: false,
        miraTeaGoalComplete: true,
      },
      goalCompletionTicks: { ayaPromise: 13, miraTea: 16 },
      conversationMemoriesCreated: 1,
      replayMatched: true,
      reloadMatched: true,
      pendingRequestsAtEnd: 0,
    });
    expect(result.report.memoryInfluencedDecisions).toBeGreaterThanOrEqual(1);
    expect(result.report.rejected).toBeGreaterThanOrEqual(2);
    expect(result.report.fallbacks).toBeGreaterThanOrEqual(1);
    expect(result.report.timeouts).toBeGreaterThanOrEqual(1);
    expect(result.report.lateCompletionsRejected).toBeGreaterThanOrEqual(1);
    expect(result.report.maxPendingRequests).toBeLessThanOrEqual(2);
    expect(result.report.persistedBytes).toBeGreaterThan(0);
    expect(result.report.pendingRequestsAtSave).toBeGreaterThan(0);
  });
});
