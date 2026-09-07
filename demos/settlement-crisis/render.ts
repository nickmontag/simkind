import { settlementReport } from './engine.js';
import type { SettlementProvider, SettlementState } from './types.js';

const bold = '\x1b[1m';
const dim = '\x1b[2m';
const reset = '\x1b[0m';

function pad(value: string | number, width: number): string {
  return String(value).padEnd(width).slice(0, width);
}

export function renderSettlement(state: SettlementState, provider: SettlementProvider): string {
  const report = settlementReport(state);
  const rows = Object.values(state.simkins).map((simkin) => [
    pad(simkin.id, 5),
    pad(simkin.role, 9),
    pad(simkin.place, 10),
    `F${simkin.inventory.food} W${simkin.inventory.water} M${simkin.inventory.medicine} P${simkin.inventory.parts}`,
    `hun ${simkin.hunger} thr ${simkin.thirst} ill ${simkin.illness}`,
  ].join('  '));
  const usage = provider.usage === undefined
    ? ''
    : `  ${dim}${provider.usage.requests} calls · ${provider.usage.totalTokens} tokens · $${provider.usage.cost.toFixed(6)}${reset}`;
  return [
    `${bold}SIMKIND · SETTLEMENT CRISIS${reset}  ${dim}prototype${reset}`,
    `${bold}Tick ${state.tick}/30${reset}  provider: ${provider.name}${usage}`,
    `pump ${pad(`${state.pumpHealth}%`, 5)}  bridge ${state.bridgeOpen ? 'open  ' : 'CLOSED'}  reservoir ${state.reservoirWater} water  notices ${state.notices.join(', ') || 'none'}`,
    '',
    `${bold}SIMKIN  ROLE       PLACE       INVENTORY       NEEDS${reset}`,
    ...rows,
    '',
    `${bold}OUTCOMES${reset}  rejected ${report.rejected}  fallbacks ${report.fallbacks}  requests fulfilled ${report.fulfilledRequests}  trust Δ ${report.trustDelta}`,
    `${bold}PRESSURE${reset}  illness ${report.metrics.untreatedIllnessTicks}  food ${report.metrics.foodDeficitTicks}  water ${report.metrics.waterDeficitTicks}  pump-down ${report.metrics.pumpDowntimeTicks}`,
    '',
    `${bold}RECENT EVENTS${reset}`,
    ...state.recentEvents.slice(-8).map((event) => `  ${event}`),
    '',
    `${bold}[n]${reset}${dim} next tick${reset}  ${bold}[r]${reset}${dim} run 5${reset}  ${bold}[a]${reset}${dim} run to 30${reset}  ${bold}[q]${reset}${dim} quit${reset}`,
  ].join('\n');
}
