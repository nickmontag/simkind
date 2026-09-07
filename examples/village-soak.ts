import {
  advanceSimkinTick,
  conversationDirective,
  createSimkinRuntime,
  evaluateCommitment,
  executeHostInputs,
  ModelRuntime,
  rankMemories,
  recordDecisionBatch,
  recordDecisionOutcomes,
  replayInputsForTick,
  resolveModelCompletion,
  type ConversationLifecycleState,
  type DecisionRecord,
  type HostExecutionOutcome,
  type MemoryEvidence,
  type ModelCompletion,
  type ModelRequest,
} from '../src/index.js';

type SimkinId = 'aya' | 'mira';
type Place = 'square' | 'grove';

type VillageIntent =
  | { kind: 'Move'; to: Place }
  | { kind: 'Gather'; item: 'mint' }
  | { kind: 'Give'; to: SimkinId; item: 'mint' }
  | { kind: 'Speak'; to: SimkinId; topic: 'mint-location'; message: string }
  | { kind: 'Brew'; item: 'mint-tea' }
  | { kind: 'Wait' };

export interface VillageRequest extends ModelRequest {
  simkinId: SimkinId;
  attempt: number;
  readyAtTick: number;
  snapshot: {
    place: Place;
    mint: number;
    groveMint: number;
    otherPlace: Place;
    recalledMemoryIds: string[];
    /** Full supplied evidence; optional for historical saved requests. */
    recalledMemories?: MemoryEvidence[];
    ayaKnowsMintLocation: boolean;
    ayaPromiseComplete: boolean;
    miraTeaGoalComplete: boolean;
  };
}

interface VillageInput {
  requestId: string;
  simkinId: SimkinId;
  request: VillageRequest;
  intent: VillageIntent;
  fallbackReason?: 'provider-error' | 'invalid-output' | 'timeout';
}

interface VillageSimkin {
  id: SimkinId;
  place: Place;
  mint: number;
  memories: MemoryEvidence[];
  ayaPromiseComplete: boolean;
  miraTeaGoalComplete: boolean;
}

interface VillageEvent {
  id: string;
  type: 'mint-given' | 'tea-brewed';
  from?: SimkinId;
  to?: SimkinId;
}

type VillageDecision = DecisionRecord<VillageInput, VillageRequest, HostExecutionOutcome>;

interface VillageWorld {
  tick: number;
  groveMint: number;
  simkins: Record<SimkinId, VillageSimkin>;
  requests: Record<string, VillageRequest>;
  requestCounts: Record<SimkinId, number>;
  decisions: VillageDecision[];
  events: VillageEvent[];
  conversation: ConversationLifecycleState;
  conversationOpen: boolean;
  log: string[];
}

export interface VillageSoakReport {
  ticks: number;
  goals: {
    ayaPromiseComplete: boolean;
    ayaPersonalMintGoalComplete: boolean;
    miraTeaGoalComplete: boolean;
  };
  goalCompletionTicks: {
    ayaPromise: number | null;
    miraTea: number | null;
  };
  modelRequests: number;
  applied: number;
  rejected: number;
  fallbacks: number;
  timeouts: number;
  lateCompletionsRejected: number;
  rejectionReasons: Record<string, number>;
  conversationMemoriesCreated: number;
  recalledMemoryDecisions: number;
  /** @deprecated Co-occurrence only; use recalledMemoryDecisions. */
  memoryInfluencedDecisions: number;
  repeatedActions: number;
  stalledTicks: number;
  maxPendingRequests: number;
  maxProviderInFlight: number;
  pendingRequestsAtEnd: number;
  persistedBytes: number;
  reloadedAtTick: number;
  pendingRequestsAtSave: number;
  replayMatched: boolean;
  reloadMatched: boolean;
}

export interface VillageSoakResult {
  report: VillageSoakReport;
  log: string[];
  decisions: VillageDecision[];
}

export type VillageLiveReport = Omit<
  VillageSoakReport,
  'persistedBytes' | 'reloadedAtTick' | 'pendingRequestsAtSave' | 'reloadMatched'
>;

