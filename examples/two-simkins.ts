import {
  createSimkinRuntime,
  evaluateCommitment,
  ModelRuntime,
  rankMemories,
  recordDecisionBatch,
  replayInputsForTick,
  resolveModelCompletion,
  simkinScorecard,
  type DecisionRecord,
  type MemoryEvidence,
  type ModelCompletion,
  type ModelRequest,
} from '../src/index.js';

type SimkinId = 'aya' | 'mira';
type Place = 'square' | 'grove';

type Intent =
  | { kind: 'Move'; to: Place }
  | { kind: 'Gather'; item: 'mint' }
  | { kind: 'Give'; to: SimkinId; item: 'mint' }
  | { kind: 'Wait' };

export interface ScenarioRequest extends ModelRequest {
  simkinId: SimkinId;
  snapshot: {
    place: Place;
    mint: number;
    groveMint: number;
    miraPlace: Place;
    commitmentComplete: boolean;
    recalledMemoryIds: string[];
    /** Full supplied evidence; optional for historical saved requests. */
    recalledMemories?: MemoryEvidence[];
  };
}

export interface ScenarioInput {
  requestId: string;
  simkinId: SimkinId;
  intent: Intent;
  fallback?: 'invalid-output' | 'provider-error';
}

interface SimkinState {
  id: SimkinId;
  place: Place;
  mint: number;
  memories: MemoryEvidence[];
  commitmentComplete: boolean;
}

interface Transfer {
  from: SimkinId;
  to: SimkinId;
  item: 'mint';
}

interface ScenarioWorld {
  tick: number;
  groveMint: number;
  simkins: Record<SimkinId, SimkinState>;
  requests: Record<string, ScenarioRequest>;
  decisions: DecisionRecord<ScenarioInput, ScenarioRequest>[];
  transfers: Transfer[];
  log: string[];
}

export interface TwoSimkinScenarioResult {
  summary: {
    ticks: number;
    aya: { place: Place; mint: number; commitmentComplete: boolean };
    mira: { place: Place; mint: number };
    replayMatched: boolean;
    invalidPlans: number;
    fallbacks: number;
  };
  log: string[];
  decisions: DecisionRecord<ScenarioInput, ScenarioRequest>[];
}

export interface TwoSimkinScenarioOptions {
  fulfill?: (request: ScenarioRequest) => Promise<unknown>;
}

function initialWorld(): ScenarioWorld {
  return {
    tick: 0,
    groveMint: 1,
    simkins: {
      aya: {
        id: 'aya',
        place: 'square',
        mint: 0,
        memories: [{
          id: 'memory:mira-mint',
          text: 'Mira asked Aya to bring her mint.',
          importance: 5,
          confidence: 1,
          createdTick: 0,
          lastAccessTick: 0,
          about: ['mira'],
          tags: ['promise', 'mint'],
          hops: 0,
        }],
        commitmentComplete: false,
      },
      mira: {
        id: 'mira',
        place: 'square',
        mint: 0,
        memories: [],
        commitmentComplete: false,
      },
    },
    requests: {},
    decisions: [],
    transfers: [],
    log: [],
  };
}

