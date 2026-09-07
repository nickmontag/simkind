import { createCharacterRunner, type HostRegistration, type ModelConnection } from 'simkind/runner';
import { loadScenario, saveRun } from 'simkind/node';

/** Plug this into an application's existing clock/event loop; the host owns all effects. */
export async function embedScenario(options: { root: string; scenario: string; config: string; host: HostRegistration; connections: Record<string, ModelConnection>; runId: string }) {
  const bundle = await loadScenario(options.root, options.scenario, options.config);
  if (!bundle.ok) throw new Error(JSON.stringify(bundle.diagnostics));
  const created = createCharacterRunner(bundle.value, options.host, options.connections, options.runId);
  if (!created.ok) throw new Error(JSON.stringify(created.diagnostics));
  const runner = created.value;
  return {
    runner,
    /** Call once per host-defined opportunity, not once per rendered animation frame. */
    async advance() { runner.step(); await runner.settleDecisions(); return runner.inspect(); },
    /** Use a new destination; saved parents are immutable. */
    async save(directory: string) { await saveRun(directory, runner.manifest(), runner.events(), bundle.value, [runner.checkpoint()]); },
  };
}
