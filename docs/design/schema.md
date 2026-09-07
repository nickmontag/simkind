# Simkind Format: Phase 2 schema architecture

Status: draft design. Audience: contributors designing future releases.

This is not an implemented or published standard. Examples use
`0.2.0-draft.1` as a proposed format revision; it is independent of the npm
package version. Field names are recommended design targets until schemas and
conformance fixtures are implemented together.

See the [roadmap](../../roadmap.md), [host protocol](host-protocol.md),
[authoring experience](playground.md), and
[conformance plan](conformance.md).

## 1. Purpose and non-goals

Standardize portable character context and the contract with a world. Preserve
personas, experiences, intentions, available operations, and evidence of outcomes.
Do not standardize the strategy a model must follow, a universal psychology,
a particular prompt template, a game engine, or a model provider.

Data portability does not imply identical behavior across models or identical
tool semantics across hosts. Unsupported requirements must be visible.

A conforming editor can read/write documents without running any simulation.
Headless operation, embodiment, and physical versus simulated execution are
independent dimensions. Position, skeletons, inventories, and render assets
are never required fields of a character definition.

## 2. Representations and source of truth

- Canonical data model: UTF-8 JSON, validated with JSON Schema Draft 2020-12.
- Human authoring: `.simkind.md`, initially for character definitions only.
- Streams: UTF-8 JSONL for event records and optionally large memory collections.
- Transfer bundle: initially an ordinary directory with a manifest. An archive
  wrapper can be added later without changing document semantics.

Use JSON Schema as the source for generated types, validation, field descriptions,
and basic editor forms. TypeScript implementation types must not silently become
an incompatible second specification. Schema validity is only one validation layer.

Every resource has one authoritative source. Two files with the same document
ID are an error unless an explicit import/remapping operation resolves them.
Generated JSON is build output, not a competing editable source beside Markdown.
JSONL is a storage representation, not an alternative event vocabulary.

### Precise Markdown mapping

The first line is exactly a `simkind` code fence. Its contents are one JSON
metadata object; the closing fence is a standalone line. The remaining bytes
after that line's newline are the Markdown value of `persona.description`.
Do not infer fields from headings or ask an LLM to interpret the document.

````markdown
```simkind
{
  "specVersion": "0.2.0-draft.1",
  "kind": "character",
  "id": "character:aya",
  "name": "Aya",
  "persona": {
    "motivations": ["Be useful", "Protect my independence"]
  }
}
```
Aya is a resourceful mechanic. She dislikes asking for help, but remembers
people who have helped her. She speaks directly and uses dry humor.
````

The metadata must not also contain `persona.description`; reject that conflict.
An absent `persona` is created during conversion. Preserve body text, including
line breaks. JSON-to-Markdown removes only `persona.description` from metadata
and emits it as the body. Round-trip data equality is required; preservation of
JSON indentation/key ordering is not. Leading malformed metadata is an error,
not permission to fall back to prose-only interpretation. JSON-only authoring
remains fully supported. Do not introduce YAML in the first draft.

## 3. Document family and common envelope

Every document requires `specVersion`, `kind`, and `id`. Proposed ID syntax is
`[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`; identifiers are case-sensitive and stable.
Require uniqueness within a resolved bundle. Document IDs, instance IDs, entity
IDs, record IDs, and request IDs have distinct meanings even when their string
syntax is shared. Names are display labels, never reference keys.

| Kind | Purpose | Ownership |
| --- | --- | --- |
| `character` | Reusable identity, persona, motivations, starting experiences | Author; unchanged by instantiation |
| `character-state` | One instance's experiences, intentions, interpretations, relationships | Runtime with explicit write policies |
| `scenario` | Cast, initial conditions, information distribution, host requirements | Author; resolved at launch |
| `tool-catalog` | Operation identifiers, descriptions, argument/result schemas | Host contract |
| `run-config` | Models, feature configuration, scheduling and resource limits | Operator within host limits |
| `run-bundle` | Manifest of resolved inputs, checkpoints, events, outcomes, provenance | Recorder; immutable after finalization |

