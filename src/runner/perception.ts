import { canonicalJson, type JsonValue, type Observation, type TimePoint } from '../format/index.js';
import { MemoryRunnerStorage, type RunnerStorage } from './storage.js';

/** The host confirms an occurrence, not the truth of quoted speech or an interpretation. */
export interface PerceivedEvent {
  id: string;
  kind: 'dialogue' | 'narrative' | 'receipt' | 'interpretation';
  authority: 'host' | 'statement' | 'interpretation';
  capturedAt: TimePoint;
  recipients: string[];
  actor?: string;
  text?: string;
  data?: JsonValue;
  references?: string[];
}
export interface HostPerception {
  /** Latest authorized state. Recorded for audit, never repeatedly added to working memory. */
  current: Observation[];
  /** Newly delivered occurrences with stable IDs. Original wording and order are preserved. */
  events: Observation[];
}

/** Explicit audiences, identity-based redelivery, and durable recipient cursors. */
export class PerceptionJournal {
  constructor(private readonly actors: readonly string[], private readonly source: string,
    private readonly storage: RunnerStorage = new MemoryRunnerStorage()) {}
  private stream(actor: string) { return `perception:${this.source}:${actor}`; }
  private validate(event: PerceivedEvent): void {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(event.id) || !['dialogue', 'narrative', 'receipt', 'interpretation'].includes(event.kind) || !event.recipients.length || new Set(event.recipients).size !== event.recipients.length
      || event.recipients.some(actor => !this.actors.includes(actor))
      || event.kind === 'dialogue' && event.authority !== 'statement'
      || event.kind === 'interpretation' && event.authority !== 'interpretation'
      || ['receipt', 'narrative'].includes(event.kind) && event.authority !== 'host') throw new Error('Invalid event audience or authority.');
  }
  publish(event: PerceivedEvent): void {
    this.validate(event);
    this.storage.transaction(() => {
      const key = `perception-identity:${this.source}`, content = canonicalJson(event);
      const prior = this.storage.get<string>(key, event.id);
      if (prior !== undefined) { if (prior !== content) throw new Error('Conflicting perceived event identity.'); return; }
      this.storage.set(key, event.id, content);
      for (const actor of event.recipients) this.storage.append(this.stream(actor), {
        id: event.id, turn: this.storage.count(this.stream(actor)), text: event.text ?? '', value: event,
      });
    });
  }
  drain(actor: string, runId: string, deliveredAt: TimePoint, revision: number): Observation[] {
    if (!this.actors.includes(actor)) throw new Error('Unknown perception recipient.');
    const stream = this.stream(actor), after = this.storage.get<number>('perception-delivered', stream) ?? -1;
    const rows = this.storage.read<PerceivedEvent>(stream, { after, limit: this.storage.count(stream) - after - 1 });
    if (rows.length) this.storage.set('perception-delivered', stream, rows.at(-1)!.sequence);
    return rows.map(({ value: event }) => ({ id: event.id, runId, source: this.source, recipient: actor,
      capturedAt: event.capturedAt, deliveredAt, revision,
      content: [{ type: 'data', schemaId: 'simkind.perceived-event:1.0.0', data: JSON.parse(JSON.stringify(event)) as JsonValue }],
    }));
  }
  /** Used by small in-memory hosts; SQLite hosts checkpoint the journal transactionally. */
  snapshot(): JsonValue {
    return JSON.parse(JSON.stringify(this.actors.map(actor => ({ actor,
      events: this.storage.read<PerceivedEvent>(this.stream(actor), { limit: this.storage.count(this.stream(actor)) }).map(row => row.value),
      delivered: this.storage.get<number>('perception-delivered', this.stream(actor)) ?? -1,
    }))));
  }
  restore(snapshot: JsonValue): void {
    const rows = snapshot as unknown as { actor: string; events: PerceivedEvent[]; delivered: number }[];
    if (!Array.isArray(rows) || rows.length !== this.actors.length || new Set(rows.map(row => row.actor)).size !== this.actors.length) throw new Error('Invalid perception checkpoint.');
    this.storage.transaction(() => {
      for (const row of rows) {
        if (!this.actors.includes(row.actor) || !Array.isArray(row.events) || !Number.isSafeInteger(row.delivered) || row.delivered < -1 || row.delivered >= row.events.length) throw new Error('Invalid perception checkpoint.');
        const stream = this.stream(row.actor), prior = this.storage.read<PerceivedEvent>(stream, { limit: this.storage.count(stream) });
        if (prior.length > row.events.length || new Set(row.events.map(event => event.id)).size !== row.events.length) throw new Error('Conflicting perception checkpoint.');
        // Restore each recipient's order directly; re-publishing a shared event while
        // visiting the first actor could reorder another actor's earlier private event.
        row.events.forEach((event, index) => {
          this.validate(event);
          if (!event.recipients.includes(row.actor)) throw new Error('Invalid perception checkpoint audience.');
          const key = `perception-identity:${this.source}`, content = canonicalJson(event), identity = this.storage.get<string>(key, event.id);
          if (identity !== undefined && identity !== content || prior[index] && canonicalJson(prior[index].value) !== content) throw new Error('Conflicting perceived event identity.');
          this.storage.set(key, event.id, content);
          if (!prior[index]) this.storage.append(stream, { id: event.id, turn: index, text: event.text ?? '', value: event });
        });
        this.storage.set('perception-delivered', stream, row.delivered);
      }
    });
  }
}
