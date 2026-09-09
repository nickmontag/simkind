import { canonicalJson, compileDataSchema, validateDocument, type CharacterState, type Intention, type Memory, type Observation, type ToolDescriptor } from '../format/index.js';

/** Opt-in experience retention and self-authored state. Never establishes world facts. */
export const continuityProfile = { id: 'simkind.continuity', version: '0.1.0', defaults: { enabled: true, config: {} } } as const;
export const continuityConfigSchema = { type: 'object', additionalProperties: false, properties: {} };
export const reviseTool: ToolDescriptor = {
  id: 'simkind.revise', version: '1.0.0',
  description: 'Optionally revise your intentions or record an interpretation. These are your self-reports, not world actions or verified agreements. Use the current stateRevision. An empty intentions array abandons all intentions; omitted intentions preserves them. Cite only memory IDs supplied to you.',
  inputSchema: { type: 'object', additionalProperties: false, required: ['expectedRevision'], properties: {
    expectedRevision: { type: 'integer', minimum: 0 },
    intentions: { type: 'array', maxItems: 32, items: { type: 'object', additionalProperties: false, required: ['id', 'description'], properties: { id: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' }, description: { type: 'string', maxLength: 4000 } } } },
    interpretation: { type: 'string', minLength: 1, maxLength: 8000 },
    evidence: { type: 'array', uniqueItems: true, maxItems: 32, items: { type: 'string' } },
    supersedes: { description: 'IDs of supplied interpretation memories replaced by this interpretation. Never intention, goal, observation, or action IDs. Revise intentions using the intentions field.', type: 'array', uniqueItems: true, maxItems: 32, items: { type: 'string' } },
  } }, lifecycle: { asynchronous: false, cancellable: false },
};
/** Model decisions omit bookkeeping; legacy explicit values must match the frozen request. */
export function decisionReviseTool(revision: number, evidenceIds: string[]): ToolDescriptor {
  const tool = structuredClone(reviseTool);
  tool.description = 'Optionally revise your intentions or record an interpretation. These are self-reports, not world facts or agreements. The runner attaches the character revision from this request; omit expectedRevision. Omitted intentions preserves them; [] abandons them. Cite only supplied memories.';
  const schema = tool.inputSchema as { required: string[]; properties: Record<string, unknown> };
  schema.required = [];
  schema.properties.expectedRevision = { type: 'integer', const: revision };
  schema.properties.evidence = { type: 'array', uniqueItems: true, maxItems: 32, items: evidenceIds.length ? { type: 'string', enum: evidenceIds } : false };
  return tool;
}

export interface StateEdit { expectedRevision: number; intentions?: Intention[]; interpretation?: string; evidence?: string[]; supersedes?: string[] }
const validateEdit = compileDataSchema(reviseTool.inputSchema);

/** Pure transaction: callers commit the returned state only after validation succeeds. */
export function reviseState(state: CharacterState, edit: StateEdit, origin: string, id: string, visibleMemoryIds = (state.context.memories ?? []).map(m => m.id)): CharacterState {
  if (validateEdit(edit).length) throw new Error('Invalid state edit.');
  if (edit.expectedRevision !== state.revision) throw new Error('Stale character state revision.');
  if (edit.intentions === undefined && edit.interpretation === undefined) throw new Error('Supply an intention revision or interpretation.');
  const memories = state.context.memories ?? [];
  if ((edit.evidence ?? []).some(ref => !visibleMemoryIds.includes(ref))) throw new Error('evidence must reference only supplied memory IDs.');
  if ((edit.supersedes ?? []).some(ref => !visibleMemoryIds.includes(ref))) throw new Error('supersedes must reference supplied interpretation-memory IDs, not intention or goal IDs. Use intentions to revise intentions.');
  if ((edit.supersedes ?? []).some(ref => memories.find(m => m.id === ref)?.source.kind !== 'interpretation')) throw new Error('Only interpretations can be superseded; observations remain evidence.');
  const next = structuredClone(state);
  if (edit.intentions !== undefined) next.context.intentions = structuredClone(edit.intentions);
  if (edit.interpretation !== undefined) {
    const memory: Memory = { id, text: edit.interpretation, source: { kind: 'interpretation', origin },
      eventRefs: (edit.evidence ?? []).flatMap(ref => {
        const evidence = memories.find(m => m.id === ref)!;
        return evidence.eventRefs?.length ? structuredClone(evidence.eventRefs) : [{ id: ref, origin: evidence.source.origin ?? 'authored', resolution: 'recorded' as const }];
      }), supersedes: edit.supersedes ?? [] };
    next.context.memories = [...(next.context.memories ?? []), memory];
  }
  next.revision++;
  const valid = validateDocument(next);
  if (!valid.ok) throw new Error('State edit violates the character document contract.');
  return next;
}

/** Retains delivered content exactly, including capture/delivery times and uncertainty. */
export function retainObservation(state: CharacterState, observation: Observation): boolean {
  if (state.instanceId !== observation.recipient) throw new Error('Mismatched observation recipient.');
  const id = `experience:${state.revision}`;
  const text = canonicalJson(observation);
  const existing = state.context.memories?.find(m => m.eventRefs?.some(ref => ref.id === observation.id && ref.origin === observation.runId) && m.source.kind === 'observation');
  if (existing) {
    if (existing.text !== text) throw new Error('Conflicting observation redelivery.');
    return false;
  }
  // IDs must remain distinct even when an authored memory uses the reserved namespace.
  if (state.context.memories?.some(m => m.id === id)) throw new Error('Experience ID collision.');
  const memory: Memory = { id, text, source: { kind: 'observation', origin: observation.runId },
    formedAt: structuredClone(observation.deliveredAt), aboutTime: structuredClone(observation.capturedAt),
    eventRefs: [{ id: observation.id, origin: observation.runId, resolution: 'recorded' }] };
  state.context.memories = [...(state.context.memories ?? []), memory];
  state.revision++;
  return true;
}

/** Recency profile for continuity-enabled characters; superseded beliefs remain exportable. */
export function selectContinuityMemories(memories: readonly Memory[], maxItems: number): Memory[] {
  if (maxItems === 0) return [];
  const superseded = new Set(memories.flatMap(m => m.supersedes ?? []));
  return structuredClone(memories.filter(m => !superseded.has(m.id)).slice(-maxItems));
}
