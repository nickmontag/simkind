import { readFile, writeFile } from 'node:fs/promises';
import { compile } from 'json-schema-to-typescript';

for (const [source, destination, typeName, variable] of [
  ['0.2.0-draft.1/character', 'character', 'CharacterDocument', 'characterSchema'],
  ['0.2.0-draft.2/document', 'documents', 'PortableDocument', 'documentSchema'],
  ['0.2.0-draft.2/memory-retrieval', 'memory-retrieval', 'MemoryRetrievalConfig', 'memoryRetrievalSchema'],
]) {
const schemaPath = new URL(`../schemas/${source}.schema.json`, import.meta.url);
const target = new URL(`../src/format/${destination}.generated.ts`, import.meta.url);
const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
const banner = `// Generated from schemas/${source}.schema.json.\n`
  + '// Run npm run generate:format; do not edit by hand.';
const typeSchema = destination === 'documents'
  ? { $defs: schema.$defs, title: 'FormatTypes', type: 'object', additionalProperties: false,
      properties: { document: { title: typeName, oneOf: schema.oneOf },
        observation: { $ref: '#/$defs/Observation' }, proposal: { $ref: '#/$defs/ActionProposal' },
        actionEvent: { $ref: '#/$defs/ActionEvent' }, runEvent: { $ref: '#/$defs/RunEvent' } } }
  : schema;
const types = await compile(structuredClone(typeSchema), typeName, {
  bannerComment: banner,
  style: { singleQuote: true, trailingComma: 'all' },
  $refOptions: { resolve: { http: false } },
  unreachableDefinitions: true,
});
const output = `${types}\nexport const ${variable} = ${JSON.stringify(schema, null, 2)};\n`;
if (process.argv.includes('--check')) {
  if (await readFile(target, 'utf8').catch(() => '') !== output) {
    throw new Error('Generated format code is stale. Run npm run generate:format.');
  }
} else {
  await writeFile(target, output);
}
}
