import { DatabaseSync, backup } from 'node:sqlite';
import { searchTerms, type RunnerStorage, type StoredEntry, type EntryQuery } from './storage.js';

/** Local durable adapter. One database belongs to one runner/branch. */
export class SqliteRunnerStorage implements RunnerStorage {
  private db: DatabaseSync;
  private depth = 0;
  constructor(readonly path: string, options: { readOnly?: boolean } = {}) {
    this.db = new DatabaseSync(path, { readOnly: options.readOnly ?? false });
    if (options.readOnly) return;
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA cache_size=-8192;
      CREATE TABLE IF NOT EXISTS archive_flags (id INTEGER PRIMARY KEY, rewinding INTEGER NOT NULL);
      INSERT OR IGNORE INTO archive_flags VALUES (1,0);
      CREATE TABLE IF NOT EXISTS changes (id INTEGER PRIMARY KEY AUTOINCREMENT, bucket TEXT, key TEXT, old_value TEXT, entry_row INTEGER);
      CREATE TABLE IF NOT EXISTS kv (bucket TEXT, key TEXT, value TEXT NOT NULL, PRIMARY KEY(bucket,key));
      CREATE TABLE IF NOT EXISTS entries (rowid INTEGER PRIMARY KEY, stream TEXT NOT NULL, seq INTEGER NOT NULL, id TEXT NOT NULL, turn INTEGER NOT NULL, text TEXT NOT NULL, value TEXT NOT NULL, UNIQUE(stream,seq), UNIQUE(stream,id));
      CREATE INDEX IF NOT EXISTS entries_turn ON entries(stream,turn,seq);
      CREATE INDEX IF NOT EXISTS entries_sequence ON entries(stream,seq);
      CREATE VIRTUAL TABLE IF NOT EXISTS entries_search USING fts5(text, content='entries', content_rowid='rowid');
      CREATE TRIGGER IF NOT EXISTS entries_insert AFTER INSERT ON entries BEGIN INSERT INTO entries_search(rowid,text) VALUES (new.rowid,new.text); END;`);
    this.db.exec(`CREATE TRIGGER IF NOT EXISTS kv_insert AFTER INSERT ON kv WHEN (SELECT rewinding FROM archive_flags WHERE id=1)=0 BEGIN INSERT INTO changes(bucket,key) VALUES(new.bucket,new.key); END;
      CREATE TRIGGER IF NOT EXISTS kv_update AFTER UPDATE ON kv WHEN (SELECT rewinding FROM archive_flags WHERE id=1)=0 BEGIN INSERT INTO changes(bucket,key,old_value) VALUES(old.bucket,old.key,old.value); END;
      CREATE TRIGGER IF NOT EXISTS kv_delete AFTER DELETE ON kv WHEN (SELECT rewinding FROM archive_flags WHERE id=1)=0 BEGIN INSERT INTO changes(bucket,key,old_value) VALUES(old.bucket,old.key,old.value); END;
      CREATE TRIGGER IF NOT EXISTS entries_log AFTER INSERT ON entries WHEN (SELECT rewinding FROM archive_flags WHERE id=1)=0 BEGIN INSERT INTO changes(entry_row) VALUES(new.rowid); END;
      CREATE TRIGGER IF NOT EXISTS entries_delete AFTER DELETE ON entries BEGIN INSERT INTO entries_search(entries_search,rowid,text) VALUES('delete',old.rowid,old.text); END;`);
  }
  get<T>(table: string, key: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM kv WHERE bucket=? AND key=?').get(table, key);
    return row ? JSON.parse(String(row.value)) as T : undefined;
  }
  set(table: string, key: string, value: unknown): void { this.db.prepare('INSERT INTO kv VALUES (?,?,?) ON CONFLICT(bucket,key) DO UPDATE SET value=excluded.value').run(table, key, JSON.stringify(value)); }
  delete(table: string, key: string): void { this.db.prepare('DELETE FROM kv WHERE bucket=? AND key=?').run(table, key); }
  append<T>(stream: string, entry: Omit<StoredEntry<T>, 'sequence'>): StoredEntry<T> {
    const sequence = this.count(stream);
    this.db.prepare('INSERT INTO entries(stream,seq,id,turn,text,value) VALUES (?,?,?,?,?,?)').run(stream, sequence, entry.id, entry.turn, entry.text, JSON.stringify(entry.value));
    return structuredClone({ ...entry, sequence });
  }
  private decode<T>(row: Record<string, unknown>): StoredEntry<T> { return { sequence: Number(row.seq), id: String(row.id), turn: Number(row.turn), text: String(row.text), value: JSON.parse(String(row.value)) as T }; }
  entry<T>(stream: string, id: string): StoredEntry<T> | undefined {
    const row = this.db.prepare('SELECT * FROM entries WHERE stream=? AND id=?').get(stream, id);
    return row ? this.decode<T>(row) : undefined;
  }
  read<T>(stream: string, query: EntryQuery = {}): StoredEntry<T>[] {
    const limit = query.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('Invalid archive page size.');
    const terms = query.query ? searchTerms(query.query) : [];
    if (query.query && !terms.length) return [];
    const search = terms.length > 0;
    // FTS must drive the join. Starting from the stream/time index repeats a
    // full-text search for each historical row instead of searching once.
    const from = search ? 'entries_search f CROSS JOIN entries e ON e.rowid=f.rowid'
      : `entries e INDEXED BY ${query.fromTurn === undefined ? 'entries_sequence' : 'entries_turn'}`;
    const sql = `SELECT e.* FROM ${from}
      WHERE e.stream=? AND e.seq>? AND e.seq<? AND e.turn>=? AND e.turn<=? ${search ? 'AND entries_search MATCH ?' : ''}
      ORDER BY ${search ? 'bm25(entries_search), e.seq DESC' : 'e.seq'} LIMIT ?`;
    const params = [stream, query.after ?? -1, query.before ?? Number.MAX_SAFE_INTEGER, query.fromTurn ?? -Number.MAX_SAFE_INTEGER, query.toTurn ?? Number.MAX_SAFE_INTEGER,
      ...(search ? [terms.map(term => `"${term}"`).join(' OR ')] : []), limit];
    return this.db.prepare(sql).all(...params).map(row => this.decode<T>(row));
  }
  count(stream: string): number { return Number(this.db.prepare('SELECT coalesce(max(seq)+1,0) AS n FROM entries WHERE stream=?').get(stream)!.n); }
  transaction<T>(work: () => T): T {
    if (this.depth) return work();
    this.db.exec('BEGIN IMMEDIATE'); this.depth++;
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
    finally { this.depth--; }
  }
  async copyTo(path: string): Promise<void> { await backup(this.db, path); }
  revision(): number { return Number(this.db.prepare('SELECT coalesce(max(id),0) AS n FROM changes').get()!.n); }
  /** Use on a recovery copy; the original interrupted journal remains available for inspection. */
  rewind(revision: number): void {
    if (!Number.isSafeInteger(revision) || revision < 0 || revision > this.revision()) throw new Error('Invalid archive revision.');
    this.transaction(() => {
      this.db.exec('UPDATE archive_flags SET rewinding=1 WHERE id=1');
      let before = Number.MAX_SAFE_INTEGER;
      for (;;) {
        const rows = this.db.prepare('SELECT * FROM changes WHERE id>? AND id<? ORDER BY id DESC LIMIT 128').all(revision, before);
        for (const row of rows) {
          if (row.entry_row !== null) this.db.prepare('DELETE FROM entries WHERE rowid=?').run(row.entry_row);
          else if (row.old_value === null) this.db.prepare('DELETE FROM kv WHERE bucket=? AND key=?').run(row.bucket, row.key);
          else this.db.prepare('INSERT INTO kv VALUES (?,?,?) ON CONFLICT(bucket,key) DO UPDATE SET value=excluded.value').run(row.bucket, row.key, row.old_value);
        }
        if (rows.length < 128) break;
        before = Number(rows.at(-1)!.id);
      }
      this.db.prepare('DELETE FROM changes WHERE id>?').run(revision);
      this.db.exec('UPDATE archive_flags SET rewinding=0 WHERE id=1');
    });
  }
  close(): void { this.db.close(); }
}
