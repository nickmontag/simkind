import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  checkCharacterProfiles, readCharacter, writeCharacter,
  type CharacterDocument, type CharacterRepresentation, type FormatResult,
} from '../src/format/index.js';

const fixture = (path: string) => readFileSync(new URL(`../fixtures/format/${path}`, import.meta.url), 'utf8');
const minimal: CharacterDocument = {
  specVersion: '0.2.0-draft.1', kind: 'character', id: 'character:aya', name: 'Aya',
};

function value<T>(result: FormatResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}

interface FixtureCase {
  id: string;
  input: string;
  representation: CharacterRepresentation;
  equivalent?: string;
  expected: { ok: boolean; stage?: string; code?: string; pointer?: string };
  supportedProfiles?: Record<string, string[]>;
  compatibilityCode?: string;
}
const cases = JSON.parse(fixture('cases.json')) as FixtureCase[];

describe('portable format fixtures', () => {
  for (const test of cases) {
    it(`${test.id}: ${test.input}`, () => {
      const result = readCharacter(fixture(test.input), test.representation);
      expect(result.ok).toBe(test.expected.ok);
      if (!result.ok) {
        const { ok: _ok, ...expected } = test.expected;
        expect(result.diagnostics).toContainEqual(expect.objectContaining(expected));
        return;
      }
      if (test.equivalent) expect(result.value).toEqual(value(readCharacter(fixture(test.equivalent))));
      for (const representation of ['json', 'markdown'] as const) {
        const encoded = value(writeCharacter(result.value, representation));
        expect(value(readCharacter(encoded, representation))).toEqual(result.value);
        expect(value(writeCharacter(value(readCharacter(encoded, representation)), representation))).toBe(encoded);
      }
      if (test.supportedProfiles) {
        const diagnostics = checkCharacterProfiles(result.value, test.supportedProfiles);
        expect(diagnostics.map((d) => d.code)).toEqual(test.compatibilityCode ? [test.compatibilityCode] : []);
      }
      expect(result).not.toHaveProperty('executable');
    });
  }
});

describe('strict document boundary', () => {
  it.each([
    ['comment', '{/* comment */"id":"x"}'],
    ['trailing comma', '{"id":"x",}'],
    ['trailing value', '{} {}'],
    ['empty', ''],
    ['malformed number', '{"value":01}'],
    ['BOM', '\ufeff{}'],
  ])('rejects %s instead of repairing it', (_name, source) => {
    expect(readCharacter(source)).toMatchObject({ ok: false, diagnostics: [{ stage: 'parse', code: 'INVALID_JSON' }] });
  });

  it('rejects duplicate nested escaped keys with a JSON Pointer', () => {
    const source = '{"extensions":{"example.style":[{"a/b~c":1,"a\\u002fb~c":2}]}}';
    expect(readCharacter(source)).toMatchObject({ ok: false, diagnostics: [{ code: 'DUPLICATE_KEY', pointer: '/extensions/example.style/0/a~1b~0c' }] });
  });

  it('allows equal keys in separate objects', () => {
    const doc = { ...minimal, profiles: { 'example.data': { version: '1', required: false } }, extensions: { 'example.data': [{ x: 1 }, { x: 2 }] } };
    expect(value(readCharacter(JSON.stringify(doc)))).toEqual(doc);
  });

  it('bounds encoded bytes, nesting, and numbers in opaque extension content', () => {
    expect(readCharacter(' '.repeat(1024 * 1024 + 1))).toMatchObject({ ok: false, diagnostics: [{ code: 'DOCUMENT_TOO_LARGE' }] });
    expect(readCharacter(JSON.stringify({ ...minimal, name: '界'.repeat(400000) }))).toMatchObject({ ok: false, diagnostics: [{ code: 'DOCUMENT_TOO_LARGE' }] });
    expect(readCharacter('['.repeat(65) + '0' + ']'.repeat(65))).toMatchObject({ ok: false, diagnostics: [{ code: 'DOCUMENT_TOO_DEEP' }] });
    expect(readCharacter('{"x":1e999}')).toMatchObject({ ok: false, diagnostics: [{ code: 'INVALID_NUMBER' }] });
  });

  it('checks required fields, exact versions, kind, and every core object', () => {
    for (const field of ['specVersion', 'kind', 'id', 'name']) {
      const doc: Record<string, unknown> = { ...minimal };
      delete doc[field];
      expect(readCharacter(JSON.stringify(doc))).toMatchObject({ ok: false, diagnostics: [expect.objectContaining({ pointer: `/${field}` })] });
    }
    expect(readCharacter(JSON.stringify({ ...minimal, specVersion: '0.2.0' }))).toMatchObject({ ok: false, diagnostics: [{ code: 'UNSUPPORTED_VERSION', documentId: minimal.id }] });
    const invalid = [
      { kind: 'scenario' }, { body: {} }, { persona: { typo: '' } },
      { metadata: { typo: '' } }, { startingState: { typo: '' } },
      { startingState: { intentions: [{ id: 'i', description: '', status: 'succeeded' }] } },
      { startingState: { memories: [{ id: 'm', text: '', source: { kind: 'authored', public: true } }] } },
      { profiles: { 'example.x': { version: '1', required: true, typo: '' } } },
      { resources: { 'character:x': { path: 'x.json', executable: true } } },
    ];
    for (const fields of invalid) expect(readCharacter(JSON.stringify({ ...minimal, ...fields })).ok).toBe(false);
  });

  it.each(['', ':aya', 'space here', 'a/'.repeat(3), 'a'.repeat(129), 'aya\n'])('rejects invalid document ID %j', (id) => {
    expect(readCharacter(JSON.stringify({ ...minimal, id })).ok).toBe(false);
  });

  it('rejects undeclared extensions and duplicate starting-state record IDs', () => {
    expect(readCharacter(JSON.stringify({ ...minimal, extensions: { 'example.x': {} } }))).toMatchObject({ ok: false, diagnostics: [{ code: 'UNDECLARED_PROFILE' }] });
    expect(readCharacter(JSON.stringify({ ...minimal, startingState: {
      intentions: [{ id: 'record:x', description: 'Try' }],
      memories: [{ id: 'record:x', text: 'Tried', source: { kind: 'authored' } }],
    } }))).toMatchObject({ ok: false, diagnostics: [{ code: 'DUPLICATE_RECORD_ID', pointer: '/startingState/memories/0/id' }] });
  });

  it.each(['/tmp/file', '../file', 'a/../file', './file', 'a//file', 'a/', 'a\\file', 'C:file', 'https://example.org/file', '%2e%2e/file', 'file?x', 'file#x', 'file\u0000'])('rejects unsafe resource descriptor %j', (path) => {
    expect(readCharacter(JSON.stringify({ ...minimal, resources: { 'character:mira': { path } } }))).toMatchObject({ ok: false, diagnostics: [{ code: 'INVALID_RESOURCE_PATH' }] });
  });

  it('retains safe descriptors without reading them and rejects conflicting IDs for one path', () => {
    const resources = { 'character:mira': { path: 'not-present/mira.simkind.json' } };
    expect(value(readCharacter(JSON.stringify({ ...minimal, resources }))).resources).toEqual(resources);
    expect(readCharacter(JSON.stringify({ ...minimal, resources: { ...resources, 'character:other': resources['character:mira'] } }))).toMatchObject({ ok: false, diagnostics: [{ code: 'CONFLICTING_RESOURCE' }] });
  });

  it('checks required profile versions exactly without mutating data', () => {
    const doc = value(readCharacter(fixture('required-profile.simkind.json')));
    const before = structuredClone(doc);
    expect(checkCharacterProfiles(doc, { 'example.style': ['1.0.0'] })).toEqual([]);
    expect(checkCharacterProfiles(doc, { 'example.style': ['2.0.0'] })).toMatchObject([{ stage: 'compatibility', code: 'UNSUPPORTED_REQUIRED_PROFILE', documentId: minimal.id }]);
    expect(doc).toEqual(before);
  });
});

