import { describe, expect, it } from 'vitest';
import {
  advanceSimkinTick,
  createSimkinRuntime,
  executeHostInputs,
  resolveModelCompletion,
} from '../src/index.js';

describe('host integration helpers', () => {
  it('reports contextual rejection and applied fallbacks explicitly', () => {
    const result = executeHostInputs(
      { energy: 1 },
      [{ amount: 2 }, { amount: 1, fallbackReason: 'timeout' }],
      {
        validate: (world, input) => input.amount <= world.energy
          ? { ok: true }
          : { ok: false, reason: 'insufficient energy' },
        apply: (world, input) => ({ energy: world.energy - input.amount }),
        fallbackReason: (input) => input.fallbackReason,
      },
    );

    expect(result.world).toEqual({ energy: 0 });
    expect(result.outcomes).toEqual([
      { status: 'rejected', reason: 'insufficient energy' },
      { status: 'fallback', reason: 'timeout' },
    ]);
  });

  it('drives the declared simkin and host phases in order', () => {
    const phases: string[] = [];
    const runtime = createSimkinRuntime<number, undefined, string>({
      recordInputs: (world) => (phases.push('record'), world),
      applyInputs: (world) => (phases.push('apply'), world + 1),
      expireRequests: (world) => (phases.push('expire'), world),
      interactions: (world) => (phases.push('interact'), world + 1),
      cognition: (world) => (phases.push('cognition'), world + 1),
    });

    const world = advanceSimkinTick(
      runtime,
      0,
      undefined,
      ['input'],
      (current) => (phases.push('host'), current + 1),
    );

    expect(world).toBe(4);
    expect(phases).toEqual(['record', 'apply', 'expire', 'interact', 'host', 'cognition']);
  });

  it('turns rejected and malformed model completions into explicit fallbacks', () => {
    const request = { id: 'r1', priority: 1, issuedAtTick: 2 };
    const fallback = (reason: string) => ({ kind: 'Wait', reason });

    expect(resolveModelCompletion(
      { status: 'fulfilled', request, input: { kind: 'Unknown' } },
      (_pending, input) => input.kind === 'Move' ? { kind: 'Move' } : undefined,
      (_pending, reason) => fallback(reason),
    )).toEqual({
      status: 'fallback',
      reason: 'invalid-output',
      input: { kind: 'Wait', reason: 'invalid-output' },
    });
    expect(resolveModelCompletion(
      { status: 'rejected', request, error: new Error('down') },
      () => ({ kind: 'Move' }),
      (_pending, reason) => fallback(reason),
    )).toMatchObject({ status: 'fallback', reason: 'provider-error' });
  });
});
