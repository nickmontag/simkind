import { describe, expect, it } from 'vitest';
import {
  conversationDirective,
  createCharacterRuntime,
  defineCapabilityCatalog,
  evaluateCommitment,
  rankMemories,
  recordDecisionBatch,
  replayInputsForTick,
} from '../src/index.js';

describe('living character kernel contracts', () => {
  it('keeps a typed capability catalog as the prompt source', () => {
    const catalog = defineCapabilityCatalog({
      Move: { description: 'Move.', examples: ['north'] },
      Wait: { description: 'Wait.', examples: ['one hour'] },
    });
    expect(Object.keys(catalog)).toEqual(['Move', 'Wait']);
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

  it('records and replays same-tick decisions in exact order', () => {
    let records = recordDecisionBatch<string>([], 8, ['a']);
    records = recordDecisionBatch(records, 8, ['b', 'c']);
    expect(records.map((record) => record.id)).toEqual([
      'decision:00000008:000', 'decision:00000008:001', 'decision:00000008:002',
    ]);
    expect(replayInputsForTick(records, 8)).toEqual(['a', 'b', 'c']);
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
});
