import { ActionLedger, type CharacterHost, type HostRegistration, type PreparedLaunch } from 'simkind/runner';
import { canonicalJson, compileDataSchema, type ActionEvent, type ActionProposal, type JsonValue, type ToolCatalog } from 'simkind/format';
import { distance, worldFrame, type Vec3 } from 'simkind/spatial';

const vector = { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number', minimum: -1000, maximum: 1000 } };
export const spatialCatalog: ToolCatalog = { specVersion: '0.2.0-draft.2', kind: 'tool-catalog', id: 'catalog:spatial', host: { contractId: 'example.spatial', version: '1.0.0' }, tools: [
  { id: 'move', version: '1.0.0', description: 'Fly to a 3D position in frame:world (metres, Y up). Motion takes time; solid obstacles block the swept path. Cancellation keeps the reached position.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['position', 'frameId'], properties: { position: vector, frameId: { const: 'frame:world' } } }, lifecycle: { asynchronous: true, cancellable: true } },
  { id: 'say', version: '1.0.0', description: 'Broadcast text to the other participants. Claims do not move bodies.', inputSchema: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string', maxLength: 4000 } } }, lifecycle: { asynchronous: false, cancellable: false } },
] };
interface World {
  sharedContext: string; positions: Record<string, Vec3>; speed: number; bound: number;
  obstacles: { center: Vec3; radius: number }[];
  messages: { from: string; text: string }[];
  flights: Record<string, { proposal: ActionProposal; destination: Vec3 }>;
}
type Command = { advance: true } | { proposal: ActionProposal } | { cancel: string };
const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value));

/** Independent kinematic 3D reference implementation; no renderer or demo base class. */
class SpatialHost implements CharacterHost {
  private tick = 0;
  private version = 0;
  private count = 0;
  private readonly ledger: ActionLedger;
  private readonly queue: ActionEvent[] = [];
  private readonly commands: Command[] = [];
  private readonly actors: string[];
  private world: World;
  constructor(private readonly launch: PreparedLaunch) {
    this.actors = launch.scenario.cast.map(m => m.instanceId);
    this.world = { ...structuredClone(launch.scenario.initialConditions), messages: [], flights: {} } as unknown as World;
    this.ledger = new ActionLedger(launch.runId, spatialHost.descriptor.clocks);
  }
  time() { return { clockId: 'clock:simulation', value: this.tick }; }
  revision() { return this.version; }
  decisionActors() { return [...this.actors]; }
  availableTools(actor: string) { return this.actors.includes(actor) ? this.launch.effectiveConfig[actor].allowedTools : []; }
  inspect() { return json({ tick: this.tick, revision: this.version, world: this.world, frame: worldFrame }); }
  observe(actor: string) {
    return [{ id: `spatial:${this.tick}:${this.actors.indexOf(actor)}:${this.version}`, runId: this.launch.runId, recipient: actor,
      source: 'example.spatial', revision: this.version, capturedAt: this.time(), deliveredAt: this.time(),
      content: [{ type: 'data' as const, schemaId: 'simkind.spatial:0.1.0', data: json({ frame: worldFrame, position: this.world.positions[actor],
        others: this.world.positions, obstacles: this.world.obstacles, bound: this.world.bound, sharedContext: this.world.sharedContext, messages: this.world.messages }) }] }];
  }
  private event(proposal: ActionProposal, status: ActionEvent['status'], extra: Partial<ActionEvent> = {}): ActionEvent {
    const event: ActionEvent = { id: `spatial-event:${++this.count}`, runId: this.launch.runId, actor: proposal.actor, actionId: proposal.id,
      status, time: this.time(), revision: this.version, effectRefs: [], ...extra };
    this.ledger.receive([event]); return event;
  }
  private blocked(from: Vec3, to: Vec3) {
    if (to.some(n => Math.abs(n) > this.world.bound)) return true;
    const delta = to.map((n, i) => n - from[i]);
    const lengthSquared = delta.reduce((sum, n) => sum + n * n, 0);
    return this.world.obstacles.some(obstacle => {
      const t = lengthSquared ? Math.max(0, Math.min(1, delta.reduce((sum, n, i) => sum + n * (obstacle.center[i] - from[i]), 0) / lengthSquared)) : 0;
      return distance(obstacle.center, from.map((n, i) => n + t * delta[i]) as Vec3) <= obstacle.radius;
    });
  }
  submit(proposal: ActionProposal) {
    if (this.ledger.propose(proposal) === 'duplicate') return [];
    this.commands.push({ proposal: structuredClone(proposal) });
    const tool = spatialCatalog.tools.find(t => t.id === proposal.toolId && t.version === proposal.toolVersion);
    if (!tool || !this.availableTools(proposal.actor).includes(tool.id) || compileDataSchema(tool.inputSchema)(proposal.arguments).length
      || proposal.observedRevision > this.version || Object.hasOwn(this.world.flights, proposal.actor)
      || tool.id === 'move' && this.blocked(this.world.positions[proposal.actor], proposal.arguments.position as Vec3)) {
      return [this.event(proposal, 'rejected', { reason: 'Tool, frame, motion state, bounds, or swept path is not permitted.' })];
    }
    const accepted = this.event(proposal, 'accepted');
    this.version++;
    if (tool.id === 'move') {
      Object.defineProperty(this.world.flights, proposal.actor, { value: { proposal: structuredClone(proposal), destination: structuredClone(proposal.arguments.position) }, enumerable: true, configurable: true });
      return [accepted, this.event(proposal, 'running')];
    }
    this.world.messages.push({ from: proposal.actor, text: proposal.arguments.text as string });
    return [accepted, this.event(proposal, 'succeeded', { effectRefs: [`speech:${this.version}`], result: { text: proposal.arguments.text } })];
  }
  advance() {
    this.commands.push({ advance: true }); this.tick++;
    for (const [actor, flight] of Object.entries(this.world.flights)) {
      const from = this.world.positions[actor]; const length = distance(from, flight.destination);
      this.world.positions[actor] = from.map((n, i) => length <= this.world.speed ? flight.destination[i] : n + (flight.destination[i] - n) * this.world.speed / length) as Vec3;
      this.version++;
      const extra = { effectRefs: [`pose:${this.version}`], result: json({ frameId: worldFrame.id, position: this.world.positions[actor] }) };
      if (length <= this.world.speed) { delete this.world.flights[actor]; this.queue.push(this.event(flight.proposal, 'succeeded', extra)); }
      else this.queue.push(this.event(flight.proposal, 'running', extra));
    }
  }
  drainEvents() { return this.queue.splice(0); }
  cancel(actionId: string) {
    const tracked = this.ledger.get(actionId); if (!tracked) throw new Error('Unknown spatial action.');
    this.commands.push({ cancel: actionId });
    const request = this.event(tracked.proposal, 'cancellation-requested');
    if (!Object.hasOwn(this.world.flights, tracked.proposal.actor) || this.world.flights[tracked.proposal.actor].proposal.id !== actionId) return [request, this.event(tracked.proposal, 'cancellation-result', { cancellation: 'too-late' })];
    delete this.world.flights[tracked.proposal.actor]; this.version++;
    return [request, this.event(tracked.proposal, 'cancelled', { result: json({ position: this.world.positions[tracked.proposal.actor], frameId: worldFrame.id }) }), this.event(tracked.proposal, 'cancellation-result', { cancellation: 'cancelled' })];
  }
  checkpoint() {
    if (this.queue.length || this.ledger.unresolved().length) throw new Error('Spatial checkpoint requires settled actions.');
    return json({ version: 1, state: this.inspect(), commands: this.commands });
  }
  restore(snapshot: JsonValue) {
    const validator = compileDataSchema({ type: 'object', additionalProperties: false, required: ['version', 'state', 'commands'], properties: {
      version: { const: 1 }, state: {}, commands: { type: 'array', maxItems: 100000, items: { oneOf: [
        { type: 'object', additionalProperties: false, required: ['advance'], properties: { advance: { const: true } } },
        { type: 'object', additionalProperties: false, required: ['proposal'], properties: { proposal: { type: 'object' } } },
        { type: 'object', additionalProperties: false, required: ['cancel'], properties: { cancel: { type: 'string' } } },
      ] } },
    } });
    if (validator(snapshot).length) throw new Error('Invalid spatial checkpoint.');
    const data = snapshot as unknown as { state: JsonValue; commands: Command[] };
    for (const command of data.commands) {
      if ('advance' in command) this.advance();
      if ('proposal' in command) this.submit({ ...command.proposal, runId: this.launch.runId });
      if ('cancel' in command) this.cancel(command.cancel);
      this.drainEvents();
    }
    if (canonicalJson(this.inspect()) !== canonicalJson(data.state) || this.ledger.unresolved().length) throw new Error('Spatial checkpoint does not reproduce its state.');
  }
}
export const spatialHost: HostRegistration = {
  descriptor: { contractId: 'example.spatial', version: '1.0.0', implementationVersion: '1.0.0', toolCatalog: spatialCatalog,
    clocks: [{ id: 'clock:simulation', kind: 'tick', unit: 'tick', origin: 'Local simulation initialization; one tick advances one simulated second.' }],
    limits: { maxRequests: 1000, maxInFlight: 16, maxSteps: 1000, requestTimeoutMs: 60000 },
    capabilities: { pause: true, playback: true, deterministicReplay: true, restore: true, branch: true, deduplication: 'run-memory', revisionPolicy: 'revalidate' },
    initialConditionsSchema: { type: 'object', additionalProperties: false, required: ['sharedContext', 'positions', 'speed', 'bound', 'obstacles'], properties: {
      sharedContext: { type: 'string' }, positions: { type: 'object', additionalProperties: vector }, speed: { type: 'number', exclusiveMinimum: 0, maximum: 100 }, bound: { type: 'number', exclusiveMinimum: 0, maximum: 1000 },
      obstacles: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['center', 'radius'], properties: { center: vector, radius: { type: 'number', exclusiveMinimum: 0, maximum: 100 } } } },
    } } },
  validateInitial(scenario) {
    const world = scenario.initialConditions as unknown as World;
    const valid = canonicalJson(Object.keys(world.positions).sort()) === canonicalJson(scenario.cast.map(m => m.instanceId).sort())
      && Object.values(world.positions).every(p => p.every(n => Math.abs(n) <= world.bound) && world.obstacles.every(o => distance(p, o.center) > o.radius));
    return valid ? [] : [{ stage: 'semantic', code: 'INVALID_SPATIAL_BINDING', pointer: '/initialConditions', message: 'Bind every actor to a position inside the bounds and outside obstacles.' }];
  },
  create: launch => new SpatialHost(launch),
  restore: (launch, snapshot) => { const host = new SpatialHost(launch); host.restore(snapshot); return host; },
};
