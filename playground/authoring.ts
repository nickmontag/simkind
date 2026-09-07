import { readFile } from 'node:fs/promises';
import { readDocument, writeDocument, type JsonObject, type PortableDocument } from 'simkind/format';
import { installedHost } from '../examples/portable/hosts/registry.js';

const schema = JSON.parse(await readFile(new URL(import.meta.resolve('simkind/schemas/0.2.0-draft.2/document.schema.json')), 'utf8')) as { $defs: Record<string, JsonObject> };
const names = { character: 'Character', 'character-state': 'CharacterState', scenario: 'Scenario', 'run-config': 'RunConfig', 'tool-catalog': 'ToolCatalog', 'run-bundle': 'RunBundle' } as const;

/** Resolve only local, shipped schema references for presentation. Validation stays authoritative. */
function fields(value: JsonObject, depth = 0): JsonObject {
  if (depth > 6) return {}; // Complex/recursive values use the lossless JSON editor.
  const reference = typeof value.$ref === 'string' && value.$ref.startsWith('#/$defs/') ? schema.$defs[value.$ref.slice(8)] : undefined;
  const resolved = reference ? { ...reference, ...value } : { ...value };
  delete resolved.$ref;
  if (resolved.properties) resolved.properties = Object.fromEntries(Object.entries(resolved.properties as JsonObject).map(([key, child]) => {
    const property = child as JsonObject;
    return [key, { ...fields(property, depth + 1), title: property.title ?? key }];
  }));
  return resolved;
}

export function documentFields(source: string, representation: 'json' | 'markdown') {
  const parsed = readDocument(source, representation);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  const document = parsed.value;
  const formSchema = fields(schema.$defs[names[document.kind]]);
  if (document.kind === 'scenario') (formSchema.properties as JsonObject).initialConditions = installedHost(document.host.contractId).descriptor.initialConditionsSchema as JsonObject;
  return { document, schema: formSchema };
}

export function saveDocumentFields(document: PortableDocument, representation: 'json' | 'markdown'): string {
  const written = writeDocument(document, representation);
  if (!written.ok) throw new Error(JSON.stringify(written.diagnostics));
  return written.value;
}
