# Providers, embedding, and spatial hosts

The package has independent entry points:

| Import | Responsibility |
| --- | --- |
| `simkind` | Existing capability, memory, commitment, lifecycle, and ledger primitives |
| `simkind/format` | Strict documents, Markdown, schemas, card conversion |
| `simkind/runner` | Optional character loop, continuity, checkpoint transactions |
| `simkind/node` | Local source resolution and verified immutable recording I/O |
| `simkind/providers` | JSON-text chat transports; local credentials stay in closures |
| `simkind/spatial` | Optional frame definitions and coordinate conversion |

## Providers

```ts
import { openRouterConnection, ollamaConnection, chatCompletionsConnection } from 'simkind/providers';

const remote = openRouterConnection(key, 'your-explicit-model', {maxOutputTokens: 512});
const local = ollamaConnection('your-installed-model');
const compatible = chatCompletionsConnection({
  provider: 'my-provider', model: 'my-model', apiKey: key,
  endpoint: 'https://provider.example/v1/chat/completions',
});
```

All adapters request `json_object` output and pass the same character context.
They never silently replace models, retry an action, or downgrade unsupported
capabilities. Every result still passes the runner's tool and argument checks.
Cancellation forwards the AbortSignal; a provider ignoring abort retains its
concurrency slot until it settles. Keys and endpoint URLs are absent from portable
model metadata. Redirects are rejected. HTTPS is required except for loopback HTTP.

The CLI supports local models with `SIMKIND_PROVIDER=ollama` and an explicit
`OLLAMA_MODEL`. Optional `OLLAMA_ENDPOINT` selects a local compatible endpoint.
The playground also supports multiple connection slots. Model availability and
JSON-output support depend on the selected backend; mock transport tests are not
proof that every installed model supports them. A model's advertised JSON support
can still produce invalid decisions, which are recorded and contained.

Transport references: [OpenRouter API](https://openrouter.ai/docs/api_reference/overview)
and [Ollama compatibility](https://docs.ollama.com/api/openai-compatibility).

## Embedding

Copy the [embedding starter](https://github.com/nickmibarra/simkind/blob/main/examples/embedding/starter.ts)
into an application. Supply a HostRegistration, file bundle, and explicit model
connections. Call `advance()` from the host's opportunity loop and attach
`runner.events()` / `runner.inspect()` to an optional inspector. A render frame
is not automatically a decision opportunity. You can also use individual root
primitives without adopting the runner or playground.

The starter uses public imports only. `npm run check:consumer` installs the alpha
tarball in an external directory, typechecks all entry points, and verifies saved
recordings and provider/spatial APIs without repository self-resolution.

## Spatial profile 0.1.0

`simkind.spatial` is an optional TypeScript profile. Character definitions require
no body or coordinates. The reference host binds scenario instance IDs to positions
in its own initial conditions. Other hosts can bind those identities to different
bodies or omit bodies entirely. No engine-specific types enter core.

A `SpatialFrame` declares an origin in canonical metres, three orthonormal
right-handed axes, and a positive metres-per-unit scale. Canonical world space is
right-handed with Y up. `toWorld` and `fromWorld` validate frames and finite
coordinates. Mirrored/non-orthogonal bases fail. Frame conversion tests include
translation, rotation, scale, and an exact round trip.

The independent host at
[`examples/spatial/host.ts`](https://github.com/nickmibarra/simkind/blob/main/examples/spatial/host.ts)
implements bounded kinematic 3D motion, spherical static obstacles, speech,
progress, cancellation with retained partial position, and settled reconstruction.
Its controlled tick is one simulated second. The whole swept straight-line path
is checked against obstacles before admission. Movement progresses at the authored
speed and cannot complete before arrival. Bodies are point agents; there is no
body-body collision, rigid-body physics, pathfinding, or production robot driver.

Observations retain the outer capture/delivery times and use the schema ID
`simkind.spatial:0.1.0` for frame-bearing payloads. This host explicitly observes
all participant poses; that is its sensor policy, not a requirement of the runner.
The same host runs through the scenario CLI or with the playground's viewer.
Tests prove viewer/headless event and state equality for equivalent inputs.
