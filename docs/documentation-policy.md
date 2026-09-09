# Documentation policy

Keep public documentation useful to someone who has never seen a maintainer's
conversation with an agent. Separate supported behavior, future proposals,
historical evidence, and private working notes.

## Where documents belong

| Location | Status and audience | What belongs here |
| --- | --- | --- |
| Root `README.md`, `CONTRIBUTING.md`, and current guides in `docs/` | Current; users and contributors | Setup, supported contracts, limitations, reproducible workflows |
| Root `roadmap.md` and `docs/design/` | Planned or draft; contributors | Durable direction, proposed contracts, rationale, open decisions, acceptance criteria |
| `docs/archive/` | Historical or superseded; readers investigating past work | Dated evaluation reports or replaced designs with continuing reference value |
| `.internal/` | Private and local; maintainers and agents | Unvetted proposals, working plans, task handoffs, research scratchpads, transcripts, temporary outputs |

Example and demo READMEs stay beside their code. They document how to run the
example and its current limitations. Raw exploratory logs belong in `.internal/`.
Existing local agent notes in `.claude/` remain ignored as well.

## Private workspace

Create the folders as needed in a fresh checkout:

```sh
mkdir -p .internal/{planning,research,scratch,archive}
```

Use `planning/` for task breakdowns and agent handoffs, `research/` for unedited
investigations, `scratch/` for disposable artifacts, and `archive/` for obsolete
private notes worth keeping locally. No template or placeholder file needs to
be committed. Both the folder and its contents are ignored by Git.

When working with an agent, ask it to put working notes in `.internal/` and
promote only durable, edited findings into public docs. Public docs must stand
alone; do not link to or require files in the private workspace. Ignored files
do not travel with a clone and are not a shared team handoff mechanism.

`npm run check:public` rejects staged files inside `.internal/` and `.claude/`,
even if added with `git add -f`. It also checks environment files and common
credential patterns. Keep API keys in the ignored `.env`, not in notes.
Ignoring or moving a previously tracked file does not remove earlier versions
from Git history.

## Document lifecycle

1. Explore locally in `.internal/` when notes are incomplete, personal, or tied
   to a particular agent session.
2. Keep unvetted proposals in `.internal/planning/`, even if formatted as a finished
   document. Promote a reviewed proposal to `docs/design/` when it has a public purpose: explain
   the problem, decisions, alternatives that matter, compatibility, unresolved
   questions, and acceptance criteria. Label it **draft design** and name its
   audience. Future examples and commands must not look already runnable.
3. When functionality ships, update current guides in the same change. Mark
   the proposal implemented with its release and a link to the current guide,
   or archive it if its remaining value is historical rationale.
4. When guidance is replaced, update incoming links. Keep an archive copy only
   if it explains a useful decision or records evidence; otherwise Git history
   is enough. Remove disposable public notes rather than accumulating them.

An archived document starts with its status, why it is retained, the relevant
date or version, and a replacement link. Use **historical** for an old result;
use **superseded** for replaced guidance. Reserve **deprecated** for a feature
or format still supported but scheduled for removal, with its replacement and
removal policy. An old evaluation does not deprecate an API.

## Review and packaging

Before committing documentation:

- Check that claims match either implemented behavior or an explicit draft label.
- Keep local paths, personal planning, credentials, and private scenario data out.
- Update the relevant index and incoming links when moving or retiring a page.
- Verify local links and example syntax, then stage files and run
  `npm run check:public`.

The `package.json` `files` allowlist includes current guides and project notices.
Add a new current guide explicitly if package consumers need it. Public designs,
the roadmap, and historical reports remain in GitHub; packaged guides link to
those pages on GitHub so their links work outside a checkout.
