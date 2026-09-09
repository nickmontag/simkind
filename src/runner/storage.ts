/** Synchronous indexed storage keeps host boundaries synchronous. Node supplies a disk adapter. */
export interface StoredEntry<T = unknown> { sequence: number; id: string; turn: number; text: string; value: T }
export interface EntryQuery { after?: number; before?: number; fromTurn?: number; toTurn?: number; query?: string; limit?: number }
export interface RunnerStorage {
  get<T>(table: string, key: string): T | undefined;
  set(table: string, key: string, value: unknown): void;
  delete(table: string, key: string): void;
  append<T>(stream: string, entry: Omit<StoredEntry<T>, 'sequence'>): StoredEntry<T>;
  entry<T>(stream: string, id: string): StoredEntry<T> | undefined;
  read<T>(stream: string, query?: EntryQuery): StoredEntry<T>[];
  count(stream: string): number;
  transaction<T>(work: () => T): T;
  revision?(): number;
  rewind?(revision: number): void;
}

/** Isolates a branch's action ledger while retaining its inherited private evidence. */
export class ScopedRunnerStorage implements RunnerStorage {
  constructor(private readonly storage: RunnerStorage, private readonly prefix: string) {}
  get<T>(table: string, key: string) { return this.storage.get<T>(this.prefix + table, key); }
  set(table: string, key: string, value: unknown) { this.storage.set(this.prefix + table, key, value); }
  delete(table: string, key: string) { this.storage.delete(this.prefix + table, key); }
  append<T>(stream: string, entry: Omit<StoredEntry<T>, 'sequence'>) { return this.storage.append(this.prefix + stream, entry); }
  entry<T>(stream: string, id: string) { return this.storage.entry<T>(this.prefix + stream, id); }
  read<T>(stream: string, query?: EntryQuery) { return this.storage.read<T>(this.prefix + stream, query); }
  count(stream: string) { return this.storage.count(this.prefix + stream); }
  transaction<T>(work: () => T) { return this.storage.transaction(work); }
}

export function searchTerms(text: string, limit = 64): string[] {
  return [...new Set(text.toLowerCase().match(/[\p{L}\p{N}_]{3,}/gu) ?? [])].slice(0, limit);
}

/** Small-run adapter. Disk-backed sessions use the same contract without resident archives. */
export class MemoryRunnerStorage implements RunnerStorage {
  private tables = new Map<string, Map<string, unknown>>();
  private streams = new Map<string, StoredEntry[]>();
  private ids = new Map<string, Map<string, StoredEntry>>();
  private index = new Map<string, Map<string, Set<number>>>();
  private undo?: (() => void)[];
  get<T>(table: string, key: string): T | undefined { return structuredClone(this.tables.get(table)?.get(key)) as T | undefined; }
  set(table: string, key: string, value: unknown): void {
    let values = this.tables.get(table);
    if (!values) { values = new Map(); this.tables.set(table, values); }
    const old = values.get(key), existed = values.has(key), target = values;
    this.undo?.push(() => { if (existed) target.set(key, old); else target.delete(key); });
    values.set(key, structuredClone(value));
  }
  delete(table: string, key: string): void {
    const values = this.tables.get(table); if (!values?.has(key)) return;
    const old = values.get(key); this.undo?.push(() => { values.set(key, old); }); values.delete(key);
  }
  append<T>(stream: string, entry: Omit<StoredEntry<T>, 'sequence'>): StoredEntry<T> {
    if (this.ids.get(stream)?.has(entry.id)) throw new Error('Duplicate archive entry.');
    let rows = this.streams.get(stream), ids = this.ids.get(stream), index = this.index.get(stream);
    if (!rows) { rows = []; ids = new Map(); index = new Map(); this.streams.set(stream, rows); this.ids.set(stream, ids!); this.index.set(stream, index!); }
    const stored = structuredClone({ ...entry, sequence: rows.length });
    rows.push(stored); ids!.set(entry.id, stored);
    const terms = searchTerms(entry.text, Infinity);
    for (const term of terms) { if (!index!.has(term)) index!.set(term, new Set()); index!.get(term)!.add(stored.sequence); }
    const target = rows, targetIds = ids!, targetIndex = index!;
    this.undo?.push(() => { target.pop(); targetIds.delete(entry.id); for (const term of terms) targetIndex.get(term)!.delete(stored.sequence); });
    return structuredClone(stored);
  }
  entry<T>(stream: string, id: string): StoredEntry<T> | undefined { return structuredClone(this.ids.get(stream)?.get(id)) as StoredEntry<T> | undefined; }
  read<T>(stream: string, query: EntryQuery = {}): StoredEntry<T>[] {
    const rows = this.streams.get(stream) ?? [], limit = query.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('Invalid archive page size.');
    let candidates: StoredEntry[];
    if (query.query) {
      const scores = new Map<number, number>();
      for (const term of searchTerms(query.query)) for (const seq of this.index.get(stream)?.get(term) ?? []) scores.set(seq, (scores.get(seq) ?? 0) + 1);
      candidates = [...scores].sort((a, b) => b[1] - a[1] || b[0] - a[0]).map(([seq]) => rows[seq]);
    } else {
      let low = Math.max(0, (query.after ?? -1) + 1), high = Math.min(rows.length, query.before ?? rows.length);
      if (query.fromTurn !== undefined) {
        let right = high;
        while (low < right) { const middle = Math.floor((low + right) / 2); if (rows[middle].turn < query.fromTurn) low = middle + 1; else right = middle; }
      }
      candidates = rows.slice(low, Math.min(high, low + limit));
    }
    return structuredClone(candidates.filter(row => row.sequence > (query.after ?? -1) && row.sequence < (query.before ?? Infinity)
      && row.turn >= (query.fromTurn ?? -Infinity) && row.turn <= (query.toTurn ?? Infinity)).slice(0, limit)) as StoredEntry<T>[];
  }
  count(stream: string): number { return this.streams.get(stream)?.length ?? 0; }
  transaction<T>(work: () => T): T {
    if (this.undo) return work();
    this.undo = [];
    try { return work(); } catch (error) { for (const undo of this.undo.reverse()) undo(); throw error; } finally { this.undo = undefined; }
  }
}
