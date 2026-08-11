import { compareStrings } from './order.js';

export interface EvaluationEvent {
  type: string;
  subtype?: string;
}

export interface CharacterScorecard {
  decisions: number;
  invalidPlans: number;
  fallbacks: number;
  capabilityKindsUsed: Record<string, number>;
}

export function characterScorecard(
  decisionKinds: readonly (readonly string[])[],
  events: readonly EvaluationEvent[],
): CharacterScorecard {
  const capabilityKindsUsed: Record<string, number> = {};
  for (const kinds of decisionKinds) {
    for (const kind of kinds) capabilityKindsUsed[kind] = (capabilityKindsUsed[kind] ?? 0) + 1;
  }
  return {
    decisions: decisionKinds.length,
    invalidPlans: events.filter((event) => event.subtype === 'PLAN_INVALID').length,
    fallbacks: events.filter((event) => event.subtype === 'LLM_FALLBACK').length,
    capabilityKindsUsed: Object.fromEntries(
      Object.entries(capabilityKindsUsed).sort(([a], [b]) => compareStrings(a, b)),
    ),
  };
}
