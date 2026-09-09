import type { JsonObject, Memory } from '../format/index.js';
import type { DecisionContext, ProviderUsage } from './contracts.js';
import { ProviderFailure, type ProviderDiagnostic } from './provider-error.js';

export interface MemoryReference { kind: 'experience' | 'episode'; id: string }
export interface MemoryRecord { reference: MemoryReference; sequence: number; turn: number; memory: Memory }
export interface MemoryQuery { query?: string; ids?: string[]; fromTurn?: number; toTurn?: number }
export interface WorkingConcern { text: string; evidenceIds: string[] }
export interface MemoryPolicyIdentity { id: string; version: string; settings: JsonObject }
export interface MemoryVector { reference: MemoryReference; vector: number[] }
/** A frozen, actor-local view. No host, other actors, sibling futures, or raw storage handle. */
export interface MemoryView {
  search(query: string, limit: number): MemoryRecord[];
  page(kind: MemoryReference['kind'], after: number, limit: number): MemoryRecord[];
  get(reference: MemoryReference): MemoryRecord | undefined;
  /** Derived, rebuildable index; writes are rejected once retrieval ends or is aborted. */
  vectors(model: string, after: number, limit: number): { sequence: number; value: MemoryVector }[];
  putVector(model: string, value: MemoryVector): void;
  cursor(model: string, kind: MemoryReference['kind']): number;
  advanceCursor(model: string, kind: MemoryReference['kind'], sequence: number): void;
}
export interface MemoryRetrievalInput {
  context: DecisionContext;
  turn: number;
  query?: MemoryQuery;
  view: MemoryView;
  limit: number;
}
export interface MemorySelection {
  references: MemoryReference[];
  mode: 'lexical' | 'hybrid' | 'custom';
  queries?: string[];
  /** Embedding receipts, separate from character decision calls. */
  usage?: ProviderUsage;
  embeddingCalls?: number;
  indexed?: number;
  indexComplete?: boolean;
}
export class MemoryRetrievalFailure extends Error {
  constructor(readonly usage: ProviderUsage, readonly embeddingCalls: number, readonly diagnostic?: ProviderDiagnostic) { super('Memory retrieval failed.'); }
}
export interface MemoryPolicy {
  identity: MemoryPolicyIdentity;
  /** Optional model guidance; structure, source validation, and world authority remain core-owned. */
  consolidationInstruction?: string;
  /** Schedule eligible batches without overriding core recent-history or capacity protection. */
  shouldConsolidate?(batch: { turn: number; records: number; characters: number; oldestTurn: number; defaultDue: boolean }): boolean;
  retrieve(input: MemoryRetrievalInput, signal: AbortSignal): Promise<MemorySelection>;
}
export interface MemoryEmbeddings {
  /** Include model/revision and dimension configuration; must identify a stable vector space. */
  id: string;
  embed(texts: string[], signal: AbortSignal): Promise<{ vectors: number[][]; usage?: ProviderUsage }>;
}

const stopWords = new Set('a an the and or but if to of in on at for from with as is are was were be been being i me my we our you your he she it its they their this that these those what which who whom how why when where do does did can could would should have has had will just about please tell said says say'.split(' '));
export function relevanceTerms(text: string): string[] {
  return [...new Set(text.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? [])].filter(term => !stopWords.has(term));
}
/** Search content, not serialized envelope keys. The original remains unchanged in the archive. */
export function memorySearchText(text: string): string {
  try {
    const value: unknown = JSON.parse(text), strings: string[] = [];
    const visit = (item: unknown, key = ''): void => {
      if (['id', 'runId', 'requestId', 'revision', 'capturedAt', 'deliveredAt', 'eventRefs', 'source', 'schemaId', 'type'].includes(key)) return;
      if (typeof item === 'string' || typeof item === 'number') strings.push(String(item));
      else if (Array.isArray(item)) item.forEach(part => visit(part));
      else if (item && typeof item === 'object') for (const [name, part] of Object.entries(item)) visit(part, name);
    };
    visit(value); return strings.join(' ');
  } catch { return text; }
}
const key = (ref: MemoryReference) => `${ref.kind}:${ref.id}`;

