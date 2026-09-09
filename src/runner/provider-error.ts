const reasons = ['HTTP_ERROR', 'NETWORK_ERROR', 'INVALID_RESPONSE', 'OUTPUT_LIMIT', 'MISSING_OUTPUT'] as const;
export type ProviderFailureReason = typeof reasons[number];
export interface ProviderDiagnostic {
  reason: ProviderFailureReason;
  httpStatus?: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  cost?: number;
}

/** Portable failure evidence contains only known categories and numeric metadata.
 * Never copy arbitrary exception messages, response bodies, URLs, or headers. */
export class ProviderFailure extends Error {
  readonly diagnostic: ProviderDiagnostic;
  constructor(reason: ProviderFailureReason, metadata: Omit<ProviderDiagnostic, 'reason'> = {}) {
    super(reason === 'HTTP_ERROR' && metadata.httpStatus ? `Provider request failed with HTTP ${metadata.httpStatus}.` : `Provider failed: ${reason}.`);
    this.diagnostic = { reason: reasons.includes(reason) ? reason : 'INVALID_RESPONSE' };
    for (const key of ['httpStatus', 'inputTokens', 'outputTokens', 'reasoningTokens', 'cachedInputTokens', 'cost'] as const) {
      const value = metadata[key];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) this.diagnostic[key] = value;
    }
    Object.freeze(this.diagnostic);
  }
}
