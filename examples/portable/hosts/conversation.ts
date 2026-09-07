import type { HostDescriptor, HostRegistration, PreparedLaunch } from 'simkind/runner';
import type { ActionProposal, JsonValue, ToolCatalog } from 'simkind/format';
import { LocalHost, limits, capabilities, clocks, type WorldEdit } from './support.js';

export const conversationCatalog: ToolCatalog = {
  specVersion: '0.2.0-draft.2', kind: 'tool-catalog', id: 'catalog:conversation',
  host: { contractId: 'example.conversation', version: '1.0.0' },
  tools: [
    { id: 'say', version: '1.0.0', description: 'Say something to the group or privately to one participant. Speech does not cast a vote.',
      inputSchema: { type: 'object', additionalProperties: false, required: ['text', 'to'], properties: { text: { type: 'string', maxLength: 4000 }, to: { type: ['string', 'null'] } } }, lifecycle: { asynchronous: false, cancellable: false } },
    { id: 'vote', version: '1.0.0', description: 'Record or revise your vote for one of the offered options. No agreement is required.',
      inputSchema: { type: 'object', additionalProperties: false, required: ['option'], properties: { option: { type: 'string' } } }, lifecycle: { asynchronous: false, cancellable: false } },
  ],
};
interface World { sharedContext: string; options: string[]; messages: { from: string; to: string | null; text: string }[]; votes: Record<string, string> }
class ConversationHost extends LocalHost<World> {
  constructor(launch: PreparedLaunch, descriptor = conversationHost.descriptor) {
    const initial = launch.scenario.initialConditions;
    super(launch, descriptor, { sharedContext: initial.sharedContext as string, options: initial.options as string[], messages: [], votes: {} });
  }
  observe(actor: string) {
    return this.observation(actor, { sharedContext: this.world.sharedContext, options: this.world.options,
      participants: this.actors, messages: this.world.messages.filter((message) => message.to === null || message.to === actor || message.from === actor), votes: this.world.votes });
  }
  protected validate(world: World, proposal: ActionProposal) {
    if (proposal.toolId === 'say' && proposal.arguments.to !== null && !this.actors.includes(proposal.arguments.to as string)) return 'Recipient is not in this conversation.';
    if (proposal.toolId === 'vote' && !world.options.includes(proposal.arguments.option as string)) return 'Choose an offered option.';
    return undefined;
  }
  protected apply(world: World, proposal: ActionProposal) {
    const next = structuredClone(world);
    if (proposal.toolId === 'say') next.messages.push({ from: proposal.actor, to: proposal.arguments.to as string | null, text: proposal.arguments.text as string });
    if (proposal.toolId === 'vote') Object.defineProperty(next.votes, proposal.actor, { value: proposal.arguments.option, enumerable: true, writable: true, configurable: true });
    return next;
  }
  protected result(proposal: ActionProposal): JsonValue { return { toolId: proposal.toolId, ...proposal.arguments }; }
  protected editWorld(world: World, proposal: ActionProposal): WorldEdit<World> {
    if (proposal.toolId === 'operator.message') {
      const to = proposal.arguments.to as string | null;
      if (to !== null && !this.actors.includes(to)) return { reason: 'Recipient is not in this conversation.' };
      const message = { from: proposal.actor, to, text: proposal.arguments.text as string };
      world.messages.push(message);
      return { world, effects: { message } };
    }
    const before = world.sharedContext;
    world.sharedContext = proposal.arguments.text as string;
    return { world, effects: { sharedContext: { before, after: world.sharedContext } } };
  }
}
export const conversationHost: HostRegistration = {
  descriptor: { contractId: 'example.conversation', version: '1.0.0', implementationVersion: '1.0.0',
    toolCatalog: conversationCatalog, limits, capabilities, clocks: [...clocks],
    initialConditionsSchema: { type: 'object', additionalProperties: false, required: ['sharedContext', 'options'],
      properties: { sharedContext: { type: 'string' }, options: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string' } } } } },
  create: (launch) => new ConversationHost(launch),
  restore: (launch, snapshot) => { const host = new ConversationHost(launch); host.restore(snapshot); return host; },
};

/** Explicit opt-in implementation; the 1.0.0 registration remains an exact replay reader. */
const interventionDescriptor: HostDescriptor = { ...conversationHost.descriptor, implementationVersion: '1.1.0', interventions: [
  { id: 'operator.message', version: '1.0.0', description: 'Deliver an attributed operator message to everyone or one participant.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['text', 'to'], properties: {
      text: { type: 'string', title: 'Message', minLength: 1, maxLength: 4000 }, to: { type: ['string', 'null'], title: 'Recipient (null for everyone)' },
    } } },
  { id: 'operator.context', version: '1.0.0', description: 'Replace the situation visible to every participant, preserving messages and votes.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string', title: 'Shared situation', maxLength: 16000 } } } },
] };
export const conversationInterventionHost: HostRegistration = {
  descriptor: interventionDescriptor,
  create: launch => new ConversationHost(launch, interventionDescriptor),
  restore: (launch, snapshot) => { const host = new ConversationHost(launch, interventionDescriptor); host.restore(snapshot); return host; },
};
