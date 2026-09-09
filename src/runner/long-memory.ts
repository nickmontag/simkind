import { canonicalJson, compileDataSchema, type Memory, type ToolDescriptor, type CharacterState } from '../format/index.js';
import { memoryEvidence } from './evidence.js';
import type { DecisionContext } from './contracts.js';
import { searchTerms, type RunnerStorage, type StoredEntry } from './storage.js';
import type { MemoryPolicy, MemoryQuery, MemoryReference, MemoryRecord, MemorySelection, MemoryVector, MemoryView, WorkingConcern } from './memory-policy.js';

export const contextProfile = { id: 'simkind.context', version: '0.1.0', defaults: { enabled: true, config: {
  recentTurns: 4, batchRecords: 24, batchTurns: 8, maxContextChars: 128000, maxBatchChars: 48000,
  maxSummaryChars: 6000, maxRecallChars: 24000, maxInternalCalls: 4,
} } } as const;
export type ContextSettings = { [K in keyof typeof contextProfile.defaults.config]: number } & { maintenanceTimeoutMs?: number; maxAutomaticRecallChars?: number; retrievalTimeoutMs?: number };
export const contextConfigSchema = { type: 'object', additionalProperties: false, properties: Object.fromEntries(
  [...Object.keys(contextProfile.defaults.config), 'maintenanceTimeoutMs', 'maxAutomaticRecallChars', 'retrievalTimeoutMs'].map(key => [key, { type: 'integer', minimum: ['maintenanceTimeoutMs', 'maxAutomaticRecallChars'].includes(key) ? 0 : 1, maximum: ['maintenanceTimeoutMs', 'retrievalTimeoutMs'].includes(key) ? 300000 : key.endsWith('Chars') ? 1000000 : 1000 }])) };
export interface MemoryHead { version: number; cursor: number; summary: string; concerns?: WorkingConcern[] }
export interface MemoryCutoff { evidence: number; episodes: number; head: MemoryHead }
export interface ConsolidationBatch { baseVersion: number; through: number; records: StoredEntry<Memory>[] }
export interface Consolidation { summary: string; concerns?: WorkingConcern[]; episodes: { text: string; evidenceIds: string[] }[] }

export const recallTool: ToolDescriptor = { id: 'simkind.recall', version: '1.0.0',
  description: 'Read your own older experiences before choosing a world action. Retrieved interpretations are accompanied by their accessible original evidence when it fits the recall allowance; request source IDs directly for exact verification. Search by words, participants, or an approximate time range; or request exact supplied evidence IDs. Recall does not consume a world action. You can search again with different terms. Claims remain claims.',
  inputSchema: { type: 'object', additionalProperties: false, properties: { query: { type: 'string', maxLength: 2000 }, ids: { type: 'array', maxItems: 12, items: { type: 'string' } }, fromTurn: { type: 'integer', minimum: 0 }, toTurn: { type: 'integer', minimum: 0 } } }, lifecycle: { asynchronous: false, cancellable: false } };
export const compactTool: ToolDescriptor = { id: 'simkind.compact', version: '1.0.0',
  description: 'Consolidate supplied experiences into independent episodes and a concise working summary. Preserve who did or proposed what to whom, direction, exact significant terms, conditions, corrections and uncertainty. Separate intentions, statements, accepted commitments and completed effects. When a batch ends before an outcome, leave it unresolved; do not infer the outcome or its properties. Preserve personal feelings as that person’s interpretation. evidenceIds must use top-level supplied memory IDs, not IDs inside their text. Do not change goals or invent events. Older episodes remain searchable; the summary need not repeat your entire life.',
  inputSchema: { type: 'object', additionalProperties: false, required: ['summary', 'episodes'], properties: {
    summary: { type: 'string', maxLength: 12000 }, concerns: { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['text', 'evidenceIds'], properties: { text: { type: 'string', minLength: 1, maxLength: 600 }, evidenceIds: { type: 'array', minItems: 1, maxItems: 8, uniqueItems: true, items: { type: 'string' } } } } }, episodes: { type: 'array', maxItems: 12, items: { type: 'object', additionalProperties: false, required: ['text', 'evidenceIds'], properties: {
      text: { type: 'string', minLength: 1, maxLength: 6000 }, evidenceIds: { type: 'array', minItems: 1, uniqueItems: true, maxItems: 32, items: { type: 'string' } },
    } } },
  } }, lifecycle: { asynchronous: false, cancellable: false } };