Optional common fields:

- `metadata`: title, description, author, license, tags, and source attribution.
- `profiles`: map of profile IDs to exact version and required/optional support.
- `extensions`: map of declared profile IDs to profile-defined data.
- `resources`: map of document IDs to bundle-relative file descriptors, when
  the document is an entry point for other resources.

Do not put credentials, executable snippets, or absolute local paths in these
fields. Display prose remains content; it cannot override host permissions.

### Definitions, instances, and world state

A character definition may supply `startingState`. Instantiation copies this
into a new state document with a distinct `instanceId` and a `definitionRef`.
Record the definition revision/content hash in the resolved run. Editing the
template does not retroactively change a running instance.

A character-state document holds character-owned context, not a second copy of
all host state. Location, inventory, and bodies are host-owned bindings or
profile snapshots. Identify their authority and revision; never reconcile two
conflicting copies by guessing.

## 4. Character example

This is an illustrative individual document, not a complete executable bundle.
The first draft should keep its required fields small: envelope and `name`.
Other fields are optional unless a required profile says otherwise.

```json
{
  "specVersion": "0.2.0-draft.1",
  "kind": "character",
  "id": "character:aya",
  "name": "Aya",
  "persona": {
    "description": "A resourceful mechanic who dislikes depending on others.",
    "motivations": ["Be useful to the community", "Protect my independence"],
    "speakingStyle": "Direct, dry humor, reluctant to admit uncertainty"
  },
  "startingState": {
    "intentions": [
      {
        "id": "intention:repair-pump",
        "description": "Get the settlement's pump working again"
      }
    ],
    "memories": [
      {
        "id": "memory:mira-helped",
        "text": "Mira stayed late to help after the workshop flooded.",
        "source": { "kind": "authored" }
      }
    ]
  }
}
```

Motivations describe concerns, not a mandatory ranking algorithm. Do not infer
numeric importance, fixed plans, or completion requirements from prose. Optional
trait scales require a profile defining their meaning; `curiosity: 0.8` alone
is not a portable behavioral guarantee.

## 5. Living records: intentions, memories, and interpretations

State collections use records with stable IDs. Updates target IDs, not display
names. The implementation may index records as maps; interchange ordering is
not semantic unless a field explicitly defines it.

An intention describes what a character currently wants. A host-verifiable
commitment is a separate, optional profile record with participants and evidence
criteria. Changing intentions must not forge fulfillment or erase a recorded
agreement. The host can record what was said without requiring a universal
promise/acceptance protocol.

Memory records require `id`, `text`, and `source.kind`. Proposed source kinds:
`authored`, `observation`, `report`, and `interpretation`. Optional fields include
`eventRefs`, `subjectRefs`, `reportedBy`, `formedAt`, `aboutTime`, and `supersedes`.
Profile-defined salience/confidence may be included; their units and semantics
must be declared. An interpretation is not automatically world truth.

Preserve original events and revisions. A correction creates a record linking
what it supersedes. Archiving or summarizing memories does not silently delete
source evidence; a compact export must disclose unavailable source material.

Time references identify their clock. A memory imported from another world keeps
its origin; it does not become an event in the new world's tick sequence. Missing
historical entity references may remain explicitly unresolved in memory content.
References necessary for execution must resolve before launch. See section 8.

Information access belongs to the host's observation policy. A run may contain
all characters' records for an operator, but each character receives only its
permitted projection. Omitting a visibility field must not make a memory public.
Stored character experiences default to that character's private context.

## 6. Profiles, extensions, and features

Profiles are namespaced, versioned definitions of optional data and semantics.
The following identifiers are proposed reserved names, not existing packages:

- `simkind.memory-retrieval`
- `simkind.reflection`
- `simkind.commitments`
- `simkind.embodiment`
- `simkind.spatial-3d`

Third parties use their own stable namespaces. Do not add a profile merely to
wrap one unconstrained JSON value: publish its schema, semantics, dependencies,
defaults, and conformance fixtures. Extensions must name a declared profile.
Known core objects reject unknown fields to catch misspellings. Unknown optional
extension content is preserved unchanged by data-level round trips.

