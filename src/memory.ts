export interface MemoryEvidence<Id extends string = string> {
  id: Id;
  text: string;
  importance: number;
  confidence: number;
  createdTick: number;
  lastAccessTick: number;
  about: string[];
  tags: string[];
  source?: string;
  hops: number;
}

export interface MemoryQuery {
  text?: string;
  about?: string;
  limit?: number;
}

function words(text: string): Set<string> {
  return new Set(
    (text.toLocaleLowerCase().match(/[a-z0-9]+/g) ?? [])
      .filter((word) => word.length >= 4),
  );
}

export function rankMemories<M extends MemoryEvidence>(
  memories: readonly M[],
  nowTick: number,
  query: MemoryQuery = {},
): M[] {
  const queryTokens = words(query.text ?? '');
  return memories
    .filter((memory) => query.about === undefined || memory.about.includes(query.about))
    .map((memory) => {
      const searchable = words(`${memory.text} ${memory.tags.join(' ')}`);
      const overlap = [...queryTokens].filter((word) => searchable.has(word)).length;
      const age = Math.max(0, nowTick - memory.createdTick);
      const accessAge = Math.max(0, nowTick - memory.lastAccessTick);
      return {
        memory,
        score:
          memory.importance * 2 +
          memory.confidence * 4 +
          Math.max(0, 4 - age / 5000) +
          Math.max(0, 2 - accessAge / 5000) +
          overlap * 3 +
          (query.about !== undefined ? 6 : 0),
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.memory.createdTick - a.memory.createdTick ||
        a.memory.id.localeCompare(b.memory.id),
    )
    .slice(0, query.limit ?? 48)
    .map(({ memory }) => memory);
}

export function touchMemories<M extends MemoryEvidence>(
  memories: readonly M[],
  selectedIds: readonly string[],
  tick: number,
): M[] {
  const selected = new Set(selectedIds);
  return memories.map((memory) =>
    selected.has(memory.id) ? { ...memory, lastAccessTick: tick } : memory,
  );
}