const checkConsolidation = compileDataSchema(compactTool.inputSchema);
const checkRecall = compileDataSchema(recallTool.inputSchema);

/** Generic content cues, excluding envelope IDs and numeric polling changes. */
function observationPhrases(base: DecisionContext): string[] {
  const phrases: string[] = [];
  const visit = (value: unknown): void => {
    if (phrases.length >= 16) return;
    if (typeof value === 'string' && value.length >= 12 && /\s/u.test(value)) phrases.push(searchTerms(value, 16).join(' '));
    else if (Array.isArray(value)) for (const item of value) visit(item);
    else if (value && typeof value === 'object') for (const item of Object.values(value)) visit(item);
  };
  const events = new Set(base.perception?.eventIds);
  // New speech and narrative should not be crowded out by a verbose state snapshot.
  for (const observation of [...base.observations.filter(o => events.has(o.id)), ...base.observations.filter(o => !events.has(o.id))]) visit(observation.content);
  return phrases;
}

export class ContextCapacityError extends Error { constructor(message = 'Protected character context exceeds its configured capacity.') { super(message); } }

/** Model-authored memory over an actor-scoped archive; no world effects or goal priorities. */
export class CharacterMemory {
  constructor(private readonly storage: RunnerStorage, readonly settings: ContextSettings, readonly policy?: MemoryPolicy) {}
  private evidence(actor: string) { return `evidence:${actor}`; }
  private episodes(actor: string) { return `episodes:${actor}`; }
  initialise(state: CharacterState): void {
    if (this.storage.get('memory-head', state.instanceId)) return;
    this.storage.transaction(() => {
      this.storage.set('memory-head', state.instanceId, { version: 0, cursor: -1, summary: '' });
      for (const memory of state.context.memories ?? []) this.retain(state.instanceId, 0, memory);
    });
    state.context.memories = [];
  }
  retain(actor: string, turn: number, memory: Memory): void {
    const stream = this.evidence(actor), prior = this.storage.entry<Memory>(stream, memory.id);
    if (prior) { if (canonicalJson(prior.value) !== canonicalJson(memory)) throw new Error('Conflicting archived experience.'); return; }
    this.storage.append(stream, { id: memory.id, turn, text: memory.text, value: memory });
  }
  cutoff(actor: string): MemoryCutoff {
    return { evidence: this.storage.count(this.evidence(actor)), episodes: this.storage.count(this.episodes(actor)),
      head: this.storage.get<MemoryHead>('memory-head', actor) ?? { version: 0, cursor: -1, summary: '' } };
  }
  evidenceById(actor: string, ids: string[]): Memory[] {
    return ids.flatMap(id => {
      const row = this.storage.entry<Memory>(this.evidence(actor), id) ?? this.storage.entry<Memory>(this.episodes(actor), id);
      return row ? [row.value] : [];
    });
  }
  batch(actor: string, turn: number, cutoff: MemoryCutoff, underPressure = false): ConsolidationBatch | undefined {
    const rows = this.storage.read<Memory>(this.evidence(actor), { after: cutoff.head.cursor, before: cutoff.evidence,
      toTurn: turn - this.settings.recentTurns, limit: this.settings.batchRecords });
    const selected: StoredEntry<Memory>[] = []; let chars = 0;
    for (const row of rows) {
      const size = JSON.stringify(row.value).length;
      if (chars + size > this.settings.maxBatchChars) break;
      selected.push(row); chars += size;
    }
    if (rows.length && !selected.length) throw new ContextCapacityError('One original experience exceeds the consolidation batch capacity.');
    if (!selected.length) return;
    const defaultDue = rows.length >= this.settings.batchRecords || selected.length < rows.length || rows[0].turn <= turn - this.settings.recentTurns - this.settings.batchTurns;
    const due = this.policy?.shouldConsolidate?.({ turn, records: selected.length, characters: chars, oldestTurn: rows[0].turn, defaultDue }) ?? defaultDue;
    if (!underPressure && !due) return;
    return { baseVersion: cutoff.head.version, through: selected.at(-1)!.sequence, records: selected };
  }
  commit(actor: string, batch: ConsolidationBatch, value: unknown, origin: string): MemoryHead {
    if (checkConsolidation(value).length) throw new Error('Invalid consolidation structure.');
    const output = value as Consolidation;
    if (output.summary.length > this.settings.maxSummaryChars || JSON.stringify(output).length > this.settings.maxBatchChars) throw new Error('Consolidation exceeds its memory allowance.');
    const sources = new Map(batch.records.map(row => [row.id, row.value]));
    if (output.episodes.some(episode => episode.evidenceIds.some(id => !sources.has(id)))) throw new Error('Consolidation cites unavailable evidence.');
    const current = this.cutoff(actor).head;
    if (current.version !== batch.baseVersion || batch.through <= current.cursor) throw new Error('Stale consolidation.');
    const allowed = new Set([...sources.keys(), ...(current.concerns ?? []).flatMap(c => c.evidenceIds)]);
    if (output.concerns?.some(c => c.evidenceIds.some(id => !allowed.has(id)))) throw new Error('Concern cites unavailable evidence.');
    const concerns = output.concerns ?? current.concerns;
    const next: MemoryHead = { version: current.version + 1, cursor: batch.through, summary: output.summary, ...(concerns ? { concerns: structuredClone(concerns) } : {}) };
    this.storage.transaction(() => {
      for (const [index, episode] of output.episodes.entries()) {
        const memory: Memory = { id: `episode:${next.version}:${index}`, text: episode.text, source: { kind: 'interpretation', origin },
          eventRefs: episode.evidenceIds.map(id => ({ id, origin, resolution: 'recorded' })) };
        this.storage.append(this.episodes(actor), { id: memory.id, turn: batch.records.at(-1)!.turn, text: memory.text, value: memory });
      }
      this.storage.append(`memory-versions:${actor}`, { id: `memory:${next.version}`, turn: batch.records.at(-1)!.turn, text: '', value: { ...next, sources: batch.records.map(row => row.id) } });
      this.storage.set('memory-head', actor, next);
    });
    return next;
  }
  recall(actor: string, cutoff: MemoryCutoff, input: unknown): Memory[] {
    if (checkRecall(input).length) throw new Error('Invalid recall query.');
    const query = input as { query?: string; ids?: string[]; fromTurn?: number; toTurn?: number };
    const selected = new Map<string, Memory>(); let chars = 0;
    const add = (row: StoredEntry<Memory> | undefined, before: number, includeSources = true) => {
      if (row && row.sequence < before && includeSources && row.value.source.kind === 'interpretation') {
        for (const ref of (row.value.eventRefs ?? []).slice(0, 32)) add(this.storage.entry<Memory>(this.evidence(actor), ref.id), cutoff.evidence, false);
      }
      if (!row || row.sequence >= before || selected.has(row.id)) return;
      const size = JSON.stringify(row.value).length;
      if (chars + size > this.settings.maxRecallChars) return;
      selected.set(row.id, row.value); chars += size;
    };
    for (const id of query.ids ?? []) {
      add(this.storage.entry<Memory>(this.evidence(actor), id), cutoff.evidence);
      add(this.storage.entry<Memory>(this.episodes(actor), id), cutoff.episodes);
    }
    if (query.query || !query.ids?.length) for (const [stream, before] of [[this.episodes(actor), cutoff.episodes], [this.evidence(actor), cutoff.evidence]] as const) {
      for (const row of this.storage.read<Memory>(stream, { before, query: query.query, fromTurn: query.fromTurn, toTurn: query.toTurn, limit: 6 })) add(row, before);
    }
    return [...selected.values()];
  }
  /** Execute replaceable retrieval against a frozen capability, then materialize only validated archive records. */
  async retrieve(base: DecisionContext, turn: number, cutoff: MemoryCutoff, signal: AbortSignal, query?: MemoryQuery): Promise<{ memories: Memory[]; selection: MemorySelection }> {
    if (!this.policy) throw new Error('No memory policy configured.');
    if (query && checkRecall(query).length) throw new Error('Invalid recall query.');
    const actor = base.instanceId, automatic = query === undefined;
    const limit = automatic ? Math.min(this.settings.maxRecallChars, this.settings.maxAutomaticRecallChars ?? 6000) : this.settings.maxRecallChars;
    if (!limit) return { memories: [], selection: { references: [], mode: 'lexical' } };
    let open = true;
    const guard = () => { signal.throwIfAborted(); if (!open) throw new Error('Memory view is closed.'); };
    const bounds = (kind: MemoryReference['kind']) => kind === 'experience' ? automatic ? cutoff.head.cursor + 1 : cutoff.evidence : cutoff.episodes;
    const stream = (kind: MemoryReference['kind']) => kind === 'experience' ? this.evidence(actor) : this.episodes(actor);
    const validKind = (kind: string) => { if (!['experience', 'episode'].includes(kind)) throw new Error('Invalid memory kind.'); };
    const get = (ref: MemoryReference): MemoryRecord | undefined => {
      guard(); validKind(ref.kind);
      const row = this.storage.entry<Memory>(stream(ref.kind), ref.id);
      return row && row.sequence < bounds(ref.kind) ? { reference: { ...ref }, sequence: row.sequence, turn: row.turn, memory: row.value } : undefined;
    };
    const pageLimit = (n: number) => { if (!Number.isSafeInteger(n) || n < 0 || n > 64) throw new Error('Memory pages must contain at most 64 records.'); return n; };
    const indexStream = (model: string) => { if (typeof model !== 'string' || !model.length || model.length > 256) throw new Error('Invalid vector space.'); return `memory-vectors:${actor}:${model}`; };
    const withinRange = (record: MemoryRecord) => record.turn >= (query?.fromTurn ?? -Infinity) && record.turn <= (query?.toTurn ?? Infinity);
    const view: MemoryView = {
      get,
      search: (text, count) => {
        guard(); pageLimit(count);
        if (typeof text !== 'string' || text.length > 4000) throw new Error('Invalid search query.');
        return (['experience', 'episode'] as const).flatMap(kind => this.storage.read<Memory>(stream(kind), { query: text, before: bounds(kind), limit: count, fromTurn: query?.fromTurn, toTurn: query?.toTurn })
          .map(row => ({ reference: { kind, id: row.id }, sequence: row.sequence, turn: row.turn, memory: row.value })));
      },
      page: (kind, after, count) => {
        guard(); validKind(kind); pageLimit(count);
        if (!Number.isSafeInteger(after) || after < -1) throw new Error('Invalid memory cursor.');
        return this.storage.read<Memory>(stream(kind), { after, before: bounds(kind), limit: count }).map(row => ({ reference: { kind, id: row.id }, sequence: row.sequence, turn: row.turn, memory: row.value }));
      },
      vectors: (model, after, count) => {
        guard(); pageLimit(count); if (!count) return [];
        if (!Number.isSafeInteger(after) || after < -1) throw new Error('Invalid vector cursor.');
        const result: { sequence: number; value: MemoryVector }[] = [];
        for (;;) {
          const rows = this.storage.read<MemoryVector>(indexStream(model), { after, limit: 64 });
          for (const row of rows) { if (get(row.value.reference)) result.push({ sequence: row.sequence, value: row.value }); if (result.length >= count) return result; }
          if (rows.length < 64) return result;
          after = rows.at(-1)!.sequence;
        }
      },
      putVector: (model, value) => {
        guard(); if (!get(value.reference) || !Array.isArray(value.vector) || !value.vector.length || value.vector.length > 4096 || value.vector.some(n => typeof n !== 'number' || !Number.isFinite(n))) throw new Error('Invalid scoped vector.');
        const id = `${value.reference.kind}:${value.reference.id}`, target = indexStream(model);
        const prior = this.storage.entry<MemoryVector>(target, id);
        if (prior) { if (canonicalJson(prior.value) !== canonicalJson(value)) throw new Error('Vector identity is immutable.'); return; }
        this.storage.append(target, { id, turn, text: '', value: { reference: { kind: value.reference.kind, id: value.reference.id }, vector: [...value.vector] } });
      },
      cursor: (model, kind) => { guard(); validKind(kind); return this.storage.get<number>(indexStream(model), kind) ?? -1; },
      advanceCursor: (model, kind, sequence) => {
        guard(); validKind(kind);
        if (!Number.isSafeInteger(sequence) || sequence < -1 || sequence >= bounds(kind)) throw new Error('Invalid index cursor.');
        this.storage.set(indexStream(model), kind, sequence);
      },
    };
    try {
      const selection = await this.policy.retrieve({ context: structuredClone(base), turn, query: query && structuredClone(query), view, limit: automatic ? 8 : 24 }, signal);
      guard();
      if (!selection || !Array.isArray(selection.references) || selection.references.length > 64 || !['lexical', 'hybrid', 'custom'].includes(selection.mode)) throw new Error('Invalid memory selection.');
      const selected = new Map<string, Memory>(); let chars = 0;
      const add = (ref: MemoryReference, expand: boolean) => {
        const record = get(ref);
        if (!record || !withinRange(record)) throw new Error('Memory selection is outside the permitted view.');
        const memory = record.memory;
        if (selected.has(memory.id)) return;
        const size = JSON.stringify(memory).length;
        if (chars + size > limit) return;
        selected.set(memory.id, memory); chars += size;
        if (expand && ref.kind === 'episode') for (const id of (memory.eventRefs ?? []).slice(0, 32).map(r => r.id)) {
          const source = get({ kind: 'experience', id });
          if (source && withinRange(source)) add(source.reference, false);
        }
      };
      selection.references.forEach(ref => add(ref, !automatic));
      // Only allowlisted diagnostics are copied by the runner; provider text cannot become memory.
      return { memories: [...selected.values()], selection };
    } finally { open = false; }
  }

