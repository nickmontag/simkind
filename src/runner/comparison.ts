import { canonicalJson, validateDocument, validateRecord, validateTime, type RunBundle, type RunEvent } from '../format/index.js';
import { compareRuns, validateCheckpoint, type RunnerCheckpoint } from './checkpoint.js';

export interface BranchEvidence { manifest: RunBundle; events: readonly RunEvent[]; parent: RunnerCheckpoint }

/** Compare sibling continuations after proving their exact shared checkpoint. No tick alignment or causal claims. */
export function compareBranches(left: BranchEvidence, right: BranchEvidence) {
  for (const branch of [left, right]) {
    validateCheckpoint(branch.parent);
    const { manifest, events, parent } = branch;
    if (!validateDocument(manifest).ok || manifest.parent?.runId !== parent.launch.runId || manifest.parent.checkpointId !== parent.id || manifest.runId === parent.launch.runId) throw new Error('Comparison requires a recorded child and its exact parent checkpoint.');
    const ids = new Set<string>();
    for (const [sequence, event] of events.entries()) {
      if (validateRecord('RunEvent', event).length || validateTime(event.time, manifest.clocks).length || event.runId !== manifest.runId || event.sequence !== sequence || ids.has(event.id)) throw new Error('Invalid continuation evidence.');
      ids.add(event.id);
    }
  }
  if (left.manifest.runId === right.manifest.runId) throw new Error('Choose two different continuations.');
  if (canonicalJson(left.parent) !== canonicalJson(right.parent)) throw new Error('Continuations do not share the exact same parent checkpoint.');
  const totals = compareRuns(left.events, right.events);
  return {
    kind: 'sibling-continuations' as const,
    sharedPrefix: { runId: left.parent.launch.runId, checkpointId: left.parent.id, eventCount: left.parent.events.length },
    left: { runId: left.manifest.runId, totals: totals.left, events: structuredClone([...left.events]) },
    right: { runId: right.manifest.runId, totals: totals.right, events: structuredClone([...right.events]) },
  };
}
