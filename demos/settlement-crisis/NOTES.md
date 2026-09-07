# Prototype notes

## Question

Can local information and engine-owned constraints produce understandable
coordination without adding settlement concepts to Simkind core?

## Verdict

The isolated-host shape works: the demo needed no settlement concepts in core
and consumes only public Simkind exports. The deterministic 20-tick smoke kept
all six simkins alive, repaired the pump, treated Ren and Nia, fulfilled three
resource requests, and contained one illegal proposal.

A six-tick Luna smoke used 36 parallel local-snapshot decisions. It produced no
repeated non-Wait action, but five actions were contextually rejected and the
simkins sometimes crossed paths while trying to meet, delaying Ren's treatment.
That suggests the next demo iteration should explore explicit rendezvous plans
or short-lived shared commitments rather than giving simkins global positions.
The sample used 27,656 tokens and cost $0.0047921.

Do not promote the terminal renderer, settlement schema, or provider prompt to
core. Revisit extraction only after a second demo independently needs the same
host-level convention.
