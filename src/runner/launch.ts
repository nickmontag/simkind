import { contextProfile, contextConfigSchema } from './long-memory.js';
import { continuityProfile, continuityConfigSchema, reviseTool } from './continuity.js';
import { canonicalJson, compileDataSchema, validateDocument, validateRecord, writeCharacter, type FeatureSettings, type FormatDiagnostic,
  type FormatResult, type JsonObject, type JsonValue, type PortableDocument, type PublicModel } from '../format/index.js';
import { memoryRetrievalSchema } from '../format/memory-retrieval.generated.js';
import { diagnostic, object, pointerPart } from '../format/character.js';
import type { HostRegistration, ModelConnection, PreparedLaunch, ResolvedBundle } from './contracts.js';

export const memoryRetrievalProfile = { id: 'simkind.memory-retrieval', version: '0.1.0',
  defaults: { enabled: true, config: { maxItems: 12 } } } as const;
const validateMemoryConfig = compileDataSchema(memoryRetrievalSchema);

/** Objects overlay recursively, arrays replace, and conflicting types fail. */
export function overlayConfiguration(base: JsonValue, override: JsonValue): JsonValue {
  if (object(base) && object(override)) {
    return Object.fromEntries([...new Set([...Object.keys(base), ...Object.keys(override)])].map((key) => [key,
      Object.hasOwn(override, key) ? Object.hasOwn(base, key)
        ? overlayConfiguration(base[key] as JsonValue, override[key] as JsonValue) : structuredClone(override[key])
        : structuredClone(base[key])]));
  }
  if (Array.isArray(base) && Array.isArray(override)) return structuredClone(override);
  if (typeof base !== typeof override || (base === null) !== (override === null) || Array.isArray(base) !== Array.isArray(override)) {
    throw new Error('Configuration override changes a value type.');
  }
  return structuredClone(override);
}

function json(value: unknown): JsonValue { return JSON.parse(JSON.stringify(value)) as JsonValue; }

export function publicModel(connection: ModelConnection): PublicModel {
  return { provider: connection.public.provider, model: connection.public.model,
    settings: { ...(connection.public.settings.temperature === undefined ? {} : { temperature: connection.public.settings.temperature }),
      ...(connection.public.settings.maxOutputTokens === undefined ? {} : { maxOutputTokens: connection.public.settings.maxOutputTokens }) } };
}