  assemble(base: DecisionContext, turn: number, cutoff: MemoryCutoff, recalled?: Memory[], bindTools?: (context: DecisionContext) => void): DecisionContext {
    const collect = (query: { after?: number; fromTurn?: number }) => {
      const rows: StoredEntry<Memory>[] = []; let after = query.after ?? -1, size = 0;
      for (;;) {
        const page = this.storage.read<Memory>(this.evidence(base.instanceId), { ...query, after, before: cutoff.evidence, limit: 64 });
        for (const row of page) { size += JSON.stringify(row.value).length; if (size > this.settings.maxContextChars) throw new ContextCapacityError(); rows.push(row); }
        if (page.length < 64) return rows;
        after = page.at(-1)!.sequence;
      }
    };
    const pending = collect({ after: cutoff.head.cursor });
    const recent = collect({ fromTurn: turn - this.settings.recentTurns + 1 });
    const unique = new Map([...pending, ...recent].map(row => [row.id, row.value]));
    const current = new Set(base.observations.map(o => o.id));
    const experience = [...unique.values()].filter(memory => !memory.eventRefs?.some(ref => current.has(ref.id)));
    const query = base.intentions.map(intention => intention.description).join(' ');
    const phrases = observationPhrases(base);
    const previous = this.storage.get<{ turn: number; phrases: string[]; cue: string; intentions?: string; goalCue?: string }>('context-cues', base.instanceId);
    const sameOpportunity = previous?.turn === turn && previous.intentions === query && canonicalJson(previous.phrases) === canonicalJson(phrases);
    const cue = sameOpportunity ? previous.cue : phrases.filter(phrase => !previous?.phrases.includes(phrase)).join(' ');
    const goalCue = sameOpportunity ? previous.goalCue ?? '' : previous?.intentions === query ? '' : query;
    if (!sameOpportunity) this.storage.set('context-cues', base.instanceId, { turn, phrases, cue, intentions: query, goalCue });
    const automaticLimit = Math.min(this.settings.maxRecallChars, this.settings.maxAutomaticRecallChars ?? 6000);
    const cacheKey = canonicalJson(['selective:1', cutoff.head.version, cutoff.episodes, automaticLimit, cue, goalCue]);
    const cache = this.storage.get<{ key: string; memories: Memory[] }>('automatic-recall', base.instanceId);
    let retrieved = recalled ?? (this.policy ? [] : undefined);
    if (!retrieved) {
      if (cache?.key === cacheKey) retrieved = cache.memories;
      else {
        const selected = new Map<string, Memory>(); let chars = 0;
        // Automatic reminders are a small selection of direct matches, not an
        // episode's whole citation tree. Explicit recall still expands originals.
        if (automaticLimit > 0) for (const query of [cue, goalCue].filter(Boolean)) {
          for (const [stream, before] of [[this.evidence(base.instanceId), cutoff.head.cursor + 1], [this.episodes(base.instanceId), cutoff.episodes]] as const) {
            for (const row of this.storage.read<Memory>(stream, { before, query, limit: 6 })) {
              const memory = row.value;
              if (selected.size >= 3 || selected.has(memory.id) || unique.has(memory.id)) continue;
              if (memory.source.kind === 'interpretation' && memory.eventRefs?.some(ref => selected.has(ref.id))) continue;
              const size = JSON.stringify(memory).length;
              if (chars + size > automaticLimit) continue;
              selected.set(memory.id, memory); chars += size;
            }
          }
        }
        retrieved = [...selected.values()];
      }
      if (cache?.key !== cacheKey) this.storage.set('automatic-recall', base.instanceId, { key: cacheKey, memories: retrieved });
    }
    const context: DecisionContext = { ...structuredClone(base), memories: retrieved.filter(memory => !unique.has(memory.id)),
      recent: experience, outcomes: [], memory: { version: cutoff.head.version, summary: cutoff.head.summary, evidenceThrough: cutoff.head.cursor, temporalScope: 'Summary and concerns reflect consolidated history through evidenceThrough (an archive sequence, not a turn). They may be outdated; reconcile them with recent experiences and current observations.', authority: 'interpretation', ...(cutoff.head.concerns ? { concerns: structuredClone(cutoff.head.concerns) } : {}) },
      tools: [...base.tools.filter(tool => tool.id !== recallTool.id), recallTool] };
    const measure = () => {
      context.memoryEvidence = [...context.memories, ...experience].map(memoryEvidence);
      bindTools?.(context);
      const chars = JSON.stringify({ ...context, contextSize: undefined }).length;
      context.contextSize = { characters: chars, sections: Object.fromEntries(['character', 'intentions', 'memories', 'recent', 'observations', 'tools', 'memory', 'memoryEvidence'].map(key => [key, JSON.stringify(context[key as keyof DecisionContext]).length])) };
      return JSON.stringify(context).length;
    };
    // Recall is optional context, not protected recent evidence. Preserve its priority
    // order and leave omitted originals searchable rather than disabling the actor.
    let chars = measure();
    while (chars > this.settings.maxContextChars && context.memories.length) { context.memories.pop(); chars = measure(); }
    if (chars > this.settings.maxContextChars) throw new ContextCapacityError();
    // End with the current delivery so quoted historical requests are not the final cue.
    const { observations, ...history } = context;
    return { ...history, observations };
  }
  consolidationContext(base: DecisionContext, batch: ConsolidationBatch, cutoff: MemoryCutoff): DecisionContext {
    const tool = structuredClone(compactTool);
    if (this.policy?.consolidationInstruction) tool.description += ' ' + this.policy.consolidationInstruction;
    if (!this.policy) delete (tool.inputSchema as { properties: Record<string, unknown> }).properties.concerns;
    (((tool.inputSchema as { properties: unknown }).properties as Record<string, Record<string, unknown>>).summary).maxLength = this.settings.maxSummaryChars;
    const properties = (tool.inputSchema as { properties: unknown }).properties as { episodes: { items: { properties: { evidenceIds: { items: { type: string; enum?: string[] } } } } } };
    properties.episodes.items.properties.evidenceIds.items.enum = batch.records.map(row => row.id);
    const concernSchema = (tool.inputSchema as { properties: { concerns?: { items: { properties: { evidenceIds: { items: { enum?: string[] } } } } } } }).properties.concerns;
    if (concernSchema) concernSchema.items.properties.evidenceIds.items.enum = [...new Set([...batch.records.map(row => row.id), ...(cutoff.head.concerns ?? []).flatMap(c => c.evidenceIds)])];
    const context: DecisionContext = { ...structuredClone(base), purpose: 'consolidation', perception: undefined, tools: [tool], outcomes: [], observations: [],
      memories: batch.records.map(row => row.value), memory: { version: cutoff.head.version, summary: cutoff.head.summary, evidenceThrough: cutoff.head.cursor, temporalScope: 'Summary and concerns reflect consolidated history through evidenceThrough (an archive sequence, not a turn). They may be outdated; reconcile them with recent experiences and current observations.', authority: 'interpretation', ...(cutoff.head.concerns ? { concerns: structuredClone(cutoff.head.concerns) } : {}) } };
    context.memoryEvidence = context.memories.map(memoryEvidence);
    const characters = JSON.stringify(context).length;
    if (characters > this.settings.maxContextChars) throw new ContextCapacityError('Consolidation context exceeds its configured capacity.');
    context.contextSize = { characters, sections: { originals: JSON.stringify(context.memories).length, summary: cutoff.head.summary.length } };
    const { memories, ...prior } = context;
    return { ...prior, memories };
  }
}