A reader may store an unsupported required profile. It must not claim the
corresponding document is executable. Launch rejects unsupported required
profiles, unsupported versions, and enabled features without implementations.
Unknown optional data can be preserved without being executed or included in
model context. Never silently enable a substitute behavior.

Feature toggles belong in run configuration, with profile-defined schemas:

```json
{
  "specVersion": "0.2.0-draft.1",
  "kind": "run-config",
  "id": "config:experiment",
  "profiles": {
    "simkind.memory-retrieval": { "version": "0.1.0-draft.1", "required": true },
    "simkind.reflection": { "version": "0.1.0-draft.1", "required": true }
  },
  "features": {
    "simkind.memory-retrieval": {
      "enabled": true,
      "config": { "maxItems": 12 }
    },
    "simkind.reflection": {
      "enabled": true,
      "config": { "trigger": "character-requested" }
    }
  },
  "modelAssignments": {
    "simkin:aya": "primary",
    "simkin:mira": "secondary"
  }
}
```

The profile defines what a toggle does. Disabling retrieval stops that mechanism
from supplying stored memories; it does not delete them. A UI switch must not
change behavior that its schema/description does not disclose. Avoid vague
settings such as `smartMode` or a universal `autonomyLevel`.

Resolve configuration in this order: profile defaults, scenario recommendations,
run overrides, per-instance overrides. For this draft, object keys overlay
recursively and arrays replace; `null` is a value only where explicitly allowed,
not an implicit deletion. Conflicting types fail validation. Host limits are
constraints checked afterward, not another override that expands permissions.
Reject incompatible settings or report an explicit negotiated value before
launch. Record the full effective configuration and versions.

Model assignment values are connection slot names. Local configuration resolves
slots to provider, model ID, and credentials. Resolve exact model IDs and public
request settings into the run record; exclude secrets. There is no default model.
The character definition remains provider-independent.

## 7. Scenario and resource resolution

A scenario references character definitions, its host contract, and initial
conditions. A cast entry has an `instanceId`, `characterRef`, and optional
initial-state overrides. Instance IDs bind relationships and observations to
actual participants; definitions can be instantiated more than once.

Use `resources` to map document IDs to bundle-relative paths. For example:

```json
{
  "specVersion": "0.2.0-draft.1",
  "kind": "scenario",
  "id": "scenario:committee",
  "resources": {
    "character:aya": { "path": "characters/aya.simkind.json" }
  },
  "host": { "contractId": "example.conversation-room", "version": "0.1.0" },
  "cast": [
    { "instanceId": "simkin:aya", "characterRef": "character:aya" }
  ],
  "initialConditions": {
    "sharedContext": "The group must discuss how to use its shared workshop."
  }
}
```

The host contract supplies the schema for `initialConditions` and tool bindings.
A scenario is configuration for an installed host; it is not executable world code.
Do not infer a host from a character's occupation or prose.

Paths are relative to the resource catalog's bundle root. Reject path traversal,
duplicate IDs, conflicting descriptors, and required reference cycles. Referenced
files must be available locally or supplied through an explicit application
resolver. Parsing alone never downloads code, schemas, or media. A shared bundle
must vendor the resources necessary for its claimed playback/conformance level.

Freeze resolved resources in a run manifest with hashes of exact file bytes.
Record both authored sources and compiled documents if Markdown is used. Hashes
identify artifacts; they do not establish the author's trustworthiness.

## 8. Validation and edit semantics

Validation has distinct results:

1. Parse: valid JSON or valid character Markdown mapping.
2. Structural: matches the specified core/profile schema versions.
3. Referential: IDs, files, subjects, frames, and bindings resolve as required.
4. Semantic: clocks, ownership, action contracts, and feature combinations agree.
5. Execution compatibility: the selected host/providers support the requirements.

Diagnostics contain an error code, document ID, JSON Pointer where applicable,
and a repair-oriented explanation. Never report `executable: true` solely because
JSON Schema validation passed. Bound document size and reject duplicate JSON
object keys rather than accepting parser-dependent values.

