# Character format fixtures

This directory's original manifest covers draft.1 characters. See
[draft.2](draft.2/README.md) for the implemented six-document family and
launch/host verification.

`cases.json` is a language-neutral manifest for the implemented character subset
of `0.2.0-draft.1`. Input paths are relative to this directory. Each case records
its conformance ID, representation, expected stage/code/pointer or success,
optional equivalent JSON document, and rationale. Profile versions live in the
input documents; `supportedProfiles` supplies the profile gate's capability map.

The runner is `tests/format.test.ts`; run `npm test -- tests/format.test.ts`.
It checks both representation round trips and deterministic rewrites of every
valid fixture, plus adversarial parsing/writing cases.

Coverage: F01–F05 for characters; F06 for the required-profile gate; F09 for
duplicate keys/resource IDs within one document; F10 for lexical path checks.
F06 does not test host launch. F09/F10 do not cover bundle resolution, symlinks,
or resource access. Later document/host coverage is recorded in the draft.2 suite;
full Phase 2 conformance still requires the remaining milestone gates.
Fixture IDs refer to the [conformance plan](../../docs/design/conformance.md).
