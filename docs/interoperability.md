# Interoperability and sharing

## Character cards

`importCharacterCard(json, newCharacterId)` from `simkind/format` imports the six
base text fields of character-card v1 JSON or a v2 (`chara_card_v2`, `2.0`)
envelope. Name maps to `name`; description and personality combine into persona
prose. The returned report names each mapping, preserved fields, and behavioral
losses. The complete original JSON is retained under optional
`simkind.card-source/0.1.0` data in the `simkind.card-source` extension.

Scenario text, first messages, example conversations, lorebooks, prompt overrides,
creator metadata, and unknown data are preserved without becoming executable
instructions, model settings, or permissions. Review and author host bindings
separately. This is a conversion subset, not an implementation of another
frontend's prompting behavior. PNG extraction and v3 cards are unsupported.
JSON/Markdown round trips preserve the inert extension. See the upstream
[Character Card V2 specification](https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v2.md).

```ts
import { importCharacterCard, writeDocument } from 'simkind/format';
const imported = importCharacterCard(cardJson, 'character:visitor');
if (imported.ok) {
  console.log(imported.value.report);
  const markdown = writeDocument(imported.value.document, 'markdown');
}
```

## Independent Python reader

The [Python reader](https://github.com/nickmibarra/simkind/tree/main/examples/python-reader)
uses Python and jsonschema, without the TypeScript implementation:

```sh
python3 -m venv .internal/python-reader
.internal/python-reader/bin/pip install -r examples/python-reader/requirements.txt
.internal/python-reader/bin/python -m unittest discover -s examples/python-reader -v
.internal/python-reader/bin/python examples/python-reader/simkind_reader.py \
  fixtures/format/draft.2/character.json
```

Its declared subset includes all six positive draft.2 document fixtures,
structural JSON Schema validation, strict decoded duplicate-key rejection, UTF-8,
size/depth bounds, unknown-core-field rejection, local resource-path syntax,
optional extension preservation, and character Markdown body presence.
It does not implement launch resolution, tool-schema compilation, all TypeScript
semantic checks, profiles at execution, checkpoints, hosts, or model providers.
Passing it does not establish host compatibility. CI runs this subset separately.

## Shareable evidence

`saveRun` produces a directory containing manifest, exact inputs, ordered events,
and optional settled checkpoints. Copy the directory intact to share a full
recording; the receiver uses `loadRun` to check it before inspection or restoration.
Directory hashes are integrity checks, not signatures or proof of trust.

The playground exports `simkind.playback/1` JSON for standalone viewing. It
explicitly removes sources/checkpoints and downgrades resume/replay capability.
Import playback never executes tools or providers, even if a supplied manifest
claims it can. Metadata-only export strips all event content and effective model
assignments. Perspective filtering does not redact underlying evidence.

## Editable showcases and contributor walkthrough

The repository ships four situations using three hosts:

| Scenario | What to change | Open question |
| --- | --- | --- |
| Shared Decision | Grant options, personas, private concerns | What choice, if any, will participants record? |
| Workshop | Shared context and competing interests | Can participants find a useful arrangement? |
| Pump Crisis (Promises and Rumors) | Resources, routes, repair conditions, private memories | What will participants reveal, promise, refuse, or do? |
| Orbital Greenhouse | 3D positions, obstacles, context, speed | How will embodied participants explore and coordinate? |

Files in `examples/portable/scenarios/` are editable data. All are distributed
under the repository's MIT license, authored by the Simkind contributors. The
first three reuse the M2 cast; no new framework copy is needed to add a situation.
The operator sees all records; characters see only their host observations and
own state. World tool contracts live in the scenario's referenced tool catalog.

To contribute a scenario from a fresh checkout:

1. Follow README setup and select a model. Start the playground or use the CLI.
2. Copy `shared-decision.json`, give it a new ID, and change its initial context,
   offered options, and starting private memories. Keep its installed host contract
   and tool catalog unchanged. The CLI accepts your new filename through `--scenario`.
3. Add or reuse character resources, set model slots for every instance, and use
   Validate / `--check` to inspect the effective result before dispatch.
4. Run with a small authored request/step budget. Save the result; inspect actual
   supplied context, proposals, and host outcomes. Refusal is a legal choice.
5. Include premise, authorship/license, host/profile versions, commands, limits,
   private-information policy, and representative evidence in the contribution.
   Identify scripted fixtures separately from live samples; do not promise a plot.
6. Run `npm run check`, `npm run check:runs`, and `npm run check:consumer`.

The walkthrough and clean external-consumer test are delivered. They have not
been independently tested by an outside human contributor. Deterministic public
recordings are in `fixtures/runs/`; their README names exactly what they prove.