/** A small set of independent cues keeps long generic observations from swallowing distinctive details. */
export function situationalQueries(context: DecisionContext): string[] {
  const events = new Set(context.perception?.eventIds);
  const text = (o: DecisionContext['observations'][number]) => memorySearchText(JSON.stringify(o.content)).slice(0, 1200);
  const cues = [
    ...context.observations.filter(o => events.has(o.id)).slice(-4).map(text),
    ...(context.memory?.concerns ?? []).slice(0, 4).map(c => c.text),
    ...context.intentions.slice(0, 4).map(i => i.description),
    ...context.observations.filter(o => !events.has(o.id)).slice(0, 4).map(text),
  ];
  return [...new Set(cues.map(cue => relevanceTerms(cue).slice(0, 32).join(' ')).filter(Boolean))].slice(0, 12);
}

function unit(vector: number[]): number[] {
  if (!Array.isArray(vector) || !vector.length || vector.length > 4096 || vector.some(n => typeof n !== 'number' || !Number.isFinite(n))) throw new Error('Invalid embedding vector.');
  const norm = Math.hypot(...vector);
  if (!norm || !Number.isFinite(norm)) throw new Error('Invalid embedding norm.');
  return vector.map(n => n / norm);
}

export function createSituationalMemoryPolicy(options: { embeddings?: MemoryEmbeddings; indexBatchSize?: number } = {}): MemoryPolicy {
  const embeddings = options.embeddings, batchSize = options.indexBatchSize ?? 32;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 64) throw new Error('Index batch size must be between 1 and 64.');
  if (embeddings && (!embeddings.id.trim() || embeddings.id.length > 256)) throw new Error('Name the embedding vector space.');
  return {
    identity: { id: 'simkind.situational', version: '1.0.0', settings: { embeddings: embeddings?.id ?? null, indexBatchSize: batchSize } },
    consolidationInstruction: 'Keep a small set of concerns as of the supplied historical batch: matters this character still considers relevant, including unresolved interactions or intentions. Recent turns are outside this batch. Update or retire concerns when supplied evidence warrants it; do not invent closure or prescribe a strategy. Concerns are fallible interpretations, not extra goals or world facts. Preserve personally meaningful experiences without imposing emotions or relationship scores.',
    async retrieve({ context, query, view, limit }, signal) {
      let embeddingCalls = 0, indexed = 0, indexComplete = true;
      const usage: ProviderUsage = {};
      try {
      const queries = query?.query ? [relevanceTerms(query.query).slice(0, 64).join(' ')].filter(Boolean) : query ? [] : situationalQueries(context);
      const candidates = new Map<string, { record: MemoryRecord; score: number; channels: Set<number> }>();
      const withinRange = (record: MemoryRecord) => record.turn >= (query?.fromTurn ?? -Infinity) && record.turn <= (query?.toTurn ?? Infinity);
      const add = (record: MemoryRecord, score: number, channel: number) => {
        if (!withinRange(record)) return;
        const id = key(record.reference), previous = candidates.get(id);
        if (previous) { previous.score += score; previous.channels.add(channel); }
        else candidates.set(id, { record, score, channels: new Set([channel]) });
      };
      const direct: MemoryReference[] = [];
      for (const id of query?.ids ?? []) for (const kind of ['experience', 'episode'] as const) {
        const record = view.get({ kind, id }); if (record && withinRange(record)) direct.push(record.reference);
      }
      if (query && !query.query && !query.ids?.length) view.search('', Math.min(64, limit)).forEach((record, i) => add(record, 1 / (i + 1), 0));
      // Rerank a wider candidate pool using query-local rarity and content coverage.
      queries.forEach((queryText, channel) => {
        const terms = relevanceTerms(queryText), pool = view.search(queryText, 32);
        const tokens = pool.map(record => new Set(relevanceTerms(memorySearchText(record.memory.text))));
        const weights = terms.map(term => 1 + Math.log(1 + pool.length / (1 + tokens.filter(set => set.has(term)).length)));
        const ranked = pool.map((record, i) => ({ record, score: terms.reduce((score, term, j) => score + (tokens[i].has(term) ? weights[j] : 0), 0) / Math.sqrt(Math.max(1, tokens[i].size)) }))
          .filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.record.sequence - b.record.sequence);
        ranked.forEach((item, i) => add(item.record, 1 / (10 + i), channel));
      });
      const embed = async (texts: string[]) => {
        signal.throwIfAborted(); embeddingCalls++;
        const response = await embeddings!.embed(texts, signal); signal.throwIfAborted();
        if (response.vectors.length !== texts.length) throw new Error('Embedding count mismatch.');
        for (const name of ['inputTokens', 'outputTokens', 'cost'] as const) {
          const n = response.usage?.[name]; if (typeof n === 'number' && Number.isFinite(n) && n >= 0) usage[name] = (usage[name] ?? 0) + n;
        }
        const vectors = response.vectors.map(unit);
        if (vectors.some(vector => vector.length !== vectors[0].length)) throw new Error('Embedding dimensions changed.');
        return vectors;
      };
      if (embeddings && queries.length) {
        const pending: MemoryRecord[] = [];
        for (const kind of ['experience', 'episode'] as const) {
          const rows = view.page(kind, view.cursor(embeddings.id, kind), batchSize - pending.length);
          pending.push(...rows);
        }
        if (pending.length) {
          const vectors = await embed(pending.map(record => (memorySearchText(record.memory.text).trim() || record.memory.text).slice(0, 6000)));
          pending.forEach((record, i) => { view.putVector(embeddings.id, { reference: record.reference, vector: vectors[i] }); view.advanceCursor(embeddings.id, record.reference.kind, record.sequence); });
          indexed = pending.length;
        }
        indexComplete = (['experience', 'episode'] as const).every(kind => !view.page(kind, view.cursor(embeddings.id, kind), 1).length);
        const qVectors = await embed(queries);
        const best: { record: MemoryRecord; score: number }[][] = queries.map(() => []);
        let after = -1;
        // Portable exact vector search. A remote/ANN policy can replace this for larger deployments.
        for (;;) {
          signal.throwIfAborted();
          const rows = view.vectors(embeddings.id, after, 64);
          for (const row of rows) {
            const record = view.get(row.value.reference); if (!record) continue;
            if (row.value.vector.length !== qVectors[0].length) throw new Error('Embedding space changed without a new identity.');
            qVectors.forEach((q, i) => {
              const score = q.reduce((sum, n, j) => sum + n * row.value.vector[j], 0);
              if (score <= 0) return;
              best[i].push({ record, score }); best[i].sort((a, b) => b.score - a.score || a.record.sequence - b.record.sequence);
              if (best[i].length > 32) best[i].pop();
            });
          }
          if (rows.length < 64) break;
          after = rows.at(-1)!.sequence;
        }
        best.forEach((list, channel) => list.forEach((item, i) => add(item.record, 1 / (10 + i), channel)));
      }
      const chosen = [...direct], covered = new Set<number>();
      while (chosen.length < limit && candidates.size) {
        const ranked = [...candidates.values()].sort((a, b) => {
          const novelty = (item: typeof a) => [...item.channels].some(c => !covered.has(c)) ? 1.25 : 1;
          return b.score * novelty(b) - a.score * novelty(a) || (key(a.record.reference) < key(b.record.reference) ? -1 : key(a.record.reference) > key(b.record.reference) ? 1 : 0);
        });
        const next = ranked[0]; candidates.delete(key(next.record.reference));
        if (chosen.some(ref => key(ref) === key(next.record.reference))) continue;
        chosen.push(next.record.reference); next.channels.forEach(c => covered.add(c));
      }
      if (embeddings && !queries.length) indexComplete = (['experience', 'episode'] as const).every(kind => !view.page(kind, view.cursor(embeddings.id, kind), 1).length);
      return { references: chosen.slice(0, limit), mode: embeddings ? 'hybrid' : 'lexical', queries, embeddingCalls, indexed, indexComplete, ...(embeddingCalls ? { usage } : {}) };
      } catch (error) { throw new MemoryRetrievalFailure(usage, embeddingCalls, error instanceof ProviderFailure ? error.diagnostic : undefined); }
    },
  };
}
