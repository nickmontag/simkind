# Experimental character format

`simkind/format` reads and writes the **character subset** of `0.2.0-draft.1`.
The format revision is independent of the package version. This is the first
implemented Phase 2 boundary. The [portable scenario guide](portable-scenarios.md)
documents the newer draft.2 document family and M1/M2 runner; this page retains
the supported draft.1 character API and exact Markdown mapping.

## Read, edit, and validate

```ts
import { readCharacter, writeCharacter, checkCharacterProfiles } from 'simkind/format';

const result = readCharacter(JSON.stringify({
  specVersion: '0.2.0-draft.1',
  kind: 'character',
  id: 'character:aya',
  name: 'Aya',
}));

if (result.ok) {
  const markdown = writeCharacter(result.value, 'markdown');
  if (markdown.ok) console.log(markdown.value);
  console.log(checkCharacterProfiles(result.value, { 'example.style': ['1.0.0'] }));
} else {
  console.error(result.diagnostics);
}
```

Read/write return `{ ok: true, value }` or `{ ok: false, diagnostics }`.
Diagnostics contain `stage`, `code`, `pointer` (JSON Pointer, empty for the
document), `message`, and `documentId` when available. Malformed JSON may not
have a trustworthy ID. Successful reads return data, with no `executable` flag.

From a source checkout:

```sh
npm run format:check -- fixtures/format/aya.simkind.md
npm run generate:format
npm run check
```

`format:check` accepts local character files, emits JSON results, and exits
nonzero on failure. It does not load referenced resources. The reader also
accepts strings supplied by a browser or application.

## Supported fields and limits

Required fields are `specVersion`, `kind`, `id`, and `name`. Optional fields:

- `persona`: `description`, string-array `motivations`, and `speakingStyle`.
- `startingState`: intentions (`id`, `description`) and memories (`id`, `text`,
  `source.kind`). Source kinds: authored, observation, report, interpretation.
  Experiences are private character context; source labels are not event proof.
- `metadata`: title, description, author, license, and string-array tags.
- `profiles`: namespaced IDs mapped to exact version strings and required flags.
- `extensions`: opaque JSON keyed by a declared profile ID.
- `resources`: document IDs mapped to `{ path }` descriptors.

The [JSON Schema](../schemas/0.2.0-draft.1/character.schema.json) is the structural
source of truth. It is exported as
`simkind/schemas/0.2.0-draft.1/character.schema.json` too. Generated TypeScript
cannot express every constraint; runtime validation remains necessary.

Unknown core fields, unsupported format revisions, duplicate JSON keys (including
escaped equivalents), duplicate starting-state record IDs, and undeclared
extensions are errors. JSON is strict: no comments, trailing commas, BOM, or
non-finite numbers. Documents are limited to 1 MiB in UTF-8 and JSON nesting to
64 containers. The writer rejects non-JSON JavaScript values instead of silently
dropping them. Numbers use JavaScript's finite-number precision.

Resource paths use a conservative relative POSIX subset: no empty/dot segments,
backslashes, control characters, colon, percent, query, or fragment syntax.
Two IDs cannot designate one path. These reader checks are lexical only; the
draft.2 loader separately verifies real paths against the bundle root (including
symlinks), document IDs, hashes, and cycles. Reading never fetches files,
schemas, media, or code.

## Exact Markdown mapping

The first line is exactly a `simkind` fence. Metadata is one JSON object;
the closing fence occupies a standalone line. LF and CRLF delimiters work.
The body is preserved without trimming or normalizing line endings:

````markdown
```simkind
{"specVersion":"0.2.0-draft.1","kind":"character","id":"character:aya","name":"Aya"}
```
Aya repairs things and remembers who helped her.
````

Metadata cannot contain `persona.description`, even with an empty body.
A newline after the closing fence introduces the description; zero remaining
characters means an empty string. A closing fence at **EOF without a following
newline** represents an absent description. This distinguishes minimal identity,
`persona: {}`, and an empty description. An editor automatically appending a
final newline changes that meaning.

Writing uses two-space JSON indentation and LF metadata delimiters; original
JSON spacing/key order need not survive. Input objects are never mutated.
Repeated writes of the same data are deterministic. Unknown optional extensions
survive both representations unchanged at the parsed-data level.

## Profiles and remaining work

The reader retains required profiles it does not understand.
`checkCharacterProfiles` returns diagnostics for required versions absent from
the application's advertised support map. Unsupported optional profiles are
retained but ignored. Passing this gate does not validate profile content or
establish host, provider, resource, or replay compatibility. Applications must
not treat a supported-version declaration as an implementation.

The other five document kinds, historical memory references, scenario loading,
launch validation, memory-selection profile, runner, and explicit character
upgrade now exist in draft.2. Playback UI and branching remain planned. Existing
runtime APIs and old host-specific recordings are unchanged. See the
[Phase 2 designs](https://github.com/nickmibarra/simkind/blob/main/docs/design/README.md).

## Schema maintenance

Edit the versioned JSON Schema, run `npm run generate:format`, and update the
fixtures with the intended semantics. `npm run check` rejects stale generated
types/schema copies. Compilation uses [Ajv's Draft 2020-12 validator](https://ajv.js.org/json-schema.html#draft-2020-12)
with strict schema checking and no coercion, defaults, or field removal. Types
come from [json-schema-to-typescript](https://github.com/bcherny/json-schema-to-typescript).
Parsing uses [jsonc-parser](https://github.com/microsoft/node-jsonc-parser),
rejecting comments and every parse error rather than accepting recovered data.

The separate entry point keeps format code out of existing runtime imports.
Schemas have no hosted `$id` until an immutable publication exists. Future
changes to accepted shape or meaning require another explicit revision and
fixture evidence.
