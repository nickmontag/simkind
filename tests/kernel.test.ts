import { describe, expect, it } from 'vitest';
import {
  capabilityKinds,
  characterScorecard,
  conversationDirective,
  createCharacterRuntime,
  defineCapabilityCatalog,
  evaluateCommitment,
  rankMemories,
  recordDecisionBatch,
  renderCapabilityPrompt,
  replayInputsForTick,
  touchMemories,
} from '../src/index.js';

describe('living character kernel contracts', () => {
  it('keeps a typed capability catalog as the prompt source', () => {
    const catalog = defineCapabilityCatalog({
      Move: { description: 'Move.', examples: ['north'] },
      Wait: { description: 'Wait.', examples: ['one hour'] },
    });
    expect(capabilityKinds(catalog)).toEqual(['Move', 'Wait']);
    expect(renderCapabilityPrompt(catalog)).toBe([
      'LEGAL INTENTS / AVAILABLE CAPABILITIES — use only these Intent kinds:',
      '- Move: Move.',
      '  north',
      '- Wait: Wait.',
      '  one hour',
    ].join('\n'));
  });

  it('uses locale-independent memory tie breakers and touches only selected evidence', () => {
    const base = { text: 'same', importance: 1, confidence: 1, createdTick: 1, lastAccessTick: 1, about: [], tags: [], hops: 0 };
    const memories = [
      { ...base, id: 'ä' },
      { ...base, id: 'z' },
    ];
    expect(rankMemories(memories, 1).map((memory) => memory.id)).toEqual(['z', 'ä']);

    const touched = touchMemories(memories, ['ä'], 9);
    expect(touched.map((memory) => memory.lastAccessTick)).toEqual([9, 1]);
    expect(memories.map((memory) => memory.lastAccessTick)).toEqual([1, 1]);
  });

  it('ranks relevant memory evidence deterministically', () => {
    const base = { importance: 2, confidence: 1, createdTick: 1, lastAccessTick: 1, about: ['Mira'], tags: ['promise'], hops: 0 };
    const ranked = rankMemories([
      { ...base, id: 'later-id', text: 'Mira mentioned rain' },
      { ...base, id: 'mint', text: 'Mira needs mint' },
    ], 2, { text: 'bring mint to Mira', about: 'Mira' });
    expect(ranked.map((memory) => memory.id)).toEqual(['mint', 'later-id']);
  });

  it('completes commitments from host evidence', () => {
    const progress = evaluateCommitment(
      { id: 'mint', criteria: [{ kind: 'inventory', typeId: 'mint', qty: 2 }] },
      {
        memory: () => ({ matched: 0, evidence: [] }),
        event: () => ({ matched: 0, evidence: [] }),
        inventory: () => ({ matched: 2, evidence: ['inventory:mint:2'] }),
        relationship: () => ({ matched: 0, evidence: [] }),
      },
    );
    expect(progress).toEqual({ met: 1, total: 1, complete: true, evidence: ['inventory:mint:2'] });
  });

  it('does not complete an inventory criterion below its required quantity', () => {
    const adapter = {
      memory: () => ({ matched: 0, evidence: [] }),
      event: () => ({ matched: 0, evidence: [] }),
      inventory: () => ({ matched: 1, evidence: ['inventory:mint:1'] }),
      relationship: () => ({ matched: 0, evidence: [] }),
    };
    expect(evaluateCommitment(
      { id: 'mint', criteria: [{ kind: 'inventory', typeId: 'mint', qty: 2 }] },
      adapter,
    )).toEqual({ met: 0, total: 1, complete: false, evidence: [] });
  });

  it('records and replays same-tick decisions in exact order', () => {
    let records = recordDecisionBatch<string>([], 8, ['a']);
    records = recordDecisionBatch(records, 8, ['b', 'c']);
    expect(records.map((record) => record.id)).toEqual([
      'decision:00000008:000', 'decision:00000008:001', 'decision:00000008:002',
    ]);
    expect(replayInputsForTick(records, 8)).toEqual(['a', 'b', 'c']);
  });

  it('continues after the greatest persisted order without ID collisions', () => {
    const records = recordDecisionBatch([
      { id: 'decision:00000008:004', appliedTick: 8, order: 4, input: 'a' },
    ], 8, ['b']);
    expect(records.map((record) => record.id)).toEqual([
      'decision:00000008:004', 'decision:00000008:005',
    ]);
  });

  it('rejects ambiguous persisted order and returns defensive replay copies', () => {
    const duplicateOrder = [
      { id: 'a', appliedTick: 8, order: 0, input: { value: 'a' } },
      { id: 'b', appliedTick: 8, order: 0, input: { value: 'b' } },
    ];
    expect(() => replayInputsForTick(duplicateOrder, 8)).toThrow(/duplicate decision order/i);

    const records = recordDecisionBatch([], 8, [{ value: 'original' }]);
    const replayed = replayInputsForTick(records, 8);
    replayed[0].value = 'changed';
    expect(records[0].input.value).toBe('original');
  });

  it('snapshots serializable decision values at record time', () => {
    const input = { kind: 'Move', target: { x: 1 } };
    const request = { prompt: ['original'] };
    const records = recordDecisionBatch([], 3, [input], () => request);
    input.target.x = 9;
    request.prompt[0] = 'mutated';
    expect(records[0].input).toEqual({ kind: 'Move', target: { x: 1 } });
    expect(records[0].request).toEqual({ prompt: ['original'] });
  });

  it('keeps conversation closure procedural', () => {
    expect(conversationDirective(
      { id: 'c', messageCount: 4, silentTurns: 0, lastUtteranceHour: 1, pending: false },
      { maxMessages: 4, maxSilentTurns: 2, awkwardTimeoutHours: 1, utteranceIntervalHours: 0.1 },
      { nowHour: 1.2, participantsTogether: true },
    )).toEqual({ kind: 'close', reason: 'said their piece' });
  });

  it('orchestrates only the declared lifecycle phases', () => {
    const calls: string[] = [];
    const runtime = createCharacterRuntime<number, undefined, string>({
      recordInputs: (world) => (calls.push('record'), world),
      applyInputs: (world) => (calls.push('apply'), world),
      expireRequests: (world) => (calls.push('expire'), world),
      interactions: (world) => (calls.push('interactions'), world),
      cognition: (world) => (calls.push('cognition'), world),
    });
    let world = runtime.applyInputs(0, undefined, ['decision']);
    world = runtime.advanceInteractions(world, undefined);
    runtime.advanceCognition(world, undefined);
    expect(calls).toEqual(['record', 'apply', 'expire', 'interactions', 'cognition']);
  });

  it('preserves instance binding for class-based runtime adapters', () => {
    class Adapter {
      readonly delta = 2;
      recordInputs(world: number): number { return world; }
      applyInputs(world: number): number { return world; }
      expireRequests(world: number): number { return world; }
      interactions(world: number): number { return world + this.delta; }
      cognition(world: number): number { return world + this.delta; }
    }
    const runtime = createCharacterRuntime<number, undefined, never>(new Adapter());
    expect(runtime.advanceInteractions(1, undefined)).toBe(3);
    expect(runtime.advanceCognition(1, undefined)).toBe(3);
  });

  it('builds deterministic evaluation counters', () => {
    expect(characterScorecard(
      [['Speak', 'Move'], ['Speak']],
      [{ type: 'plan', subtype: 'PLAN_INVALID' }, { type: 'model', subtype: 'LLM_FALLBACK' }],
    )).toEqual({
      decisions: 2,
      invalidPlans: 1,
      fallbacks: 1,
      capabilityKindsUsed: { Move: 1, Speak: 2 },
    });
  });
});