export interface VillageLiveResult {
  report: VillageLiveReport;
  log: string[];
  decisions: VillageDecision[];
}

const conversationPolicy = {
  maxMessages: 1,
  maxSilentTurns: 2,
  awkwardTimeoutHours: 4,
  utteranceIntervalHours: 0,
};

function initialWorld(): VillageWorld {
  return {
    tick: 0,
    groveMint: 1,
    simkins: {
      aya: {
        id: 'aya',
        place: 'square',
        mint: 0,
        memories: [],
        ayaPromiseComplete: false,
        miraTeaGoalComplete: false,
      },
      mira: {
        id: 'mira',
        place: 'square',
        mint: 0,
        memories: [{
          id: 'memory:mint-location',
          text: 'Mint grows in the grove.',
          importance: 4,
          confidence: 1,
          createdTick: 0,
          lastAccessTick: 0,
          about: ['grove'],
          tags: ['mint', 'location'],
          source: 'world',
          hops: 0,
        }],
        ayaPromiseComplete: false,
        miraTeaGoalComplete: false,
      },
    },
    requests: {},
    requestCounts: { aya: 0, mira: 0 },
    decisions: [],
    events: [],
    conversation: {
      id: 'conversation:aya:mira',
      messageCount: 0,
      silentTurns: 0,
      lastUtteranceHour: -10,
      pending: false,
    },
    conversationOpen: true,
    log: [],
  };
}

function updateGoals(world: VillageWorld): VillageWorld {
  const aya = evaluateCommitment(
    { id: 'aya-bring-mint', criteria: [{ kind: 'event', eventType: 'mint-given', involves: ['mira'], count: 1 }] },
    {
      memory: () => ({ matched: 0, evidence: [] }),
      event: () => {
        const events = world.events.filter((event) => event.type === 'mint-given' && event.to === 'mira');
        return { matched: events.length, evidence: events.map((event) => event.id) };
      },
      inventory: () => ({ matched: 0, evidence: [] }),
      relationship: () => ({ matched: 0, evidence: [] }),
    },
  );
  const mira = evaluateCommitment(
    { id: 'mira-brew-tea', criteria: [{ kind: 'event', eventType: 'tea-brewed', involves: ['mira'], count: 1 }] },
    {
      memory: () => ({ matched: 0, evidence: [] }),
      event: () => {
        const events = world.events.filter((event) => event.type === 'tea-brewed' && event.from === 'mira');
        return { matched: events.length, evidence: events.map((event) => event.id) };
      },
      inventory: () => ({ matched: 0, evidence: [] }),
      relationship: () => ({ matched: 0, evidence: [] }),
    },
  );
  return {
    ...world,
    simkins: {
      aya: { ...world.simkins.aya, ayaPromiseComplete: aya.complete },
      mira: { ...world.simkins.mira, miraTeaGoalComplete: mira.complete },
    },
  };
}

function requestDelay(simkinId: SimkinId, attempt: number): number {
  if (simkinId === 'aya' && attempt === 2) return 5;
  return simkinId === 'aya' ? 1 : 1;
}

function enqueueRequests(world: VillageWorld): VillageWorld {
  const requests = { ...world.requests };
  const requestCounts = { ...world.requestCounts };
  for (const simkinId of ['aya', 'mira'] as const) {
    const simkin = world.simkins[simkinId];
    const active = simkinId === 'aya'
      ? !simkin.ayaPromiseComplete
      : !simkin.miraTeaGoalComplete;
    if (!active || Object.values(requests).some((request) => request.simkinId === simkinId)) continue;
    const recalled = rankMemories(simkin.memories, world.tick, {
      text: 'where to find mint for Mira tea',
      limit: 4,
    });
    const attempt = requestCounts[simkinId];
    const request: VillageRequest = {
      id: `request:${String(world.tick).padStart(2, '0')}:${simkinId}:${attempt}`,
      priority: simkinId === 'aya' ? 10 : 5,
      issuedAtTick: world.tick,
      simkinId,
      attempt,
      readyAtTick: world.tick + requestDelay(simkinId, attempt),
      snapshot: {
        place: simkin.place,
        mint: simkin.mint,
        groveMint: world.groveMint,
        otherPlace: world.simkins[simkinId === 'aya' ? 'mira' : 'aya'].place,
        recalledMemoryIds: recalled.map((memory) => memory.id),
        recalledMemories: structuredClone(recalled),
        ayaKnowsMintLocation: world.simkins.aya.memories.some(
          (memory) => memory.tags.includes('mint') && memory.tags.includes('location'),
        ),
        ayaPromiseComplete: world.simkins.aya.ayaPromiseComplete,
        miraTeaGoalComplete: world.simkins.mira.miraTeaGoalComplete,
      },
    };
    requests[request.id] = request;
    requestCounts[simkinId] += 1;
  }
  return { ...world, requests, requestCounts };
}

