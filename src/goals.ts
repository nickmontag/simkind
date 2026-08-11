export type GoalCriterion =
  | { kind: 'memory'; tags: string[]; about: string[]; minConfidence: number; count: number }
  | { kind: 'event'; eventType: string; involves: string[]; count: number }
  | { kind: 'inventory'; typeId: string; qty: number }
  | { kind: 'relationship'; with: string; min?: number; max?: number };

export interface Commitment {
  id: string;
  criteria: GoalCriterion[];
}

export interface CriterionMatch {
  matched: number;
  evidence: string[];
}

export interface GoalEvidenceAdapter {
  memory(criterion: Extract<GoalCriterion, { kind: 'memory' }>): CriterionMatch;
  event(criterion: Extract<GoalCriterion, { kind: 'event' }>): CriterionMatch;
  inventory(criterion: Extract<GoalCriterion, { kind: 'inventory' }>): CriterionMatch;
  relationship(criterion: Extract<GoalCriterion, { kind: 'relationship' }>): CriterionMatch;
}

export interface GoalProgress {
  met: number;
  total: number;
  complete: boolean;
  evidence: string[];
}

function matchCriterion(
  criterion: GoalCriterion,
  adapter: GoalEvidenceAdapter,
): CriterionMatch {
  switch (criterion.kind) {
    case 'memory': return adapter.memory(criterion);
    case 'event': return adapter.event(criterion);
    case 'inventory': return adapter.inventory(criterion);
    case 'relationship': return adapter.relationship(criterion);
  }
}

function requiredMatches(criterion: GoalCriterion): number {
  switch (criterion.kind) {
    case 'memory':
    case 'event':
      return criterion.count;
    case 'inventory':
      return criterion.qty;
    case 'relationship':
      return 1;
  }
}

export function evaluateCommitment(
  goal: Commitment,
  adapter: GoalEvidenceAdapter,
): GoalProgress {
  let met = 0;
  const evidence: string[] = [];
  for (const criterion of goal.criteria) {
    const match = matchCriterion(criterion, adapter);
    const required = requiredMatches(criterion);
    if (match.matched >= required) {
      met += 1;
      evidence.push(...match.evidence.slice(0, required));
    }
  }
  return {
    met,
    total: goal.criteria.length,
    complete: goal.criteria.length > 0 && met === goal.criteria.length,
    evidence,
  };
}
