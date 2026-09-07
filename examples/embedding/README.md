# Embedding starter

`starter.ts` uses only public package entry points. Supply your HostRegistration,
local scenario/configuration files, run ID, and model connections. Call `advance`
at host-defined opportunity boundaries, use the returned runner for inspection,
and save to a new directory at a supported settled boundary.

See [embedding and spatial hosts](../../docs/providers-and-spatial.md) and
[checkpoints](../../docs/checkpoints.md). The library does not own your render loop,
world state, persistence service, or provider credentials.
