import type {
  ActionEvent, ActionProposal, Artifact, Character, CharacterState, Clock, EffectiveInstance,
  FormatDiagnostic, JsonObject, JsonValue, Limits, Observation, PortableDocument, PublicModel,
  RunConfig, Scenario, TimePoint, ToolCatalog,
} from '../format/index.js';
import type { MemoryEvidence } from './evidence.js';
import type { RunnerStorage } from './storage.js';
import type { WorkingConcern } from './memory-policy.js';
import type { HostPerception } from './perception.js';

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
  /** Optional explicit scenario completion; an empty actor list alone is not completion. */
  isComplete?(): boolean;
  observe(instanceId: string): Observation[];
  /** Opt-in event/state separation. Legacy observe() remains supported. */
  perceive?(instanceId: string): HostPerception;
  /** Optional recorder-only observations with stable IDs. Recipients must be outside the cast; never sent to models. */
  operatorObservations?(): Observation[];
  availableTools(instanceId: string): string[];
  /** Actor-visible constraints frozen at observation time. Always intersected with the catalog schema. */
  toolConstraints?(instanceId: string): Record<string, JsonObject>;
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
  create(launch: PreparedLaunch, runtime?: { storage: RunnerStorage }): CharacterHost;
  /** Must validate before constructing; never executes external actions. */
  restore?(launch: PreparedLaunch, snapshot: JsonValue, runtime?: { storage: RunnerStorage }): CharacterHost;
}

export interface DecisionContext {
  purpose?: 'decision' | 'consolidation' | 'recall' | 'correction';
  recent?: NonNullable<CharacterState['context']['memories']>;
  memory?: { version: number; summary: string; evidenceThrough: number; temporalScope?: string; authority?: 'interpretation'; concerns?: WorkingConcern[] };
  memoryEvidence?: MemoryEvidence[];
  feedback?: string;
  contextSize?: { characters: number; sections: Record<string, number> };
  runId: string;
  requestId: string;
  instanceId: string;
  character: Pick<Character, 'name' | 'persona'>;
  stateRevision: number;
  intentions: NonNullable<CharacterState['context']['intentions']>;
  memories: NonNullable<CharacterState['context']['memories']>;
  observations: Observation[];
  perception?: { currentStateIds: string[]; eventIds: string[] };
  tools: ToolCatalog['tools'];
  outcomes: ActionEvent[];
  model: PublicModel;
}

export interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  cost?: number;
}
export interface ProviderResult {
  output: unknown;
  usage?: ProviderUsage;
  telemetry?: { provider?: string; generationId?: string; finishReason?: string };
}

export interface ModelConnection {
  /** Only this explicit allowlisted metadata enters portable recordings. */
  public: PublicModel;
  capabilities: { text: boolean; json: boolean; jsonSchema?: boolean; responseMode?: 'schema' | 'json' | 'text' };
  fulfill(context: DecisionContext, signal: AbortSignal): Promise<ProviderResult>;
}
