import { describe, it, expect } from 'vitest';
import { fromWorld, toWorld, validateFrame, worldFrame, type SpatialFrame } from '../src/spatial/index.js';
import { CharacterRunner, createCharacterRunner, replayCheckpoint, type ModelConnection } from '../src/runner/index.js';
import { loadScenario } from '../src/runner/node.js';
import { spatialHost } from '../examples/spatial/host.js';
import { projectScene, type SpatialView } from '../examples/spatial/viewer.js';
import type { JsonObject, RunConfig } from '../src/format/index.js';
const root = new URL('../examples/portable/scenarios', import.meta.url).pathname;
const idle: ModelConnection = { public: { provider: 'fixture', model: 'spatial', settings: {} }, capabilities: { text: true, json: true }, fulfill: async () => ({ output: { toolId: null, arguments: {} } }) };
async function setup(primary = idle) {
  const data = await loadScenario(root, 'orbital-greenhouse.json', 'config-continuity.json'); if (!data.ok) throw new Error(JSON.stringify(data.diagnostics));
  (data.value.documents[data.value.configId] as RunConfig).limits.maxRequests = 1;
  const result = createCharacterRunner(data.value, spatialHost, { primary }, 'run:spatial'); if (!result.ok) throw new Error(JSON.stringify(result.diagnostics)); return result.value;
}
describe('independent headless 3D host', () => {
  it('converts rotated translated scaled frames reversibly and rejects invalid bases', () => {
    const frame: SpatialFrame = { id: 'frame:robot', origin: [10, 20, 30], metresPerUnit: 0.01, axes: [[0, 0, -1], [0, 1, 0], [1, 0, 0]] };
    expect(toWorld([100, 200, 300], frame)).toEqual([13, 22, 29]);
    expect(fromWorld([13, 22, 29], frame)).toEqual([100, 200, 300]);
    expect(() => validateFrame({ ...worldFrame, axes: [[1, 0, 0], [0, 1, 0], [0, 0, -1]] })).toThrow('right-handed');
    expect(() => toWorld([NaN, 0, 0], worldFrame)).toThrow('point');
  });
  it('H12 produces identical records with an attached read-only viewer', async () => {
    const headless = await setup(); const viewed = await setup();
    for (let i = 0; i < 4; i++) {
      headless.step(); viewed.step(); await headless.settleDecisions(); await viewed.settleDecisions();
      const snapshot = viewed.inspect().host as unknown as SpatialView; const before = structuredClone(snapshot);
      expect(projectScene(snapshot).bodies).toHaveLength(3); expect(snapshot).toEqual(before);
    }
    expect(viewed.events()).toEqual(headless.events()); expect(viewed.inspect()).toEqual(headless.inspect());
    expect(replayCheckpoint(headless.checkpoint(), spatialHost)).toEqual(headless.inspect());
  });
  it('reports timed movement and partial position on cancellation, without premature success', async () => {
    const runner = await setup({ ...idle, fulfill: async () => ({ output: { toolId: 'move', arguments: { position: [-4, 3, 0], frameId: 'frame:world' } } }) });
    runner.step(); await runner.settleDecisions();
    expect(runner.status().unresolvedActions).toBe(1); expect(() => runner.checkpoint()).toThrow('settled');
    runner.pauseDispatch(); runner.step();
    expect(runner.inspect().host).toMatchObject({ world: { positions: { 'simkin:aya': [-4, 1, 0] } } });
    runner.cancel('action:request:1');
    expect(runner.status().unresolvedActions).toBe(0);
    expect(runner.events().filter(e => e.type === 'action').some(e => (e.data as JsonObject).status === 'succeeded')).toBe(false);
    const restored = CharacterRunner.restore(runner.checkpoint(), spatialHost, { primary: idle });
    expect(restored.inspect()).toEqual(runner.inspect());
  });
  it('rejects a path through a solid obstacle even when the endpoint is legal', async () => {
    const runner = await setup({ ...idle, fulfill: async () => ({ output: { toolId: 'move', arguments: { position: [4, 0, 0], frameId: 'frame:world' } } }) });
    runner.step(); await runner.settleDecisions();
    expect(runner.events().at(-1)?.data).toMatchObject({ status: 'rejected' });
    expect(runner.inspect().host).toMatchObject({ world: { positions: { 'simkin:aya': [-4, 0, 0] } } });
  });
});
