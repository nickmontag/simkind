import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import { documentSchema, type PortableDocument, type Clock, type TimePoint, type JsonValue } from './documents.generated.js';
import {
  checkJsonValue, checkSize, diagnostic, object, ParseFailure, pointerPart, readMappedCharacter,
  type CharacterRepresentation, type FormatDiagnostic, type FormatResult,
} from './character.js';

const ajv = new Ajv2020({ strict: true, allErrors: true, ownProperties: true });
const definitions = documentSchema.$defs;
const names = { character: 'Character', 'character-state': 'CharacterState', scenario: 'Scenario',
  'tool-catalog': 'ToolCatalog', 'run-config': 'RunConfig', 'run-bundle': 'RunBundle' } as const;
const validators = new Map<string, ValidateFunction>();

function validator(name: string): ValidateFunction {
  if (!validators.has(name)) validators.set(name, ajv.compile({ $defs: definitions, $ref: `#/$defs/${name}` }));
  return validators.get(name)!;
}

function schemaDiagnostics(errors: ErrorObject[] | null | undefined, documentId?: string): FormatDiagnostic[] {
  return (errors ?? []).map((error) => {
    const field = error.keyword === 'additionalProperties' ? error.params.additionalProperty
      : error.keyword === 'required' ? error.params.missingProperty : undefined;
    return diagnostic('structural', error.keyword === 'additionalProperties' ? 'UNKNOWN_FIELD' : 'SCHEMA_INVALID',
      error.instancePath + (field === undefined ? '' : `/${pointerPart(field)}`),
      `Correct this field: ${error.message}.`, documentId);
  });
}

export function validateRecord(name: 'Observation' | 'ActionProposal' | 'ActionEvent' | 'RunEvent' | 'PublicModel' | 'Clock' | 'Limits', value: unknown): FormatDiagnostic[] {
  const check = validator(name);
  return check(value) ? [] : schemaDiagnostics(check.errors);
}

export function readJson(source: string): FormatResult<unknown> { return readMappedCharacter(source); }

/** Local Draft 2020-12 validation. External references are never downloaded. */
export function compileDataSchema(schema: object | boolean): (value: unknown) => FormatDiagnostic[] {
  const check = new Ajv2020({ strict: true, allErrors: true, ownProperties: true }).compile(schema);
  return (value) => check(value) ? [] : schemaDiagnostics(check.errors);
}