describe('lossless character authoring', () => {
  it.each([undefined, {}, { description: '' }, { motivations: [] }, { description: '\r\n# Aya\n```simkind\n{}\n```\n終わり  ' }])('round-trips persona %j without adding defaults', (persona) => {
    const doc = { ...minimal, ...(persona === undefined ? {} : { persona }) };
    const original = structuredClone(doc);
    const markdown = value(writeCharacter(doc, 'markdown'));
    expect(value(readCharacter(markdown, 'markdown'))).toEqual(doc);
    expect(doc).toEqual(original);
    expect(markdown.endsWith('```')).toBe(persona?.description === undefined);
  });

  it('accepts CRLF fences while retaining every body line ending', () => {
    const body = '\r\nFirst\r\nSecond\n';
    const source = '```simkind\r\n' + JSON.stringify(minimal) + '\r\n```\r\n' + body;
    expect(value(readCharacter(source, 'markdown')).persona?.description).toBe(body);
  });

  it.each(['Just prose', '\n```simkind\n{}\n```', '```json\n{}\n```', '```simkind \n{}\n```', '```simkind\n{}\n``` trailing'])('rejects malformed leading metadata %j', (source) => {
    expect(readCharacter(source, 'markdown')).toMatchObject({ ok: false, diagnostics: [{ code: 'INVALID_MARKDOWN' }] });
  });

  it('requires object metadata and rejects malformed persona instead of overwriting it', () => {
    expect(readCharacter('```simkind\n[]\n```\nbody', 'markdown')).toMatchObject({ ok: false, diagnostics: [{ code: 'INVALID_MARKDOWN_METADATA' }] });
    for (const persona of [null, [], 'persona']) {
      expect(readCharacter('```simkind\n' + JSON.stringify({ ...minimal, persona }) + '\n```\nbody', 'markdown')).toMatchObject({ ok: false, diagnostics: [{ stage: 'structural', pointer: '/persona' }] });
    }
  });

  it('validates writes and rejects lossy JavaScript extension values', () => {
    for (const extension of [undefined, NaN, Infinity, () => 0, 1n, new Date(), [undefined], new Array(2)]) {
      const doc = { ...minimal, profiles: { 'example.x': { version: '1', required: false } }, extensions: { 'example.x': extension } };
      expect(writeCharacter(doc)).toMatchObject({ ok: false, diagnostics: [{ code: 'NON_JSON_VALUE' }] });
    }
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(writeCharacter({ ...minimal, extensions: { 'example.x': cyclic } })).toMatchObject({ ok: false, diagnostics: [{ code: 'DOCUMENT_TOO_DEEP' }] });
    expect(writeCharacter({ ...minimal, id: '' })).toMatchObject({ ok: false });
  });
});
