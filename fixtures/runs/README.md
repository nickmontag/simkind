# Portable run evidence

The `shared-decision`, `pump-crisis`, and `orbital-greenhouse` directories contain
two-step deterministic **developer fixtures**, not behavioral evaluations. One
fixture participant speaks and the remaining decisions explicitly take no action.
Each directory includes frozen source bytes, event records, hashes, and a settled
checkpoint. Fixture generation verifies exact local host reconstruction before
writing and verifies the exported hashes after writing.

Run `npm run check:runs` to reproduce all three in a temporary directory and
compare every generated file. `npm run generate:runs` writes new directories only;
intentional fixture replacement should be reviewed as a contract change.

Tests additionally cover timed movement, partial-position cancellation, blocked
paths, state revisions, private perspectives, restore mismatch, parent preservation,
redaction, and changed hashes. These recordings alone do not cover all those cases.

`live-glm-5.3-flash` is a separate live sample from 2026-09-07: three requests to
`z-ai/glm-5.3-flash`, each capped at 256 output tokens. One response produced a
valid speech action; two produced contained provider errors. It is retained
without selecting away the failures. The successful response reported 1,243 input
and 80 output tokens, costing $0.00022645; failed-request usage was unavailable.
This is limited live evidence, not a provider reliability or character-quality claim.