function chooseIntent(request: ScenarioRequest): ScenarioInput {
  const { snapshot } = request;
  let intent: Intent = { kind: 'Wait' };
  if (request.simkinId === 'aya' && !snapshot.commitmentComplete) {
    if (snapshot.place === 'square' && snapshot.mint === 0 && snapshot.groveMint > 0) {
      intent = { kind: 'Move', to: 'grove' };
    } else if (snapshot.place === 'grove' && snapshot.mint === 0) {
      intent = { kind: 'Gather', item: 'mint' };
    } else if (snapshot.place === 'grove' && snapshot.mint > 0) {
      intent = { kind: 'Move', to: 'square' };
    } else if (snapshot.place === snapshot.miraPlace && snapshot.mint > 0) {
      intent = { kind: 'Give', to: 'mira', item: 'mint' };
    }
  }
  return { requestId: request.id, simkinId: request.simkinId, intent };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseModelInput(request: ScenarioRequest, value: unknown): ScenarioInput | undefined {
  if (!isRecord(value) || value.requestId !== request.id || value.simkinId !== request.simkinId) {
    return undefined;
  }
  const intent = value.intent;
  if (!isRecord(intent) || typeof intent.kind !== 'string') return undefined;
  switch (intent.kind) {
    case 'Move':
      return intent.to === 'square' || intent.to === 'grove'
        ? { requestId: request.id, simkinId: request.simkinId, intent: { kind: 'Move', to: intent.to } }
        : undefined;
    case 'Gather':
      return intent.item === 'mint'
        ? { requestId: request.id, simkinId: request.simkinId, intent: { kind: 'Gather', item: 'mint' } }
        : undefined;
    case 'Give':
      return (intent.to === 'aya' || intent.to === 'mira') && intent.item === 'mint'
        ? { requestId: request.id, simkinId: request.simkinId, intent: { kind: 'Give', to: intent.to, item: 'mint' } }
        : undefined;
    case 'Wait':
      return { requestId: request.id, simkinId: request.simkinId, intent: { kind: 'Wait' } };
    default:
      return undefined;
  }
}

function inputFromCompletion(
  completion: ModelCompletion<ScenarioRequest, unknown>,
): ScenarioInput {
  return resolveModelCompletion(
    completion,
    parseModelInput,
    (request, reason): ScenarioInput => ({
      requestId: request.id,
      simkinId: request.simkinId,
      intent: { kind: 'Wait' },
      fallback: reason,
    }),
  ).input;
}

async function fulfillScriptedRequest(request: ScenarioRequest): Promise<unknown> {
  if (request.simkinId === 'mira' && request.issuedAtTick === 1) {
    return { requestId: request.id, simkinId: request.simkinId, intent: { kind: 'Dance' } };
  }
  if (request.simkinId === 'mira' && request.issuedAtTick === 2) {
    throw new Error('scripted provider failure');
  }
  return chooseIntent(request);
}

function updateCommitment(world: ScenarioWorld): ScenarioWorld {
  const progress = evaluateCommitment(
    { id: 'bring-mint', criteria: [{ kind: 'event', eventType: 'mint-given', involves: ['mira'], count: 1 }] },
    {
      memory: () => ({ matched: 0, evidence: [] }),
      event: () => {
        const matching = world.transfers.filter(
          (transfer) => transfer.from === 'aya' && transfer.to === 'mira' && transfer.item === 'mint',
        );
        return { matched: matching.length, evidence: matching.map(() => 'transfer:aya:mira:mint') };
      },
      inventory: () => ({ matched: 0, evidence: [] }),
      relationship: () => ({ matched: 0, evidence: [] }),
    },
  );
  return {
    ...world,
    simkins: {
      ...world.simkins,
      aya: { ...world.simkins.aya, commitmentComplete: progress.complete },
    },
  };
}

function executeInputs(world: ScenarioWorld, inputs: readonly ScenarioInput[]): ScenarioWorld {
  const next = structuredClone(world);
  for (const input of inputs) {
    const request = next.requests[input.requestId];
    const simkin = next.simkins[input.simkinId];
    if (request === undefined || request.simkinId !== input.simkinId) continue;

    switch (input.intent.kind) {
      case 'Move':
        simkin.place = input.intent.to;
        break;
      case 'Gather':
        if (simkin.place === 'grove' && next.groveMint > 0) {
          simkin.mint += 1;
          next.groveMint -= 1;
        }
        break;
      case 'Give': {
        const recipient = next.simkins[input.intent.to];
        if (simkin.place === recipient.place && simkin.mint > 0) {
          simkin.mint -= 1;
          recipient.mint += 1;
          next.transfers.push({ from: simkin.id, to: recipient.id, item: 'mint' });
        }
        break;
      }
      case 'Wait':
        break;
    }
    const fallback = input.fallback === undefined ? '' : ` fallback:${input.fallback}`;
    next.log.push(`${next.tick}: ${simkin.id} ${input.intent.kind}${fallback}`);
    delete next.requests[input.requestId];
  }
  return updateCommitment(next);
}

function enqueueRequests(world: ScenarioWorld): ScenarioWorld {
  const requests = { ...world.requests };
  for (const simkin of Object.values(world.simkins)) {
    const recalled = rankMemories(simkin.memories, world.tick, {
      text: 'promise to bring Mira mint',
      about: simkin.id === 'aya' ? 'mira' : undefined,
      limit: 3,
    });
    const request: ScenarioRequest = {
      id: `request:${String(world.tick).padStart(2, '0')}:${simkin.id}`,
      issuedAtTick: world.tick,
      priority: simkin.id === 'aya' ? 10 : 1,
      simkinId: simkin.id,
      snapshot: {
        place: simkin.place,
        mint: simkin.mint,
        groveMint: world.groveMint,
        miraPlace: world.simkins.mira.place,
        commitmentComplete: simkin.commitmentComplete,
        recalledMemoryIds: recalled.map((memory) => memory.id),
        recalledMemories: structuredClone(recalled),
      },
    };
    requests[request.id] = request;
  }
  return { ...world, requests };
}

function createRuntime() {
  return createSimkinRuntime<ScenarioWorld, undefined, ScenarioInput>({
    recordInputs(world, inputs) {
      return {
        ...world,
        decisions: recordDecisionBatch(
          world.decisions,
          world.tick,
          inputs,
          (input) => world.requests[input.requestId],
        ),
      };
    },
    applyInputs: (world, _context, inputs) => executeInputs(world, inputs),
    expireRequests: (world) => world,
    interactions: (world) => world,
    cognition: (world) => enqueueRequests(updateCommitment(world)),
  });
}

function observableState(world: ScenarioWorld) {
  return {
    tick: world.tick,
    groveMint: world.groveMint,
    simkins: Object.fromEntries(
      Object.entries(world.simkins).map(([id, simkin]) => [id, {
        place: simkin.place,
        mint: simkin.mint,
        commitmentComplete: simkin.commitmentComplete,
      }]),
    ),
    transfers: world.transfers,
  };
}

function replay(decisions: readonly DecisionRecord<ScenarioInput, ScenarioRequest>[]): ScenarioWorld {
  let world = initialWorld();
  for (let tick = 0; tick < 4; tick += 1) {
    const records = decisions.filter((record) => record.appliedTick === tick);
    world = {
      ...world,
      requests: Object.fromEntries(
        records.flatMap((record) => record.request === undefined ? [] : [[record.request.id, record.request]]),
      ),
    };
    world = executeInputs(world, replayInputsForTick(decisions, tick));
    world = { ...world, tick: tick + 1 };
  }
  return world;
}

export async function runTwoSimkinScenario(
  options: TwoSimkinScenarioOptions = {},
): Promise<TwoSimkinScenarioResult> {
  const runtime = createRuntime();
  const model = new ModelRuntime<ScenarioRequest, unknown>(
    options.fulfill ?? fulfillScriptedRequest,
  );
  let world = runtime.advanceCognition(initialWorld(), undefined);

  for (let tick = 0; tick < 4; tick += 1) {
    model.poll(Object.values(world.requests));
    await model.settled();
    const inputs = model.poll([]).map(inputFromCompletion);
    world = runtime.applyInputs(world, undefined, inputs);
    world = runtime.advanceInteractions(world, undefined);
    world = { ...world, tick: tick + 1 };
    if (tick < 3) world = runtime.advanceCognition(world, undefined);
  }

  const replayed = replay(world.decisions);
  const scorecard = simkinScorecard(
    world.decisions.map((decision) => [decision.input.intent.kind]),
    world.decisions.flatMap((decision) => {
      if (decision.input.fallback === 'invalid-output') {
        return [
          { type: 'plan', subtype: 'PLAN_INVALID' },
          { type: 'model', subtype: 'LLM_FALLBACK' },
        ];
      }
      return decision.input.fallback === 'provider-error'
        ? [{ type: 'model', subtype: 'LLM_FALLBACK' }]
        : [];
    }),
  );
  return {
    summary: {
      ticks: world.tick,
      aya: {
        place: world.simkins.aya.place,
        mint: world.simkins.aya.mint,
        commitmentComplete: world.simkins.aya.commitmentComplete,
      },
      mira: { place: world.simkins.mira.place, mint: world.simkins.mira.mint },
      replayMatched: JSON.stringify(observableState(replayed)) === JSON.stringify(observableState(world)),
      invalidPlans: scorecard.invalidPlans,
      fallbacks: scorecard.fallbacks,
    },
    log: world.log,
    decisions: world.decisions,
  };
}
