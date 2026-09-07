import { Ajv2020 } from 'ajv/dist/2020.js';
import { visit } from 'jsonc-parser';
import { characterSchema, type CharacterDocument } from './character.generated.js';

export type { CharacterDocument } from './character.generated.js';

export interface FormatDiagnostic {
  stage: 'parse' | 'structural' | 'referential' | 'semantic' | 'compatibility';
  code: string;
  documentId?: string;
  pointer: string;
  message: string;
}

export type FormatResult<T> =
  | { ok: true; value: T }
  | { ok: false; diagnostics: FormatDiagnostic[] };

export type CharacterRepresentation = 'json' | 'markdown';

const maxBytes = 1024 * 1024;
const maxDepth = 64;
const encoder = new TextEncoder();
const validate = new Ajv2020({ strict: true, allErrors: true, ownProperties: true })
  .compile<CharacterDocument>(characterSchema);

export function pointerPart(value: string | number): string {
  return String(value).replace(/~/g, '~0').replace(/\//g, '~1');
}

export function diagnostic(
  stage: FormatDiagnostic['stage'], code: string, pointer: string, message: string,
  documentId?: string,
): FormatDiagnostic {
  return { stage, code, pointer, message, ...(documentId === undefined ? {} : { documentId }) };
}

export class ParseFailure extends Error {
  constructor(readonly diagnostic: FormatDiagnostic) {
    super(diagnostic.message);
  }
}

function fail(code: string, pointer: string, message: string): never {
  throw new ParseFailure(diagnostic('parse', code, pointer, message));
}

export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function checkSize(source: string): void {
  // Check UTF-16 length first to avoid allocating a huge encoding buffer.
  if (source.length > maxBytes || encoder.encode(source).byteLength > maxBytes) {
    fail('DOCUMENT_TOO_LARGE', '', 'Keep the encoded document at or below 1 MiB.');
  }
}

export function parseJson(source: string): unknown {
  let depth = 0;
  const keys: Set<string>[] = [];
  const enter = () => {
    if (++depth > maxDepth) fail('DOCUMENT_TOO_DEEP', '', 'Keep JSON nesting at or below 64 containers.');
  };
  visit(source, {
    onObjectBegin() { enter(); keys.push(new Set()); },
    onObjectEnd() { depth--; keys.pop(); },
    onArrayBegin: enter,
    onArrayEnd() { depth--; },
    onObjectProperty(name, _offset, _length, _line, _character, path) {
      const pointer = `/${[...path(), name].map(pointerPart).join('/')}`;
      if (keys.at(-1)!.has(name)) fail('DUPLICATE_KEY', pointer, 'Remove the duplicate JSON object key.');
      keys.at(-1)!.add(name);
    },
    onLiteralValue(value, _offset, _length, _line, _character, path) {
      if (typeof value === 'number' && !Number.isFinite(value)) {
        fail('INVALID_NUMBER', `/${path().map(pointerPart).join('/')}`, 'Use a finite JSON number.');
      }
    },
    onError() { fail('INVALID_JSON', '', 'Use strict JSON: no comments, trailing commas, or malformed values.'); },
  }, { disallowComments: true, allowTrailingComma: false, allowEmptyContent: false });
  // JSON.parse supplies standard own-property semantics, including __proto__.
  try { return JSON.parse(source) as unknown; }
  catch { return fail('INVALID_JSON', '', 'Use one complete, valid JSON value.'); }
}

function validateCharacter(value: unknown): FormatResult<CharacterDocument> {
  const id = object(value) && typeof value.id === 'string' ? value.id : undefined;
  if (!validate(value)) {
    return {
      ok: false,
      diagnostics: (validate.errors ?? []).map((error) => {
        const field = error.keyword === 'additionalProperties' ? error.params.additionalProperty
          : error.keyword === 'required' ? error.params.missingProperty : undefined;
        const pointer = error.instancePath + (field === undefined ? '' : `/${pointerPart(field)}`);
        const code = error.instancePath === '/specVersion' ? 'UNSUPPORTED_VERSION'
          : error.keyword === 'additionalProperties' ? 'UNKNOWN_FIELD' : 'SCHEMA_INVALID';
        return diagnostic('structural', code, pointer,
          `Correct this field: ${error.message ?? 'value does not match the character schema'}.`, id);
      }),
    };
  }
  const diagnostics: FormatDiagnostic[] = [];
  for (const profileId of Object.keys(value.extensions ?? {})) {
    if (!Object.hasOwn(value.profiles ?? {}, profileId)) {
      diagnostics.push(diagnostic('semantic', 'UNDECLARED_PROFILE', `/extensions/${pointerPart(profileId)}`,
        'Declare this extension in profiles with an exact version and required flag.', id));
    }
  }
  const recordIds = new Set<string>();
  for (const collection of ['intentions', 'memories'] as const) {
    for (const [index, record] of (value.startingState?.[collection] ?? []).entries()) {
      if (recordIds.has(record.id)) {
        diagnostics.push(diagnostic('semantic', 'DUPLICATE_RECORD_ID', `/startingState/${collection}/${index}/id`,
          'Give every starting-state record a distinct stable ID.', id));
      }
      recordIds.add(record.id);
    }
  }
  const paths = new Set<string>();
  for (const [resourceId, resource] of Object.entries(value.resources ?? {})) {
    const pointer = `/resources/${pointerPart(resourceId)}/path`;
    const segments = resource.path.split('/');
    if (/[\\:%?#\u0000-\u001f\u007f]/.test(resource.path)
      || segments.some((part) => part === '' || part === '.' || part === '..')) {
      diagnostics.push(diagnostic('semantic', 'INVALID_RESOURCE_PATH', pointer,
        'Use a bundle-relative POSIX path without dot/empty segments, backslashes, control characters, or URI syntax.', id));
    }
    if (paths.has(resource.path)) {
      diagnostics.push(diagnostic('semantic', 'CONFLICTING_RESOURCE', pointer,
        'Use one authoritative document ID for each resource path.', id));
    }
    paths.add(resource.path);
  }
  return diagnostics.length ? { ok: false, diagnostics } : { ok: true, value };
}

/** Reads character data only; never resolves files, loads profiles, or authorizes execution. */
export function readMappedCharacter(
  source: string, representation: CharacterRepresentation = 'json',
): FormatResult<unknown> {
  try {
    checkSize(source);
    if (representation === 'json') return { ok: true, value: parseJson(source) };
    const opening = /^```simkind\r?\n/.exec(source);
    if (!opening) fail('INVALID_MARKDOWN', '', 'Start the first line with exactly ```simkind followed by a newline.');
    const remainder = source.slice(opening[0].length);
    const closing = /^```(?:\r?\n|$)/m.exec(remainder);
    if (!closing) fail('INVALID_MARKDOWN', '', 'Close the metadata with a standalone ``` line.');
    const metadata = parseJson(remainder.slice(0, closing.index));
    if (!object(metadata)) fail('INVALID_MARKDOWN_METADATA', '', 'Use one JSON object for character metadata.');
    if (object(metadata.persona) && Object.hasOwn(metadata.persona, 'description')) {
      return { ok: false, diagnostics: [diagnostic('parse', 'DESCRIPTION_CONFLICT', '/persona/description',
        'Remove persona.description from metadata; the Markdown body is its sole source.',
        typeof metadata.id === 'string' ? metadata.id : undefined)] };
    }
    // EOF immediately after the closing fence preserves an absent description.
    if (closing[0] !== '```') {
      if (!Object.hasOwn(metadata, 'persona')) metadata.persona = {};
      if (object(metadata.persona)) {
        metadata.persona.description = remainder.slice(closing.index + closing[0].length);
      }
    }
    return { ok: true, value: metadata };
  } catch (error) {
    if (error instanceof ParseFailure) return { ok: false, diagnostics: [error.diagnostic] };
    throw error;
  }
}

export function readCharacter(source: string, representation: CharacterRepresentation = 'json'): FormatResult<CharacterDocument> {
  const parsed = readMappedCharacter(source, representation);
  return parsed.ok ? validateCharacter(parsed.value) : parsed;
}

// Reject values JSON.stringify would silently discard or transform, even in
// opaque extensions. This also bounds recursion and rejects cycles before writing.
export function checkJsonValue(value: unknown, pointer = '', depth = 0): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || value === null) {
    fail('NON_JSON_VALUE', pointer, 'Use JSON values only; undefined, non-finite numbers, and functions cannot round-trip.');
  }
  if (depth >= maxDepth) fail('DOCUMENT_TOO_DEEP', pointer, 'Remove cycles and keep JSON nesting at or below 64 containers.');
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    fail('NON_JSON_VALUE', pointer, 'Use plain JSON objects instead of class instances.');
  }
  if (Object.getOwnPropertySymbols(value).length) fail('NON_JSON_VALUE', pointer, 'Remove symbol keys that JSON cannot preserve.');
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) fail('NON_JSON_VALUE', pointer, 'Use a dense JSON array without extra properties.');
    for (let i = 0; i < value.length; i++) checkJsonValue(value[i], `${pointer}/${i}`, depth + 1);
  } else {
    for (const [key, child] of Object.entries(value)) checkJsonValue(child, `${pointer}/${pointerPart(key)}`, depth + 1);
  }
}

