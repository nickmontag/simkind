# Documentation

Start with the [project README](../README.md) to install Simkind, bring your own
API key, choose a model, and run a scenario. Current guides describe the
experimental 0.2.0-alpha.1 library; proposed features are labeled separately.

## Current guides

| Guide | Use it to |
| --- | --- |
| [Architecture](architecture.md) | Understand the library's boundaries and lifecycle |
| [Building simulations](building-simulations.md) | Design scenario rules, perspectives, receipts, dialogue, and general behavioral evaluations |
| [Behavioral evaluation](behavioral-evaluation.md) | Compare social, cooperative, competitive, and long-memory behavior without prescribing outcomes |
| [Durable runs](durable-runs.md) | Supervise unattended sessions, monitor reports, and recover interrupted workers |
| [Host integration](integration.md) | Connect character decisions to your simulation |
| [Experimental character format](character-format.md) | Validate and round-trip the first Phase 2 character document subset |
| [Portable scenarios and runner](portable-scenarios.md) | Author and run portable casts and situations |
| [Memory policies](memory-policies.md) | Configure situational recall, working concerns, embedding adapters and replaceable memory strategy |
| [Continuity](continuity.md) | Retain evidence and revise optional intentions/interpretations |
| [Local playground](playground.md) | Author, inspect, step, and open recorded runs |
| [Small Economy](economy.md) | Watch unequal resources, negotiated trades and jobs, then inspect recorded market history |
| [Fabrication shop](fabrication-shop.md) | Inject customer orders, negotiate paid work and equipment rentals, and follow each character through the business trial |
| [Checkpoints and branches](checkpoints.md) | Distinguish playback, replay, resume, and fresh continuation |
| [Operator interventions](interventions.md) | Preview and record host-defined world changes without granting character tools |
| [Providers, embedding, and spatial hosts](providers-and-spatial.md) | Connect remote/local models and an optional 3D host |
| [Interoperability](interoperability.md) | Convert cards, use the Python reader, and contribute showcases |
| [Alpha release evidence](release-alpha.md) | Check versions, verification, and remaining release gates |
| [Goals and memory](goals-and-memory.md) | Supply evidence, commitments, and recalled memories |
| [Determinism and evaluation](determinism-and-evaluation.md) | Record decisions and understand replay guarantees |
| [Testing](testing.md) | Validate contracts and run development checks |
| [Contributing](../CONTRIBUTING.md) | Make and verify a contribution |
| [Documentation policy](documentation-policy.md) | Decide where a document belongs and keep its status clear |

## Future designs and historical records

The [Phase 2 roadmap](https://github.com/nickmibarra/simkind/blob/main/roadmap.md)
and [design proposals](https://github.com/nickmibarra/simkind/blob/main/docs/design/README.md)
track implementation evidence and remaining release work. Use the current guides above
for runnable commands; proposals remain public contributor references.

The [archive](https://github.com/nickmibarra/simkind/blob/main/docs/archive/README.md)
contains dated observations and superseded documents retained for context.
Use current guides for setup and supported behavior.

These links open the repository because design proposals and historical reports
are intentionally excluded from the installable package. Local planning notes
are also excluded; they are not part of the project's public documentation.

- [Long-run memory](long-run-memory.md): bounded context, model consolidation, indexed evidence, archives, and recovery.
- [Long-run evaluation](long-run-evaluation.md): procedural scaling, controlled live recall, failures, and a fully live economy.
