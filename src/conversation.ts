export interface ConversationLifecycleState {
  id: string;
  messageCount: number;
  silentTurns: number;
  lastUtteranceHour: number;
  pending: boolean;
}

export interface ConversationPolicy {
  maxMessages: number;
  maxSilentTurns: number;
  awkwardTimeoutHours: number;
  utteranceIntervalHours: number;
}

export interface ConversationObservation {
  nowHour: number;
  participantsTogether: boolean;
  quietReason?: string;
  waitingOnPlayer?: boolean;
}

export type ConversationDirective =
  | { kind: 'close'; reason: string }
  | { kind: 'hold'; reason: 'pending' | 'player' | 'cooldown' }
  | { kind: 'take-turn' };

export function conversationDirective(
  state: ConversationLifecycleState,
  policy: ConversationPolicy,
  observation: ConversationObservation,
): ConversationDirective {
  if (!observation.participantsTogether) return { kind: 'close', reason: 'interrupted' };
  if (observation.quietReason) return { kind: 'close', reason: observation.quietReason };
  if (state.messageCount >= policy.maxMessages) return { kind: 'close', reason: 'said their piece' };
  if (state.silentTurns >= policy.maxSilentTurns) return { kind: 'close', reason: 'awkwardly' };
  if (state.pending) return { kind: 'hold', reason: 'pending' };
  if (observation.waitingOnPlayer) return { kind: 'hold', reason: 'player' };
  const elapsed = observation.nowHour - state.lastUtteranceHour;
  if (elapsed >= policy.awkwardTimeoutHours) return { kind: 'close', reason: 'awkwardly' };
  if (elapsed < policy.utteranceIntervalHours) return { kind: 'hold', reason: 'cooldown' };
  return { kind: 'take-turn' };
}
