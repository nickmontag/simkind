# Host-defined operator interventions

An operator can change only conditions explicitly supported by the installed host.
These operations are separate from the character tool catalog. They never appear
in model decision contexts, and a model naming an operator operation is rejected.

```ts
const { revision, operations } = runner.hostInterventions();
const edit = {
  operator: 'operator:researcher',
  operationId: 'operator.message',
  operationVersion: '1.0.0',
  expectedRevision: revision,
  arguments: { text: 'The deadline has changed.', to: 'simkin:aya' },
};
const preview = runner.previewHostIntervention(edit);
if (preview.valid) runner.interveneHost(edit);
```

The preview is read-only. Commit revalidates the expected host revision, input
schema, target, and host constraints. A stale or invalid edit records a rejected
proposal with no effects. A successful edit records accepted and succeeded action
events, operator identity, time, revision, and the host's explicit effects. The
operator identifier must differ from every cast instance. Invalid envelopes and
unsupported hosts fail before a proposal is recorded.

Interventions require a settled, non-stopped boundary: no pending decisions,
active providers, or unresolved actions. The playground additionally requires
automatic running to be paused. Previewing reserves nothing; another condition
change can invalidate it. No arbitrary JSON patch, tool grant, cast mutation, or
physical-world reset is exposed.

## Reference operations

| Host implementation | Operation | Effect and visibility |
| --- | --- | --- |
| Conversation 1.1.0 | `operator.message` | Attributed message to all participants or one existing recipient |
| Conversation 1.1.0 | `operator.context` | Replace shared situation text; preserve messages and votes |
| Settlement 1.1.0 | `operator.pump` | Set whether the pump is broken; visible only through local observations |
| Settlement 1.1.0 | `operator.stock` | Set a bounded resource quantity at an existing place; visible locally |

Effects become available through the host's usual observations on the next
opportunity boundary. An operator-only event is not copied into a character's
action outcomes. A private message is neither delivered to other characters nor
added to their continuity memories. Operator inspection and full exports can
still contain the whole record.

## Implementing a host

Declare `descriptor.interventions` as an array of operation IDs, versions,
descriptions, and input schemas. Implement `previewIntervention(proposal)` and
`intervene(proposal)` alongside the existing `CharacterHost` methods. Use the
proposal's actor as operator identity and `observedRevision` as the exact expected
world revision. Check these again inside the host; do not rely on a UI preview.

Preview must be pure. Commit must validate before changing state and return either
a rejection with no effects or an accepted/succeeded pair. Character `submit`
must not admit these operations. The two local reference hosts use a disposable
world copy to plan edits and replace the live world only after validation.

The operation log, event counters, revisions, and deduplication are part of the
complete host checkpoint. The new implementations use host snapshot version 2;
original 1.0.0 registrations and version 1 recordings remain unchanged. CLI and
playground select the latest implementation for new runs and the exact recorded
implementation for restore. Old recordings do not silently acquire new powers.
The independent spatial host has no operator operations in this release.

See [checkpoints and branch comparison](checkpoints.md) and the
[local playground](playground.md).