Use explicit patch operations for edits and live interventions. JSON Patch is
a candidate transport, with `test` or an expected revision for optimistic
concurrency. Resolve record IDs into current pointers before applying a patch;
do not treat an old array index as stable identity. Validate the complete result
and apply atomically. Reject a stale revision without partial mutation.

Authority is independent of patch syntax:

| Actor | Permitted changes |
| --- | --- |
| Author | Templates and initial conditions before launch |
| Operator | Supported recorded interventions, subject to host policy |
| Host | Authoritative world state and action outcomes |
| Character | Proposed intention/interpretation updates allowed by its tools |

A character cannot write another character's private memory or declare its own
world action successful. Post-launch author edits do not silently change the
resolved run. Changing initial conditions creates a new run; changing live state
creates a recorded intervention.

## 9. Run bundles and portability levels

A finalized run-bundle manifest records run ID, format revision, resources,
scenario/config references, host implementation version, profile versions,
model metadata, clock declarations, event-stream descriptors, checkpoint
descriptors, and parent/intervention references when branched.

Keep event history append-only. Live recording may write provisional segments;
finalization hashes immutable segments and records completeness. Clearly mark
truncated runs, unavailable media, redacted data, and missing evidence.

Do not claim deterministic replay from an action ledger alone. Replay requires
compatible host code, initial state, exogenous inputs, ordering, and relevant
randomness. See the [host protocol](host-protocol.md#checkpoints-playback-and-branches).
A playback-only or redacted export can be useful without being resumable.

## 10. Embodiment and world profiles

The character schema does not require a body. Character state may include an
optional embodiment binding to a host entity. In Phase 2 support zero or one
active body per instance; reserve multi-body control for an explicit future
profile rather than silently choosing a routing policy.

Embodiment, presentation, and environment provenance are independent. A headless
3D world is embodied; a browser-rendered chat is not necessarily embodied.
Spatial records, sensors, asynchronous actions, and physical execution semantics
are specified in the [host protocol](host-protocol.md).

Tool descriptors use stable IDs, descriptions, `inputSchema`, and optional
`outputSchema`. A catalog describes an operation but does not grant permission
or define its implementation. Host adapters revalidate contextual legality at
execution. Same-named tools are not automatically semantically interchangeable.

## 11. Versioning and interoperability

Format versions are independent of runtime releases. Publish immutable schema
artifacts with stable `$id` URLs only when those artifacts actually exist.
Until then keep schemas local; do not publish fictitious schema URLs in examples.

During the draft, require explicit supported revisions. Migrations produce a new
artifact and a report of changes/losses; they never reinterpret old data in place.
Use namespaced extensions for compatible additions. A changed meaning requires
a new profile or format version, even if the JSON shape did not change.

Character Card V2/V3 import should map identity/persona content, preserve unmapped
data, and produce a conversion report. Imported system-prompt fields are content
with disclosed origin, not privileged host instructions. Tool import from MCP
can reuse descriptor shapes, but execution remains subject to the host contract.

Conformance levels are document reader/writer, character host, replay host, and
branching host. Publish fixture results separately for each. A second-language
reader is a Phase 2 requirement; adoption by independent hosts is the evidence
needed before claiming an established open standard.

## 12. Implementation decisions and sources

Recommended semantics above are the draft target. Implementers still select:
validator/type-generation tooling, precise profile fixture schemas, installed
host discovery, media resolver APIs, migration CLI names, and bundle compression.
Record decisions with the affected fixtures and rationale. Do not silently
expand required fields or behavioral policies for convenience.

Primary precedents:

- [JSON Schema 2020-12](https://json-schema.org/draft/2020-12): schema vocabulary.
- [JSON Patch, RFC 6902](https://www.rfc-editor.org/info/rfc6902/): explicit edit operations.
- [Character Card V3](https://github.com/kwaroran/character-card-spec-v3/blob/main/SPEC_V3.md): character interchange and extension precedent.
- [MCP tool specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools): tool descriptor conventions; not a required transport.
