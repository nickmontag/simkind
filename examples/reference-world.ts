import {
  createSimkinRuntime,
  defineCapabilityCatalog,
  evaluateCommitment,
  rankMemories,
  recordDecisionBatch,
  type CapabilityDefinition,
  type DecisionRecord,
} from '../src/index.js';

type Action =
  | { kind: 'Move'; to: string }
  | { kind: 'Speak'; to: string; topic: string }
  | { kind: 'Gather'; item: string };

interface World {
  tick: number;
  place: string;
  inventory: Record<string, number>;
  decisions: DecisionRecord<Action>[];
  log: string[];
}

const capabilities = defineCapabilityCatalog({
  Move: { description: 'Move to a known place.', examples: ['Move to the grove'] },
  Speak: { description: 'Speak to a present character.', examples: ['Ask Mira about herbs'] },
  Gather: { description: 'Gather a present resource.', examples: ['Gather mint'] },
} satisfies Record<Action['kind'], CapabilityDefinition>);

const runtime = createSimkinRuntime<World, { capabilities: typeof capabilities }, Action>({
  recordInputs(world, inputs) {
    return { ...world, decisions: recordDecisionBatch(world.decisions, world.tick, inputs) };
  },
  applyInputs(world, _context, inputs) {
    for (const input of inputs) {
      if (input.kind === 'Move') world.place = input.to;
      if (input.kind === 'Gather') {
        world.inventory[input.item] = (world.inventory[input.item] ?? 0) + 1;
      }
      world.log.push(`${world.tick}: ${input.kind}`);
    }
    return world;
  },
  expireRequests: (world) => world,
  interactions: (world) => world,
  cognition: (world) => world,
});

let world: World = { tick: 1, place: 'square', inventory: {}, decisions: [], log: [] };
world = runtime.applyInputs(world, { capabilities }, [
  { kind: 'Move', to: 'herb-grove' },
  { kind: 'Gather', item: 'mint' },
]);

const memories = rankMemories(
  [
    { id: 'm1', text: 'Mira needs mint tea', importance: 4, confidence: 1, createdTick: 0, lastAccessTick: 0, about: ['Mira'], tags: ['promise'], hops: 0 },
    { id: 'm2', text: 'Rain reached the old bridge', importance: 2, confidence: 1, createdTick: 0, lastAccessTick: 0, about: ['bridge'], tags: ['weather'], hops: 0 },
  ],
  world.tick,
  { text: 'help Mira with mint', about: 'Mira', limit: 1 },
);

const goal = evaluateCommitment(
  { id: 'bring-mint', criteria: [{ kind: 'inventory', typeId: 'mint', qty: 1 }] },
  {
    memory: () => ({ matched: 0, evidence: [] }),
    event: () => ({ matched: 0, evidence: [] }),
    inventory: (criterion) => ({ matched: world.inventory[criterion.typeId] ?? 0, evidence: [`inventory:${criterion.typeId}`] }),
    relationship: () => ({ matched: 0, evidence: [] }),
  },
);

console.log(JSON.stringify({ world, recalled: memories.map((memory) => memory.id), goal }, null, 2));
