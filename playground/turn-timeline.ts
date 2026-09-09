import type { RunEvent } from 'simkind/format';
import { recordedEconomyReports, type EconomyReport } from '../examples/economy/report.js';

import { recordedShopReports, type ShopReport } from '../examples/fabrication/report.js';

export interface TurnFrame { report: EconomyReport | ShopReport; sequence: number }
export function shopFrames(events: readonly RunEvent[], live?: ShopReport): TurnFrame[] {
  const turns = new Map<number, TurnFrame>();
  for (const event of events) for (const report of recordedShopReports([event])) turns.set(report.tick, { report, sequence: event.sequence });
  if (live) turns.set(live.tick, { report: live, sequence: events.at(-1)?.sequence ?? -1 });
  return [...turns.values()].sort((a, b) => a.report.tick - b.report.tick);
}

export interface EconomyFrame { report: EconomyReport; sequence: number }
/** One completed snapshot per turn; a live frame may be partially resolved. */
export function economyFrames(events: readonly RunEvent[], live?: EconomyReport): EconomyFrame[] {
  const turns = new Map<number, EconomyFrame>();
  for (const event of events) {
    if (event.type !== 'observation') continue;
    for (const report of recordedEconomyReports([event])) turns.set(report.tick, { report, sequence: event.sequence });
  }
  if (live) turns.set(live.tick, { report: live, sequence: events.at(-1)?.sequence ?? -1 });
  return [...turns.values()].sort((a, b) => a.report.tick - b.report.tick);
}

/** Returning to the last recorded turn does not implicitly resume generation. */
export class TurnCursor {
  private tick: number | undefined;
  follow() { this.tick = undefined; }
  get following() { return this.tick === undefined; }
  index(frames: readonly { report: { tick: number } }[]) {
    if (this.following) return Math.max(0, frames.length - 1);
    const index = frames.findIndex(frame => frame.report.tick === this.tick);
    return Math.max(0, index);
  }
  seek(frames: readonly { report: { tick: number } }[], index: number) {
    this.tick = frames[Math.max(0, Math.min(frames.length - 1, index))]?.report.tick;
  }
  next(frames: readonly { report: { tick: number } }[], live: boolean): 'generate' | 'recorded' | 'end' {
    if (live && this.following) return 'generate';
    return this.index(frames) < frames.length - 1 ? 'recorded' : 'end';
  }
}