export function isResourcePath(path: string): boolean {
  return !/[\\:%?#\u0000-\u001f\u007f]/.test(path)
    && path.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

export function validateTime(time: TimePoint, clocks: readonly Clock[]): FormatDiagnostic[] {
  const clock = clocks.find((candidate) => candidate.id === time.clockId);
  const valid = clock?.kind === 'tick' ? typeof time.value === 'number' && Number.isSafeInteger(time.value) && time.value >= 0
    : clock?.kind === 'utc' && typeof time.value === 'string' && Number.isFinite(Date.parse(time.value))
      && new Date(time.value).toISOString() === time.value;
  return valid ? [] : [diagnostic('semantic', 'INVALID_CLOCK', '', 'Use a declared clock and a value in its exact units and format.')];
}

export function validateDocument(value: unknown): FormatResult<PortableDocument> {
  try { checkJsonValue(value); }
  catch (error) {
    if (error instanceof ParseFailure) return { ok: false, diagnostics: [error.diagnostic] };
    throw error;
  }
  const id = object(value) && typeof value.id === 'string' ? value.id : undefined;
  if (!object(value) || value.specVersion !== '0.2.0-draft.2') {
    return { ok: false, diagnostics: [diagnostic('structural', 'UNSUPPORTED_VERSION', '/specVersion', 'Select the explicit supported revision 0.2.0-draft.2.', id)] };
  }
  if (typeof value.kind !== 'string' || !Object.hasOwn(names, value.kind)) {
    return { ok: false, diagnostics: [diagnostic('structural', 'UNKNOWN_KIND', '/kind', 'Use one of the six supported document kinds.', id)] };
  }
  const check = validator(names[value.kind as keyof typeof names]);
  if (!check(value)) return { ok: false, diagnostics: schemaDiagnostics(check.errors, id) };
  const doc = value as unknown as PortableDocument;
  const diagnostics: FormatDiagnostic[] = [];
  const issue = (code: string, pointer: string, message: string) => diagnostics.push(diagnostic('semantic', code, pointer, message, id));
  for (const key of Object.keys(doc.extensions ?? {})) {
    if (!Object.hasOwn(doc.profiles ?? {}, key)) issue('UNDECLARED_PROFILE', `/extensions/${pointerPart(key)}`, 'Declare the profile and its exact version.');
  }
  const paths = new Set<string>();
  for (const [key, resource] of Object.entries(doc.resources ?? {})) {
    if (!isResourcePath(resource.path)) issue('INVALID_RESOURCE_PATH', `/resources/${pointerPart(key)}/path`, 'Use a path within the bundle root.');
    if (paths.has(resource.path)) issue('CONFLICTING_RESOURCE', `/resources/${pointerPart(key)}`, 'Use one document ID per authoritative path.');
    paths.add(resource.path);
  }
  const unique = (ids: string[], pointer: string) => {
    const seen = new Set<string>();
    ids.forEach((key, i) => { if (seen.has(key)) issue('DUPLICATE_ID', `${pointer}/${i}`, 'Assign a distinct stable ID.'); seen.add(key); });
  };
  const contexts = doc.kind === 'character' ? [{ context: doc.startingState, pointer: '/startingState' }]
    : doc.kind === 'character-state' ? [{ context: doc.context, pointer: '/context' }]
    : doc.kind === 'scenario' ? doc.cast.map((member, i) => ({ context: member.initialState, pointer: `/cast/${i}/initialState` })) : [];
  for (const { context, pointer } of contexts) {
    const ids = new Set<string>();
    for (const collection of ['intentions', 'memories'] as const) {
      for (const [i, record] of (context?.[collection] ?? []).entries()) {
        if (ids.has(record.id)) issue('DUPLICATE_ID', `${pointer}/${collection}/${i}/id`, 'Assign a distinct stable record ID.');
        ids.add(record.id);
      }
    }
    for (const [i, memory] of (context?.memories ?? []).entries()) {
      if ((memory.formedAt || memory.aboutTime) && !memory.source.origin) issue('HISTORICAL_ORIGIN_REQUIRED', `${pointer}/memories/${i}/source/origin`, 'Name the origin of historical clock references; do not reinterpret them as current host time.');
    }
  }
  if (doc.kind === 'scenario') unique(doc.cast.map((member) => member.instanceId), '/cast');
  if (doc.kind === 'tool-catalog') {
    unique(doc.tools.map((tool) => tool.id), '/tools');
    for (const [i, tool] of doc.tools.entries()) {
      try { compileDataSchema(tool.inputSchema); if (tool.outputSchema !== undefined) compileDataSchema(tool.outputSchema); }
      catch { issue('INVALID_TOOL_SCHEMA', `/tools/${i}`, 'Supply a locally resolvable Draft 2020-12 schema with supported keywords.'); }
    }
  }
  if (doc.kind === 'run-bundle') {
    unique(doc.clocks.map((clock) => clock.id), '/clocks');
    unique(doc.inputs.map((input) => input.documentId), '/inputs');
    for (const descriptor of [...doc.inputs, ...doc.eventStreams, ...doc.checkpoints]) {
      if (!isResourcePath(descriptor.path)) issue('INVALID_RESOURCE_PATH', '', 'Artifact paths must stay within the bundle root.');
    }
    for (const input of doc.inputs) {
      if (input.compiledPath !== undefined && !isResourcePath(input.compiledPath)) issue('INVALID_RESOURCE_PATH', '/inputs', 'Compiled paths must stay within the bundle root.');
      if ((input.compiledPath === undefined) !== (input.compiledSha256 === undefined)) issue('INCOMPLETE_ARTIFACT', '/inputs', 'Supply both compiled path and compiled hash.');
    }
    if (doc.completeness.status === 'complete' && (doc.completeness.pendingRequests || doc.completeness.inFlightProviders || doc.completeness.unresolvedActions || doc.completeness.missingResources.length)) {
      issue('INCOMPLETE_RUN', '/completeness', 'Mark runs with pending work or missing resources as truncated.');
    }
    if (doc.capabilities.branch && !doc.capabilities.restore) issue('INVALID_CAPABILITY', '/capabilities', 'Branch support requires restore support.');
  }
  return diagnostics.length ? { ok: false, diagnostics } : { ok: true, value: doc };
}

export function readDocument(source: string, representation: CharacterRepresentation = 'json'): FormatResult<PortableDocument> {
  const parsed = readMappedCharacter(source, representation);
  if (!parsed.ok) return parsed;
  if (representation === 'markdown' && object(parsed.value) && parsed.value.kind !== 'character') {
    return { ok: false, diagnostics: [diagnostic('structural', 'MARKDOWN_KIND', '/kind', 'Markdown represents character definitions only.')] };
  }
  return validateDocument(parsed.value);
}

export function writeDocument(document: PortableDocument, representation: CharacterRepresentation = 'json'): FormatResult<string> {
  const checked = validateDocument(document);
  if (!checked.ok) return checked;
  if (representation === 'markdown' && document.kind !== 'character') {
    return { ok: false, diagnostics: [diagnostic('structural', 'MARKDOWN_KIND', '/kind', 'Use JSON for this document kind.', document.id)] };
  }
  const copy = structuredClone(document);
  const description = copy.kind === 'character' ? copy.persona?.description : undefined;
  if (representation === 'markdown' && copy.kind === 'character' && copy.persona) delete copy.persona.description;
  const value = representation === 'json' ? `${JSON.stringify(copy, null, 2)}\n`
    : `\`\`\`simkind\n${JSON.stringify(copy, null, 2)}\n\`\`\`${description === undefined ? '' : `\n${description}`}`;
  try { checkSize(value); }
  catch (error) { if (error instanceof ParseFailure) return { ok: false, diagnostics: [error.diagnostic] }; throw error; }
  return { ok: true, value };
}

/** Stable JSON equality for contracts and deduplication; object-key ordering is not semantic. */
export function canonicalJson(value: JsonValue | unknown): string {
  checkJsonValue(value);
  const sort = (item: unknown): unknown => Array.isArray(item) ? item.map(sort)
    : object(item) ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, sort(item[key])])) : item;
  return JSON.stringify(sort(value));
}