export function prepareLaunch(
  source: ResolvedBundle, registration: HostRegistration,
  connections: Readonly<Record<string, ModelConnection>>, runId: string,
): FormatResult<PreparedLaunch> {
  const bundle = structuredClone(source);
  const diagnostics: FormatDiagnostic[] = [];
  const issue = (code: string, pointer: string, message: string, documentId?: string) => diagnostics.push(diagnostic('compatibility', code, pointer, message, documentId));
  for (const [key, doc] of Object.entries(bundle.documents)) {
    const checked = validateDocument(doc);
    if (!checked.ok) diagnostics.push(...checked.diagnostics);
    if (key !== doc.id) issue('REFERENCE_MISMATCH', '', 'Document dictionary keys must match document IDs.', doc.id);
  }
  if (diagnostics.length) return { ok: false, diagnostics };
  const scenario = bundle.documents[bundle.scenarioId];
  const config = bundle.documents[bundle.configId];
  if (scenario?.kind !== 'scenario' || config?.kind !== 'run-config') {
    return { ok: false, diagnostics: [diagnostic('referential', 'MISSING_ENTRY', '', 'Resolve a scenario and run-config before launch.')] };
  }
  const descriptor = registration.descriptor;
  for (const clock of descriptor.clocks) diagnostics.push(...validateRecord('Clock', clock));
  diagnostics.push(...validateRecord('Limits', descriptor.limits));
  const hostCatalog = validateDocument(descriptor.toolCatalog);
  if (!hostCatalog.ok) diagnostics.push(...hostCatalog.diagnostics);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(runId)) issue('INVALID_RUN_ID', '', 'Use a valid stable run ID.');
  if (scenario.host.contractId !== descriptor.contractId || scenario.host.version !== descriptor.version) {
    issue('HOST_MISMATCH', '/host', 'Install the exact host contract requested by this scenario.', scenario.id);
  }
  const catalog = bundle.documents[scenario.toolCatalogRef];
  if (catalog?.kind !== 'tool-catalog') issue('MISSING_TOOL_CATALOG', '/toolCatalogRef', 'Resolve the required tool catalog.', scenario.id);
  else if (canonicalJson(catalog.host) !== canonicalJson(scenario.host)
    || canonicalJson(catalog.tools) !== canonicalJson(descriptor.toolCatalog.tools)) {
    issue('TOOL_CONTRACT_MISMATCH', '/toolCatalogRef', 'Use the installed host’s exact versioned tool contracts.', scenario.id);
  }
  try {
    diagnostics.push(...compileDataSchema(descriptor.initialConditionsSchema)(scenario.initialConditions).map((entry) => ({ ...entry, documentId: scenario.id, pointer: '/initialConditions' + entry.pointer })));
  } catch { issue('INVALID_HOST_SCHEMA', '/host', 'The installed host has an invalid initial-conditions schema.'); }
  if (new Set(descriptor.clocks.map((clock) => clock.id)).size !== descriptor.clocks.length || descriptor.clocks.length === 0) issue('INVALID_CLOCK', '/host', 'The host must declare distinct clocks.');
  const profileVersions: Record<string, string> = Object.create(null);
  for (const doc of Object.values(bundle.documents)) {
    for (const [profileId, profile] of Object.entries(doc.profiles ?? {})) {
      if (Object.hasOwn(profileVersions, profileId) && profileVersions[profileId] !== profile.version) issue('PROFILE_VERSION_CONFLICT', '/profiles', 'Use one exact profile version throughout a resolved launch.', doc.id);
      profileVersions[profileId] = profile.version;
      const supported = profileId === memoryRetrievalProfile.id ? profile.version === memoryRetrievalProfile.version
        : profileId === continuityProfile.id ? profile.version === continuityProfile.version
        : profileId === contextProfile.id ? profile.version === contextProfile.version
        : descriptor.profiles?.[profileId]?.version === profile.version;
      if (!supported && profile.required) issue('UNSUPPORTED_REQUIRED_PROFILE', `/profiles/${pointerPart(profileId)}`, 'Install support for this exact required profile version.', doc.id);
      if (supported && Object.hasOwn(doc.extensions ?? {}, profileId)) {
        try {
          const schema = (profileId === memoryRetrievalProfile.id || profileId === continuityProfile.id || profileId === contextProfile.id) ? { type: 'object', properties: {}, additionalProperties: false } : descriptor.profiles![profileId].extensionSchema;
          diagnostics.push(...compileDataSchema(schema)(doc.extensions![profileId]));
        } catch { issue('INVALID_PROFILE_SCHEMA', '/profiles', 'The installed profile must provide a valid extension schema.', doc.id); }
      }
    }
  }
  for (const [key, value] of Object.entries(config.limits)) {
    if (value > descriptor.limits[key as keyof typeof config.limits]) issue('HOST_LIMIT_EXCEEDED', `/limits/${key}`, 'Choose a value within the installed host’s limit.', config.id);
  }
  const castIds = new Set(scenario.cast.map((member) => member.instanceId));
  for (const [pointer, assignments] of [['modelAssignments', config.modelAssignments], ['perInstance', config.perInstance ?? {}], ['recommendations/modelAssignments', scenario.recommendations?.modelAssignments ?? {}]] as const) {
    for (const id of Object.keys(assignments)) if (!castIds.has(id)) issue('UNKNOWN_INSTANCE', `/${pointer}/${pointerPart(id)}`, 'Reference an instance in the scenario cast.');
  }
  const launch: PreparedLaunch = { runId, bundle, scenario, config, characters: Object.create(null), states: Object.create(null), effectiveConfig: Object.create(null), configurationSources: {}, profileVersions };
  for (const member of scenario.cast) {
    const character = bundle.documents[member.characterRef];
    const artifact = bundle.artifacts.find((entry) => entry.documentId === member.characterRef);
    if (character?.kind !== 'character' || !artifact) {
      issue('MISSING_CHARACTER', '/cast', 'Resolve each character definition and its source hash.', scenario.id); continue;
    }
    const slot = config.perInstance?.[member.instanceId]?.modelSlot ?? config.modelAssignments[member.instanceId]
      ?? scenario.recommendations?.modelAssignments?.[member.instanceId];
    const connection = slot && Object.hasOwn(connections, slot) ? connections[slot] : undefined;
    if (!connection || !connection.public.model.trim() || !connection.public.provider.trim()) {
      issue('MODEL_NOT_CONFIGURED', `/modelAssignments/${pointerPart(member.instanceId)}`, 'Configure this slot with an explicit provider and model ID.', config.id); continue;
    }
    if (!connection.capabilities.text || !connection.capabilities.json) issue('PROVIDER_CAPABILITY', '/modelAssignments', 'This runner requires text context and JSON decisions.', config.id);
    diagnostics.push(...validateRecord('PublicModel', connection.public));
    const defaults: FeatureSettings = profileVersions[memoryRetrievalProfile.id] === memoryRetrievalProfile.version
      ? { [memoryRetrievalProfile.id]: structuredClone(memoryRetrievalProfile.defaults) } : {};
    if (profileVersions[continuityProfile.id] === continuityProfile.version) defaults[continuityProfile.id] = structuredClone(continuityProfile.defaults);
    if (profileVersions[contextProfile.id] === contextProfile.version) defaults[contextProfile.id] = structuredClone(contextProfile.defaults);
    let features: FeatureSettings = defaults;
    const layers = [defaults, scenario.recommendations?.features ?? {}, config.features ?? {}, config.perInstance?.[member.instanceId]?.features ?? {}];
    try { for (const layer of layers.slice(1)) features = overlayConfiguration(json(features), json(layer)) as FeatureSettings; }
    catch { issue('CONFIGURATION_TYPE_CONFLICT', '/features', 'Override values must retain their declared types.', config.id); }
    for (const [featureId, feature] of Object.entries(features)) {
      if (!Object.hasOwn(profileVersions, featureId)) issue('UNDECLARED_PROFILE', '/features', 'Declare the profile for every configured feature.', config.id);
      if (feature.enabled && !([memoryRetrievalProfile, continuityProfile, contextProfile].some(profile => profile.id === featureId && profileVersions[featureId] === profile.version))) issue('UNSUPPORTED_FEATURE', '/features', 'Install a runner implementation for this enabled feature.', config.id);
      if (featureId === contextProfile.id) diagnostics.push(...compileDataSchema(contextConfigSchema)(feature.config ?? {}));
      if (featureId === continuityProfile.id) diagnostics.push(...compileDataSchema(continuityConfigSchema)(feature.config ?? {}));
      if (featureId === memoryRetrievalProfile.id) diagnostics.push(...validateMemoryConfig(feature.config).map((entry) => ({ ...entry, documentId: config.id, pointer: '/features/' + pointerPart(featureId) + '/config' + entry.pointer })));
    }
    if (features[contextProfile.id]?.enabled && !features[continuityProfile.id]?.enabled) issue('CONTEXT_REQUIRES_CONTINUITY', '/features', 'Enable continuity for archived context.');
    const hostTools = descriptor.toolCatalog.tools.map((tool) => tool.id);
    if (hostTools.some(id => [reviseTool.id, 'simkind.recall', 'simkind.compact'].includes(id))) issue('RESERVED_TOOL_ID', '/host', 'The continuity tool ID is reserved.');
    const permissions = member.allowedTools ?? hostTools;
    const allowedTools = config.perInstance?.[member.instanceId]?.allowedTools ?? permissions;
    if (permissions.some((tool) => !hostTools.includes(tool)) || allowedTools.some((tool) => !permissions.includes(tool))) issue('INVALID_TOOL_PERMISSION', '/cast', 'Tools must exist and run overrides may only narrow scenario permissions.', scenario.id);
    const context = overlayConfiguration(json(character.startingState ?? {}), json(member.initialState ?? {}));
    const state = { specVersion: '0.2.0-draft.2', kind: 'character-state', id: `state:${Object.keys(launch.states).length + 1}`,
      instanceId: member.instanceId, definitionRef: character.id, definitionHash: artifact.sha256, revision: 0, context };
    const checkedState = validateDocument(state);
    if (!checkedState.ok) diagnostics.push(...checkedState.diagnostics);
    else if (checkedState.value.kind === 'character-state') launch.states[member.instanceId] = checkedState.value;
    launch.characters[member.instanceId] = character;
    launch.effectiveConfig[member.instanceId] = { modelSlot: slot!, model: publicModel(connection), features, allowedTools: [...new Set(allowedTools)] };
    launch.configurationSources[member.instanceId] = json({ featureLayers: layers, modelSlot: slot, toolPermissions: permissions }) as JsonObject;
  }
  if (diagnostics.length === 0 && registration.validateInitial) diagnostics.push(...registration.validateInitial(scenario));
  return diagnostics.length ? { ok: false, diagnostics } : { ok: true, value: launch };
}

/** Explicit, lossless definition migration; does not upgrade old run/replay claims. */
export function upgradeCharacter(document: import('../format/index.js').CharacterDocument): FormatResult<{ document: PortableDocument; changes: string[] }> {
  const source = writeCharacter(document);
  if (!source.ok) return source;
  const checked = validateDocument({ ...structuredClone(document), specVersion: '0.2.0-draft.2' });
  return checked.ok ? { ok: true, value: { document: checked.value, changes: ['Changed specVersion from 0.2.0-draft.1 to 0.2.0-draft.2; character content preserved.'] } } : checked;
}
