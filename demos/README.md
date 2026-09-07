# Demos

Each directory under `demos/` is an interchangeable, self-contained host for
the public `simkind` package. A demo owns its world model, simkin schema,
provider prompts, policies, presentation, and evaluation. Demos must not import
from `src/` or from another demo.

A demo should provide:

- a README stating the question it explores;
- one command to run it;
- an in-memory deterministic mode;
- optional live-provider code kept inside its directory; and
- notes capturing what was learned before the prototype is deleted or promoted.

There is deliberately no shared demo framework yet. Shared infrastructure
should be extracted only after two demos need the same thing.
