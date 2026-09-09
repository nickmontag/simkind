import type { RunEvent, JsonObject } from 'simkind/format';

/** Small observer rows; original contexts remain available through exact evidence lookup. */
export function observerEvent(event: RunEvent): RunEvent {
  const data = event.data as JsonObject;
  if (event.type === 'model-error' && ('rawOutput' in data || 'output' in data)) {
    const { rawOutput: _raw, output: _output, ...summary } = data;
    return { ...event, data: { ...summary, projection: 'observer-summary' } };
  }
  if (event.type === 'request') {
    const context = data.context as JsonObject;
    return { ...event, data: { ...data, context: { requestId: context.requestId, instanceId: context.instanceId,
      ...(context.purpose ? { purpose: context.purpose } : {}), ...(context.contextSize ? { contextSize: context.contextSize } : {}) }, projection: 'observer-summary' } };
  }
  if (event.type === 'model-result' && data.purpose === 'consolidation') {
    return { ...event, data: { ...data, output: { toolId: 'simkind.compact', arguments: {} }, projection: 'observer-summary' } };
  }
  if (event.type === 'observation') {
    const copy = structuredClone(event), observation = copy.data as JsonObject;
    if (observation.recipient === 'operator:market' || observation.recipient === 'operator:shop') {
      for (const content of observation.content as JsonObject[]) {
        const report = content.data as JsonObject;
        if (Array.isArray(report?.history)) report.history = report.history.slice(-2);
      }
    } else observation.content = (observation.content as JsonObject[]).flatMap(content => {
      const you = (content.data as JsonObject | undefined)?.you as JsonObject | undefined;
      return you?.inventory ? [{ ...content, data: { you: { inventory: you.inventory } } }] : [];
    });
    observation.projection = 'observer-summary'; return copy;
  }
  return event;
}