function chooseIntent(request: VillageRequest): VillageIntent {
  const snapshot = request.snapshot;
  if (request.simkinId === 'mira') {
    if (!snapshot.ayaKnowsMintLocation && snapshot.place === snapshot.otherPlace) {
      return {
        kind: 'Speak',
        to: 'aya',
        topic: 'mint-location',
        message: 'Mint grows in the grove.',
      };
    }
    if (request.attempt === 1) return { kind: 'Gather', item: 'mint' };
    if (snapshot.mint > 0) return { kind: 'Brew', item: 'mint-tea' };
    return { kind: 'Wait' };
  }
  if (!snapshot.ayaKnowsMintLocation) return { kind: 'Wait' };
  if (snapshot.place === 'square' && snapshot.mint === 0 && snapshot.groveMint > 0) {
    return { kind: 'Move', to: 'grove' };
  }
  if (snapshot.place === 'grove' && snapshot.mint === 0) return { kind: 'Gather', item: 'mint' };
  if (snapshot.place === 'grove' && snapshot.mint > 0) return { kind: 'Move', to: 'square' };
  if (snapshot.place === snapshot.otherPlace && snapshot.mint > 0) {
    return { kind: 'Give', to: 'mira', item: 'mint' };
  }
  return { kind: 'Wait' };
}

class ScheduledProvider {
  private readonly pending = new Map<
    string,
    { request: VillageRequest; resolve: (input: unknown) => void }
  >();
  maxInFlight = 0;

  fulfill = (request: VillageRequest): Promise<unknown> => new Promise((resolve) => {
    this.pending.set(request.id, { request, resolve });
    this.maxInFlight = Math.max(this.maxInFlight, this.pending.size);
  });

