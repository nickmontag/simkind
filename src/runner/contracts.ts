import type {
  ActionEvent, ActionProposal, Artifact, Character, CharacterState, Clock, EffectiveInstance,
  FormatDiagnostic, JsonObject, JsonValue, Limits, Observation, PortableDocument, PublicModel,
  RunConfig, Scenario, TimePoint, ToolCatalog,
} from '../format/index.js';

export interface ResolvedBundle {
  scenarioId: string;
  configId: string;
  documents: Record<string, PortableDocument>;
  artifacts: Artifact[];
  /** Exact UTF-8 authored sources, keyed by bundle-relative path. */
  sources: Record<string, string>;
}

export interface HostDescriptor {
  contractId: string;
  version: string;
  implementationVersion: string;
  initialConditionsSchema: object | boolean;
  toolCatalog: ToolCatalog;
  /** Operator-only operations. Never offered to a character as tools. */
  interventions?: InterventionOperation[];
  clocks: Clock[];
  limits: Limits;
  profiles?: Record<string, { version: string; extensionSchema: object | boolean }>;
  capabilities: {
    pause: boolean;
    playback: boolean;
    deterministicReplay: boolean;
    restore: boolean;
    branch: boolean;
    deduplication: 'run-memory';
    revisionPolicy: 'reject' | 'revalidate';
  };
}

export interface PreparedLaunch {
  runId: string;
  bundle: ResolvedBundle;
  scenario: Scenario;
  config: RunConfig;
  characters: Record<string, Character>;
  states: Record<string, CharacterState>;
  effectiveConfig: Record<string, EffectiveInstance>;
  /** Ordered overlays retained for operator inspection. */
  configurationSources: JsonObject;
  profileVersions: Record<string, string>;
}

export interface CharacterHost {
  time(): TimePoint;
  revision(): number;
  /** Host scheduling policy, not a prescribed character strategy. */
  decisionActors(): string[];
  observe(instanceId: string): Observation[];
  availableTools(instanceId: string): string[];
  submit(proposal: ActionProposal): ActionEvent[];
  drainEvents(): ActionEvent[];
  cancel(actionId: string): ActionEvent[];
  advance(): void;
  inspect(): JsonValue;
  /** Complete, JSON-only host state, including clocks and deduplication. */
  checkpoint?(): JsonValue;
  /** Pure preview; commit must revalidate the same expected host revision. */
  previewIntervention?(proposal: ActionProposal): InterventionPreview;
  intervene?(proposal: ActionProposal): ActionEvent[];
}

export type InterventionOperation = Pick<ToolCatalog['tools'][number], 'id' | 'version' | 'description' | 'inputSchema'>;
export interface HostIntervention {
  /** An operator identifier distinct from every character instance. */
  operator: string;
  operationId: string;
  operationVersion: string;
  expectedRevision: number;
  arguments: JsonObject;
}
export interface InterventionPreview {
  valid: boolean;
  revision: number;
  expectedRevision: number;
  reason?: string;
  effects?: JsonValue;
}

export interface HostRegistration {
  descriptor: HostDescriptor;
  /** Read-only semantic checks before construction or provider dispatch. */
  validateInitial?(scenario: Scenario): FormatDiagnostic[];
  create(launch: PreparedLaunch): CharacterHost;
  /** Must validate before constructing; never executes external actions. */
  restore?(launch: PreparedLaunch, snapshot: JsonValue): CharacterHost;
}

export interface DecisionContext {
  runId: string;
  requestId: string;
  instanceId: string;
  character: Pick<Character, 'name' | 'persona'>;
  stateRevision: number;
  intentions: NonNullable<CharacterState['context']['intentions']>;
  memories: NonNullable<CharacterState['context']['memories']>;
  observations: Observation[];
  tools: ToolCatalog['tools'];
  outcomes: ActionEvent[];
  model: PublicModel;
}

export interface ProviderResult {
  output: unknown;
  usage?: { inputTokens?: number; outputTokens?: number; cost?: number };
}

export interface ModelConnection {
  /** Only this explicit allowlisted metadata enters portable recordings. */
  public: PublicModel;
  capabilities: { text: boolean; json: boolean };
  fulfill(context: DecisionContext, signal: AbortSignal): Promise<ProviderResult>;
}
