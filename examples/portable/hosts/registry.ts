import type { HostRegistration } from 'simkind/runner';
import { conversationHost, conversationInterventionHost, conversationPerceptionHost } from './conversation.js';
import { settlementHost, settlementInterventionHost, settlementPerceptionHost } from './settlement.js';
import { spatialHost } from '../../spatial/host.js';
import { economyHost, economyPerceptionHost } from '../../economy/host.js';
import { fabricationHost, fabricationPerceptionHost, fabricationGuidedHost } from '../../fabrication/host.js';

// New launches prefer current implementations; recordings select their exact reader.
const installed = [conversationPerceptionHost, settlementPerceptionHost, economyPerceptionHost, fabricationGuidedHost, fabricationPerceptionHost, conversationInterventionHost, settlementInterventionHost, spatialHost, economyHost, fabricationHost, conversationHost, settlementHost];
export function installedHost(contractId: string, implementationVersion?: string): HostRegistration {
  const host = installed.find(h => h.descriptor.contractId === contractId && (implementationVersion === undefined || h.descriptor.implementationVersion === implementationVersion));
  if (!host) throw new Error('Requested host implementation is not installed.');
  return host;
}
