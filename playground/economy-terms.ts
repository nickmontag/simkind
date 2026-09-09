/** Human-readable quality, distinguishing contract minimums from actual delivery. */
export function toolQuality(minimum?: unknown, delivered?: unknown): string {
  if (Array.isArray(delivered) && delivered.length && delivered.every(n => Number.isInteger(n) && n >= 1 && n <= 4)) {
    return delivered.every(n => n === 4) ? ' (fresh)' : ` (uses remaining: ${delivered.join(', ')})`;
  }
  return minimum === 4 ? ' (fresh)' : typeof minimum === 'number' && Number.isInteger(minimum) && minimum > 1 && minimum < 4 ? ` (at least ${minimum} uses)` : '';
}