  advance(tick: number): void {
    for (const [id, pending] of this.pending) {
      if (pending.request.readyAtTick > tick) continue;
      pending.resolve({
        requestId: pending.request.id,
        simkinId: pending.request.simkinId,
        intent: chooseIntent(pending.request),
      });
      this.pending.delete(id);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseCompletion(request: VillageRequest, value: unknown): VillageInput | undefined {
  if (!isRecord(value) || value.requestId !== request.id || value.simkinId !== request.simkinId) {
    return undefined;
  }
  const intent = value.intent;
  if (!isRecord(intent) || typeof intent.kind !== 'string') return undefined;
  let parsed: VillageIntent;
  switch (intent.kind) {
    case 'Move':
      if (intent.to !== 'square' && intent.to !== 'grove') return undefined;
      parsed = { kind: 'Move', to: intent.to };
      break;
    case 'Gather':
      if (intent.item !== 'mint') return undefined;
      parsed = { kind: 'Gather', item: 'mint' };
      break;
    case 'Give':
      if ((intent.to !== 'aya' && intent.to !== 'mira') || intent.item !== 'mint') return undefined;
      parsed = { kind: 'Give', to: intent.to, item: 'mint' };
      break;
    case 'Speak':
      if (
        (intent.to !== 'aya' && intent.to !== 'mira') ||
        intent.topic !== 'mint-location' ||
        typeof intent.message !== 'string'
      ) return undefined;
      parsed = {
        kind: 'Speak',
        to: intent.to,
        topic: 'mint-location',
        message: intent.message,
      };
      break;
    case 'Brew':
      if (intent.item !== 'mint-tea') return undefined;
      parsed = { kind: 'Brew', item: 'mint-tea' };
      break;
    case 'Wait':
      parsed = { kind: 'Wait' };
      break;
    default:
      return undefined;
  }
  return {
    requestId: request.id,
    simkinId: request.simkinId,
    request,
    intent: parsed,
  };
}

function inputFromCompletion(
  completion: ModelCompletion<VillageRequest, unknown>,
): VillageInput {
  return resolveModelCompletion(
    completion,
    parseCompletion,
    (request, reason): VillageInput => ({
      requestId: request.id,
      simkinId: request.simkinId,
      request,
      intent: { kind: 'Wait' },
      fallbackReason: reason,
    }),
  ).input;
}

function timeoutInputs(
  world: VillageWorld,
  completedRequestIds: ReadonlySet<string>,
): VillageInput[] {
  return Object.values(world.requests)
    .filter(
      (request) =>
        world.tick - request.issuedAtTick >= 3 && !completedRequestIds.has(request.id),
    )
    .map((request) => ({
      requestId: request.id,
      simkinId: request.simkinId,
      request,
      intent: { kind: 'Wait' as const },
      fallbackReason: 'timeout' as const,
    }));
}

function validateInput(world: VillageWorld, input: VillageInput) {
  const pending = world.requests[input.requestId];
  if (pending === undefined) return { ok: false as const, reason: 'request no longer pending' };
  if (pending.simkinId !== input.simkinId) return { ok: false as const, reason: 'request simkin mismatch' };
  const simkin = world.simkins[input.simkinId];
  switch (input.intent.kind) {
    case 'Move':
      return { ok: true as const };
    case 'Gather':
      if (simkin.place !== 'grove') return { ok: false as const, reason: 'mint can only be gathered at grove' };
      if (world.groveMint <= 0) return { ok: false as const, reason: 'no mint remains' };
      return { ok: true as const };
    case 'Give': {
      const recipient = world.simkins[input.intent.to];
      if (simkin.mint <= 0) return { ok: false as const, reason: 'simkin carries no mint' };
      if (simkin.place !== recipient.place) return { ok: false as const, reason: 'recipient is elsewhere' };
      return { ok: true as const };
    }
    case 'Speak': {
      const recipient = world.simkins[input.intent.to];
      if (simkin.place !== recipient.place) return { ok: false as const, reason: 'listener is elsewhere' };
      if (world.conversation.messageCount === 0) return { ok: true as const };
      const directive = conversationDirective(world.conversation, conversationPolicy, {
        nowHour: world.tick,
        participantsTogether: true,
      });
      return directive.kind === 'take-turn'
        ? { ok: true as const }
        : { ok: false as const, reason: `conversation ${directive.kind}` };
    }
    case 'Brew':
      if (input.simkinId !== 'mira') return { ok: false as const, reason: 'only Mira can brew this tea' };
      if (simkin.place !== 'square') return { ok: false as const, reason: 'tea must be brewed at square' };
      if (simkin.mint <= 0) return { ok: false as const, reason: 'brewing requires mint' };
      return { ok: true as const };
    case 'Wait':
      return { ok: true as const };
  }
}

function applyInput(world: VillageWorld, input: VillageInput): VillageWorld {
  const next = structuredClone(world);
  const simkin = next.simkins[input.simkinId];
  switch (input.intent.kind) {
    case 'Move':
      simkin.place = input.intent.to;
      break;
    case 'Gather':
      simkin.mint += 1;
      next.groveMint -= 1;
      break;
    case 'Give': {
      const recipient = next.simkins[input.intent.to];
      simkin.mint -= 1;
      recipient.mint += 1;
      next.events.push({
        id: `event:${next.tick}:mint-given`,
        type: 'mint-given',
        from: simkin.id,
        to: recipient.id,
      });
      break;
    }
    case 'Speak': {
      const recipient = next.simkins[input.intent.to];
      if (!recipient.memories.some((memory) => memory.id === 'memory:mira-told-aya-mint-location')) {
        recipient.memories.push({
          id: 'memory:mira-told-aya-mint-location',
          text: input.intent.message,
          importance: 5,
          confidence: 1,
          createdTick: next.tick,
          lastAccessTick: next.tick,
          about: ['grove'],
          tags: ['mint', 'location'],
          source: `conversation:${next.conversation.id}`,
          hops: 0,
        });
      }
      next.conversation.messageCount += 1;
      next.conversation.lastUtteranceHour = next.tick;
      break;
    }
    case 'Brew':
      simkin.mint -= 1;
      next.events.push({
        id: `event:${next.tick}:tea-brewed`,
        type: 'tea-brewed',
        from: simkin.id,
      });
      break;
    case 'Wait':
      break;
  }
  return updateGoals(next);
}

function executeInputs(
  world: VillageWorld,
  inputs: readonly VillageInput[],
  recordOutcomes: boolean,
): VillageWorld {
  const execution = executeHostInputs(world, inputs, {
    validate: validateInput,
    apply: applyInput,
    fallbackReason: (input) => input.fallbackReason,
  });
  let next = execution.world;
  const requests = { ...next.requests };
  for (const input of inputs) delete requests[input.requestId];
  next = { ...next, requests };
  if (recordOutcomes) {
    next = {
      ...next,
      decisions: recordDecisionOutcomes(next.decisions, next.tick, execution.outcomes),
    };
  }
  const log = [...next.log];
  execution.outcomes.forEach((outcome, index) => {
    const input = inputs[index];
    const reason = 'reason' in outcome ? ` (${outcome.reason})` : '';
    log.push(`${next.tick}: ${input.simkinId} ${describeIntent(input.intent)} -> ${outcome.status}${reason}`);
  });
  return { ...next, log };
}

function describeIntent(intent: VillageIntent): string {
  switch (intent.kind) {
    case 'Move': return `Move(${intent.to})`;
    case 'Gather': return `Gather(${intent.item})`;
    case 'Give': return `Give(${intent.to}, ${intent.item})`;
    case 'Speak': return `Speak(${intent.to}, ${intent.topic})`;
    case 'Brew': return `Brew(${intent.item})`;
    case 'Wait': return 'Wait';
  }
}

function advanceConversation(world: VillageWorld): VillageWorld {
  if (!world.conversationOpen) return world;
  if (world.conversation.messageCount === 0) return world;
  const directive = conversationDirective(world.conversation, conversationPolicy, {
    nowHour: world.tick,
    participantsTogether: world.simkins.aya.place === world.simkins.mira.place,
  });
  if (directive.kind !== 'close') return world;
  return {
    ...world,
    conversationOpen: false,
    log: [...world.log, `${world.tick}: conversation closed (${directive.reason})`],
  };
}

function createRuntime() {
  return createSimkinRuntime<VillageWorld, undefined, VillageInput>({
    recordInputs(world, inputs) {
      return {
        ...world,
        decisions: recordDecisionBatch(
          world.decisions,
          world.tick,
          inputs,
          (input) => input.request,
        ),
      };
    },
    applyInputs: (world, _context, inputs) => executeInputs(world, inputs, true),
    expireRequests: (world) => world,
    interactions: (world) => advanceConversation(world),
    cognition: (world) => enqueueRequests(updateGoals(world)),
  });
}

interface RunResult {
  world: VillageWorld;
  persistedBytes: number;
  maxPendingRequests: number;
  maxProviderInFlight: number;
  pendingRequestsAtSave: number;
}

async function flushCompletions(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function runVillage(reloadAtTick?: number): Promise<RunResult> {
  let world = createRuntime().advanceCognition(initialWorld(), undefined);
  let runtime = createRuntime();
  let provider = new ScheduledProvider();
  let model = new ModelRuntime<VillageRequest, unknown>(provider.fulfill, 2);
  let persistedBytes = 0;
  let maxPendingRequests = Object.keys(world.requests).length;
  let maxProviderInFlight = 0;
  let pendingRequestsAtSave = 0;

  while (world.tick < 30) {
    if (reloadAtTick === world.tick) {
      const saved = JSON.stringify(world);
      persistedBytes = saved.length;
      pendingRequestsAtSave = Object.keys(world.requests).length;
      world = JSON.parse(saved) as VillageWorld;
      runtime = createRuntime();
      provider = new ScheduledProvider();
      model = new ModelRuntime<VillageRequest, unknown>(provider.fulfill, 2);
    }

    const completions = model.poll(Object.values(world.requests));
    provider.advance(world.tick);
    await flushCompletions();
    completions.push(...model.poll([]));
    const completedIds = new Set(completions.map((completion) => completion.request.id));
    const inputs = [
      ...completions.map(inputFromCompletion),
      ...timeoutInputs(world, completedIds),
    ];
    world = advanceSimkinTick(
      runtime,
      world,
      undefined,
      inputs,
      (current) => ({ ...current, tick: current.tick + 1 }),
    );
    maxPendingRequests = Math.max(maxPendingRequests, Object.keys(world.requests).length);
    maxProviderInFlight = Math.max(maxProviderInFlight, provider.maxInFlight);
  }

  return { world, persistedBytes, maxPendingRequests, maxProviderInFlight, pendingRequestsAtSave };
}

async function runLiveVillage(
  fulfill: (request: VillageRequest) => Promise<unknown>,
): Promise<RunResult> {
  const runtime = createRuntime();
  let active = 0;
  let maxProviderInFlight = 0;
  const model = new ModelRuntime<VillageRequest, unknown>(async (request) => {
    active += 1;
    maxProviderInFlight = Math.max(maxProviderInFlight, active);
    try {
      return await fulfill(request);
    } finally {
      active -= 1;
    }
  }, 2);
  let world = runtime.advanceCognition(initialWorld(), undefined);
  let maxPendingRequests = Object.keys(world.requests).length;
  while (world.tick < 30) {
    model.poll(Object.values(world.requests));
    await model.settled();
    const inputs = model.poll([]).map(inputFromCompletion);
    world = advanceSimkinTick(
      runtime,
      world,
      undefined,
      inputs,
      (current) => ({ ...current, tick: current.tick + 1 }),
    );
    maxPendingRequests = Math.max(maxPendingRequests, Object.keys(world.requests).length);
  }
  return {
    world,
    persistedBytes: 0,
    maxPendingRequests,
    maxProviderInFlight,
    pendingRequestsAtSave: 0,
  };
}

function consequentialState(world: VillageWorld) {
  return {
    tick: world.tick,
    groveMint: world.groveMint,
    simkins: world.simkins,
    events: world.events,
    conversationOpen: world.conversationOpen,
  };
}

function replay(decisions: readonly VillageDecision[]): VillageWorld {
  let world = initialWorld();
  for (let tick = 0; tick < 30; tick += 1) {
    const records = decisions.filter((decision) => decision.appliedTick === tick);
    const requests = { ...world.requests };
    for (const record of records) {
      if (record.request === undefined) continue;
      if (record.outcome?.status === 'rejected' && record.outcome.reason === 'request no longer pending') {
        continue;
      }
      requests[record.request.id] = record.request;
    }
    world = { ...world, requests };
    world = executeInputs(world, replayInputsForTick(decisions, tick), false);
    world = advanceConversation(world);
    world = { ...world, tick: tick + 1 };
  }
  return world;
}

function coreEvaluationReport(baseline: RunResult): VillageLiveReport {
  const { world } = baseline;
  const outcomes = world.decisions.flatMap((decision) =>
    decision.outcome === undefined ? [] : [decision.outcome],
  );
  const rejectionReasons: Record<string, number> = {};
  for (const outcome of outcomes) {
    if (outcome.status !== 'rejected') continue;
    rejectionReasons[outcome.reason] = (rejectionReasons[outcome.reason] ?? 0) + 1;
  }
  let repeatedActions = 0;
  for (const simkinId of ['aya', 'mira'] as const) {
    const kinds = world.decisions
      .filter((decision) => decision.input.simkinId === simkinId)
      .map((decision) => JSON.stringify(decision.input.intent));
    for (let index = 1; index < kinds.length; index += 1) {
      if (kinds[index] === kinds[index - 1]) repeatedActions += 1;
    }
  }
  const decisionsByTick = new Map<number, VillageDecision[]>();
  for (const decision of world.decisions) {
    const tick = decisionsByTick.get(decision.appliedTick) ?? [];
    tick.push(decision);
    decisionsByTick.set(decision.appliedTick, tick);
  }
  const stalledTicks = [...decisionsByTick.values()].filter((decisions) =>
    decisions.every(
      (decision) => decision.input.intent.kind === 'Wait' || decision.outcome?.status === 'rejected',
    ),
  ).length;
  const conversationMemories = world.simkins.aya.memories.filter(
    (memory) => memory.source?.startsWith('conversation:') === true,
  );
  const memoryInfluencedDecisions = world.decisions.filter(
    (decision) =>
      decision.input.simkinId === 'aya' &&
      decision.input.intent.kind !== 'Wait' &&
      decision.request?.snapshot.recalledMemoryIds.includes('memory:mira-told-aya-mint-location') === true,
  ).length;
  const replayed = replay(world.decisions);
  return {
    ticks: world.tick,
    goals: {
      ayaPromiseComplete: world.simkins.aya.ayaPromiseComplete,
      ayaPersonalMintGoalComplete: world.simkins.aya.mint > 0,
      miraTeaGoalComplete: world.simkins.mira.miraTeaGoalComplete,
    },
    goalCompletionTicks: {
      ayaPromise: world.events.find((event) => event.type === 'mint-given') === undefined
        ? null
        : Number(world.events.find((event) => event.type === 'mint-given')!.id.split(':')[1]),
      miraTea: world.events.find((event) => event.type === 'tea-brewed') === undefined
        ? null
        : Number(world.events.find((event) => event.type === 'tea-brewed')!.id.split(':')[1]),
    },
    modelRequests: new Set(world.decisions.map((decision) => decision.input.requestId)).size,
    applied: outcomes.filter((outcome) => outcome.status === 'applied').length,
    rejected: outcomes.filter((outcome) => outcome.status === 'rejected').length,
    fallbacks: outcomes.filter((outcome) => outcome.status === 'fallback').length,
    timeouts: outcomes.filter((outcome) => outcome.status === 'fallback' && outcome.reason === 'timeout').length,
    lateCompletionsRejected: rejectionReasons['request no longer pending'] ?? 0,
    rejectionReasons,
    conversationMemoriesCreated: conversationMemories.length,
    recalledMemoryDecisions: memoryInfluencedDecisions,
    memoryInfluencedDecisions,
    repeatedActions,
    stalledTicks,
    maxPendingRequests: baseline.maxPendingRequests,
    maxProviderInFlight: baseline.maxProviderInFlight,
    pendingRequestsAtEnd: Object.keys(world.requests).length,
    replayMatched: JSON.stringify(consequentialState(replayed)) === JSON.stringify(consequentialState(world)),
  };
}

function evaluationReport(
  baseline: RunResult,
  reloaded: RunResult,
): VillageSoakReport {
  return {
    ...coreEvaluationReport(baseline),
    maxPendingRequests: Math.max(baseline.maxPendingRequests, reloaded.maxPendingRequests),
    maxProviderInFlight: Math.max(baseline.maxProviderInFlight, reloaded.maxProviderInFlight),
    persistedBytes: reloaded.persistedBytes,
    reloadedAtTick: 5,
    pendingRequestsAtSave: reloaded.pendingRequestsAtSave,
    reloadMatched: JSON.stringify(baseline.world) === JSON.stringify(reloaded.world),
  };
}

export async function runVillageSoak(): Promise<VillageSoakResult> {
  const baseline = await runVillage();
  const reloaded = await runVillage(5);
  return {
    report: evaluationReport(baseline, reloaded),
    log: baseline.world.log,
    decisions: baseline.world.decisions,
  };
}

export async function runVillageLiveSoak(
  fulfill: (request: VillageRequest) => Promise<unknown>,
): Promise<VillageLiveResult> {
  const run = await runLiveVillage(fulfill);
  return {
    report: coreEvaluationReport(run),
    log: run.world.log,
    decisions: run.world.decisions,
  };
}