/** Writes validated data without mutating the input or dropping opaque extensions. */
export function writeCharacter(
  document: CharacterDocument, representation: CharacterRepresentation = 'json',
): FormatResult<string> {
  try { checkJsonValue(document); }
  catch (error) {
    if (error instanceof ParseFailure) return { ok: false, diagnostics: [error.diagnostic] };
    throw error;
  }
  const checked = readCharacter(JSON.stringify(document));
  if (!checked.ok) return checked;
  const copy = checked.value;
  let value: string;
  if (representation === 'json') {
    value = `${JSON.stringify(copy, null, 2)}\n`;
  } else {
    const description = copy.persona?.description;
    if (copy.persona) delete copy.persona.description;
    value = '```simkind\n' + JSON.stringify(copy, null, 2) + '\n```'
      + (description === undefined ? '' : `\n${description}`);
  }
  try { checkSize(value); }
  catch (error) {
    if (error instanceof ParseFailure) return { ok: false, diagnostics: [error.diagnostic] };
    throw error;
  }
  return { ok: true, value };
}

/** A required-profile gate only; passing does not establish host compatibility. */
export function checkCharacterProfiles(
  document: CharacterDocument,
  supported: Readonly<Record<string, readonly string[]>>,
): FormatDiagnostic[] {
  return Object.entries(document.profiles ?? {}).flatMap(([id, profile]) => {
    if (!profile.required || (Object.hasOwn(supported, id) && supported[id].includes(profile.version))) return [];
    return [diagnostic('compatibility', 'UNSUPPORTED_REQUIRED_PROFILE', `/profiles/${pointerPart(id)}`,
      'Install support for this exact required profile version or explicitly revise the document before launch.', document.id)];
  });
}
