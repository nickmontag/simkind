import type { Memory, ActionEvent, ActionProposal, TimePoint } from '../format/index.js';

/** Describes provenance and lifecycle, never whether a model's interpretation is true. */
export interface MemoryEvidence {
  memoryId: string;
  kind: Memory['source']['kind'] | 'action-proposal' | 'action-receipt' | 'dialogue' | 'narrative' | 'receipt';
  authority?: 'host' | 'statement' | 'interpretation';
  actor?: string;
  actionId?: string;
  toolId?: string;
  status?: ActionEvent['status'];
  time?: TimePoint;
  sourceIds?: string[];
}
export function memoryEvidence(memory: Memory): MemoryEvidence {
  const result: MemoryEvidence = { memoryId: memory.id, kind: memory.source.kind };
  if (memory.source.kind === 'interpretation') result.sourceIds = memory.eventRefs?.map(ref => ref.id) ?? [];
  if (memory.source.kind === 'observation') {
    try {
      const observation = JSON.parse(memory.text) as { content?: { schemaId?: string; data?: { kind: MemoryEvidence['kind']; authority: MemoryEvidence['authority']; actor?: string; references?: string[] } }[] };
      const event = observation.content?.find(part => part.schemaId === 'simkind.perceived-event:1.0.0')?.data;
      if (event) return { ...result, kind: event.kind, authority: event.authority, actor: event.actor, sourceIds: event.references };
    } catch { /* Legacy observation text remains original evidence. */ }
  }
  if (memory.source.kind !== 'report') return result;
  try {
    const value = JSON.parse(memory.text) as { type?: string; action?: ActionProposal } & ActionEvent;
    if (value.type === 'proposal') return { ...result, kind: 'action-proposal', actionId: value.id, toolId: (value as unknown as ActionProposal).toolId };
    if (value.type === 'action') return { ...result, kind: 'action-receipt', actionId: value.actionId, toolId: value.action?.toolId, status: value.status, time: value.time };
  } catch { /* Imported reports may be plain text. Their source remains a report. */ }
  return result;
}
