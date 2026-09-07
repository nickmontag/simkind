# Phase 2 playground, authoring, and contributions

Current alpha implementation and remaining scope are summarized in
[the release report](../release-alpha.md). This design remains a broader contributor
reference; current guides take precedence for supported commands and capabilities.

Status: draft design. Audience: contributors designing future releases.

M2 now supports [file authoring and CLI execution](../portable-scenarios.md).
The local browser playground, event inspector, character-state and host-defined
world interventions, ordinary schema-derived fields, playback sharing, and exact
sibling-continuation comparison are implemented. Arbitrary cast/world edits,
specialized graphical editors, and independent human usability trials remain
outside the demonstrated scope. See the current guides for supported operations.

These proposed product and implementation requirements describe a client of
the [format](schema.md) and [host protocol](host-protocol.md), not a
second runtime. See [milestones M2–M7](../../roadmap.md).

## Primary user journeys

### Author a group interaction

1. Choose an installed host template: conversation room or constrained world.
2. Load/create a scenario and cast. Edit personas, motivations, private information,
   and initial conditions through forms, JSON, or character Markdown.
3. Choose provider connections and models, including per-character overrides.
4. Inspect compatibility diagnostics and the effective configuration.
5. Start the run, follow interactions, and inspect a character or action.
6. Save a run bundle, share a permitted export, or branch at a supported checkpoint.

Users author situations and possibilities, not a desired action sequence. A
committee setup should not require locations, sprites, or survival statistics.

### Embed characters in another application

1. Install the published alpha package and use the small integration starter.
2. Bind existing character IDs to permitted observations and host tools.
3. Use the ready-made runner or individual primitives.
4. Return actual action results and persist state using host-owned storage.
5. Optionally attach the recorder/inspector without adopting the entire playground.

The independent 3D host and conversation host must use these same interfaces.
The playground must not rely on private imports from either demo.

## Authoring surfaces

Provide a scenario summary, cast list, per-character editor, host settings, model
assignments, and feature controls. Generate ordinary fields from schema titles,
descriptions, enums, and constraints. A custom editor may improve complex fields,
but its output must pass the same validation as hand-authored files.

Character prose remains comfortable to edit. Preserve unknown optional extensions
through form saves; never discard them because no UI control exists. Show required
unsupported profiles and block launch. Missing model selection is an error, not
permission to choose a provider default.

Treat JSON and Markdown as representations of one resource. Show which file is
authoritative. Import/conversion reports identify preserved, transformed, and
unmapped content. A generated draft scenario must be reviewed/validated like any
other authoring input; generation never installs executable host code.

## Effective configuration and credentials

Present resolved values, their source (default/scenario/run/instance), selected
profile versions, host constraints, and provider capability diagnostics. Explain
feature semantics: disabling memory retrieval does not erase memories.

Use local/server-side provider connections. Browser views receive slot names and
redacted status, not stored secrets. Portable exports never contain keys. Operator
connection setup is separate from scenario data. Do not silently replace an
unavailable model or ignore an unsupported structured-output constraint.

Expose request limits, deadlines, and usage alongside model selection. Distinguish
actual reported usage from estimates and work still in flight.

## Running and presentation

Essential controls: start, pause dispatch, step to a supported host boundary,
stop, save, inspect. The host declares whether it can pause progression or restore.
Do not use a paused animation as evidence that the simulation or physical host
has paused. Show running/unresolved actions and pending provider work separately.

Default layout:

- Cast/perspective selector.
- Conversation and consequential-event timeline.
- Current character context: observations, supplied memories, intentions,
  interpretations, and optional agreement/relationship records.
- Selected-action detail: proposal, available tool contract, result, and effects.
- Run status: host time, pending work, usage, checkpoint availability.

Spatial presentation is optional. A location graph is enough initially; the 3D
reference host may attach a simple viewer. Headless execution must produce the
same host records as execution with a viewer attached, for the same inputs and
host configuration.

## Evidence inspector

For a selected decision show:

1. Model/request identity and public request configuration.
2. Host observations and revision used to construct context.
3. Actual memory content supplied, including source references.
4. Available tool descriptors and effective context transformations.
5. Parsed proposal, validation result, progress, and terminal/uncertain outcome.
6. Resulting world events and character-state revisions.

A context inclusion is evidence of availability, not proof the model used it.
Any model-generated explanation is labeled as a self-report. Do not generate an
unmarked retrospective explanation that appears to be the original reasoning.

Separate character perspective from operator inspection. Host-only state, other
characters' private memories, and full transcripts may be available to an authorized
operator, but switching the UI view must never change a character's input context.
Show unavailable or redacted evidence explicitly instead of inventing a substitute.

## Interventions and branches

An intervention editor lists operations allowed by the current host: deliver a
message, introduce a character, reveal information, or change an allowed condition.
Show target instance/entity, expected revision, and intended change before applying.
Record actor, payload, validation result, time, and effects. Stale edits fail atomically.

A branch starts from a compatible settled checkpoint. The UI displays parent,
checkpoint, intervention, and chosen continuation configuration. The parent remains
unchanged. Comparison aligns the shared prefix and then shows divergent records;
it must not pretend that equal tick numbers imply equivalent physical situations.

Useful comparison views: dialogue, commitments, information available to each
character, world outcomes, and cost. Multi-run comparisons should include variation
and failures. One branch pair is not a general causal finding.

## Sharing and exports

Offer explicit export purposes: playback, compatible replay, or resumable bundle.
Validate that the chosen export actually includes its required resources. A public
export can redact private content, but it must declare the missing evidence and
any lost replay/resume capability. Removing credentials is always required.

A saved live run is useful as a shareable artifact; do not make free/scripted mode
the headline onboarding experience. Lead with BYOK model selection and live
characters, then explain playback and deterministic developer fixtures separately.

## Showcase and contribution template

Ship at least two contrasting situations:

- Promises and Rumors: small cast, scarce resource, asymmetric knowledge, and
  competing obligations. Leave strategies and outcome open.
- Shared Decision: non-spatial participants discussing a consequential shared
  choice under an explicit host rule for recording the result.

Each contribution contains:

- Premise, author/license, host/profile requirements, and format version.
- Editable cast and scenario documents.
- What each participant initially knows and what the operator can inspect.
- Tool semantics and host constraints, or references to their installed contract.
- Run instructions with explicit model configuration.
- Representative run artifact and limitations; no promised canonical plot.
- Structural/semantic fixtures and any optional behavioral observations.

A contribution reusing a host should add data, not copy the framework. New host
code is reviewed separately from scenario content. Reuse must remain possible
without a central hosted marketplace.

## Implementation sequence and acceptance

First build author/load/validate/run plus the event timeline. Then add character
perspective and action evidence. Add playback before resume/branch controls, which
must be enabled only for compatible hosts. Finally add importers and sharing reports.

Usability acceptance: a person outside the team can create a new cast/situation,
select a model, launch it, explain one surprising result using recorded evidence,
and give another person a usable artifact. Record where they needed maintainer
help and fix the workflow before claiming the release is contributor-ready.
