import {
  createSimkinRuntime,
  defineCapabilityCatalog,
  ModelRuntime,
  recordDecisionBatch,
  type CapabilityDefinition,
  type DecisionRecord,
  type ModelRequest,
} from '../src/index.js';

type Intent =
  | { kind: 'Stabilize'; system: 'oxygen' }
  | { kind: 'Broadcast'; message: string };

interface StationRequest extends ModelRequest {
  simkinId: string;
}

interface ModelInput {
  requestId: string;
  intent: Intent;
}

interface StationWorld {
  tick: number;
  oxygen: number;
  requests: Record<string, StationRequest>;
  decisions: DecisionRecord<ModelInput, StationRequest>[];
  log: string[];
}

const capabilities = defineCapabilityCatalog({
  Stabilize: { description: 'Stabilize a failing station system.', examples: ['Stabilize oxygen'] },
  Broadcast: { description: 'Send a message to the crew.', examples: ['Broadcast a safety update'] },
} satisfies Record<Intent['kind'], CapabilityDefinition>);

class StationAdapter {
  private readonly passiveOxygenRecovery = 1;

  recordInputs(world: StationWorld, inputs: readonly ModelInput[]): StationWorld {
    return {
      ...world,
      decisions: recordDecisionBatch(
        world.decisions,
        world.tick,
        inputs,
        (input) => world.requests[input.requestId],
      ),
    };
  }

  applyInputs(world: StationWorld, _context: typeof capabilities, inputs: readonly ModelInput[]): StationWorld {
    let oxygen = world.oxygen;
    const log = [...world.log];
    for (const input of inputs) {
      if (world.requests[input.requestId] === undefined) {
        log.push(`rejected unknown request ${input.requestId}`);
        continue;
      }
      if (input.intent.kind === 'Stabilize') oxygen = Math.min(100, oxygen + 20);
      if (input.intent.kind === 'Broadcast') log.push(input.intent.message);
    }
    return { ...world, oxygen, log };
  }

  expireRequests(world: StationWorld): StationWorld {
    return world;
  }

  interactions(world: StationWorld): StationWorld {
    return { ...world, oxygen: Math.min(100, world.oxygen + this.passiveOxygenRecovery) };
  }

  cognition(world: StationWorld): StationWorld {
    return world;
  }
}

const request: StationRequest = {
  id: 'station-request:1',
  priority: 10,
  issuedAtTick: 4,
  simkinId: 'engineer-aya',
};
const model = new ModelRuntime<StationRequest, ModelInput>(async (pending) => ({
  requestId: pending.id,
  intent: { kind: 'Stabilize', system: 'oxygen' },
}));

model.poll([request]);
await model.settled();
const inputs = model.poll([]).flatMap((completion) =>
  completion.status === 'fulfilled' ? [completion.input] : [],
);

const runtime = createSimkinRuntime<StationWorld, typeof capabilities, ModelInput>(
  new StationAdapter(),
);
let world: StationWorld = {
  tick: 5,
  oxygen: 45,
  requests: { [request.id]: request },
  decisions: [],
  log: [],
};
world = runtime.applyInputs(world, capabilities, inputs);
world = runtime.advanceInteractions(world, capabilities);

console.log(JSON.stringify(world, null, 2));
