import type { HostRegistration } from 'simkind/runner';
import { conversationHost, conversationInterventionHost } from './conversation.js';
import { settlementHost, settlementInterventionHost } from './settlement.js';
import { spatialHost } from '../../spatial/host.js';

// New launches prefer current implementations; recordings select their exact reader.
const installed = [conversationInterventionHost, settlementInterventionHost, spatialHost, conversationHost, settlementHost];
export function installedHost(contractId: string, implementationVersion?: string): HostRegistration {
  const host = installed.find(h => h.descriptor.contractId === contractId && (implementationVersion === undefined || h.descriptor.implementationVersion === implementationVersion));
  if (!host) throw new Error('Requested host implementation is not installed.');
  return host;
}
