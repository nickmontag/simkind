import type { Draft, Slot } from './session.js';
import type { compareBranches, HostIntervention, InterventionOperation, InterventionPreview, PreparedLaunch } from 'simkind/runner';
import type { JsonObject, PortableDocument, RunBundle, RunEvent } from 'simkind/format';
import { projectScene, type SpatialView } from '../examples/spatial/viewer.js';
import { schemaForm } from './schema-form.js';
import { renderEconomy, downloadEconomy } from './economy-view.js';
import type { EconomyReport } from '../examples/economy/report.js';
import { economyRecap, renderEconomyRecap } from './economy-recap.js';
import { shopReportSchemaId, type ShopReport } from '../examples/fabrication/report.js';
import { orderSchema } from '../examples/fabrication/catalog.js';
import { renderShopOrders, renderShopWorld, renderShopRecap, shopRecap } from './shop-view.js';
import { economyFrames, shopFrames, TurnCursor, type TurnFrame } from './turn-timeline.js';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const token = document.querySelector<HTMLMetaElement>('meta[name="simkind-session"]')!.content;
const json = (value: unknown) => JSON.stringify(value, null, 2);
let draft: Draft | undefined;
let currentPath = '';
let selectedEvent = -1;
let displayedRunId = '';
let inspectingState = false;
interface Snapshot { memoryEnabled?: boolean; mode: string; busy: boolean; economy?: EconomyReport; shop?: ShopReport; savedRecording?: string; saveNote?: string; automatic?: boolean; canCheckpoint?: boolean; manifest?: RunBundle; events?: RunEvent[]; eventsOffset?: number; launch?: PreparedLaunch; host?: unknown; interventions?: { revision: number; operations: InterventionOperation[] }; status?: { steps: number; requests: number; pendingRequests: number; activeProviders: number; unresolvedActions: number; paused: boolean; stopped: boolean }; failure?: string }
let snapshot: Snapshot = { mode: 'authoring', busy: false };
let readWorldFields = () => ({} as JsonObject);
let previewedWorld: Omit<HostIntervention, 'operator'> | undefined;
const cursor = new TurnCursor();
let frames: TurnFrame[] = [];
let shownBoundary = Infinity;
let replayTimer: ReturnType<typeof setInterval> | undefined;
let navigationBusy = false;
let renderedReport = '';
function stopReplay() { clearInterval(replayTimer); replayTimer = undefined; }
function showPage(page: string) {
  document.querySelectorAll<HTMLElement>('main > .page').forEach(node => { node.hidden = node.id !== page; });
  el<HTMLDetailsElement>('app-menu').open = false;
  window.scrollTo({ top: 0 });
}
function ended() { return !!snapshot.status?.stopped || !!snapshot.economy?.completed || !!snapshot.shop?.completed || (snapshot.status?.steps ?? 0) >= (snapshot.manifest?.limits.maxSteps ?? Infinity); }
async function pauseForHistory() {
  if (snapshot.mode === 'live' && snapshot.automatic) await api('pause', {});
}
async function seekTurn(index: number) {
  stopReplay(); cursor.seek(frames, index); render(); await pauseForHistory();
}
let shownMarket: EconomyReport | undefined;
let shownShop: ShopReport | undefined;
let readOrderFields = () => ({} as JsonObject);
let orderEdit: Omit<HostIntervention, 'operator'> | undefined;
const isShop = (report: EconomyReport | ShopReport | undefined): report is ShopReport => report?.schema === shopReportSchemaId;
let sourceForm: { path: string; source: string; read: () => JsonObject } | undefined;
function invalidateWorldPreview() { previewedWorld = undefined; el<HTMLButtonElement>('world-apply').disabled = true; el('world-preview-result').textContent = 'Preview the current change before applying it.'; }
function editWorldOperation() {
  invalidateWorldPreview();
  const operation = snapshot.interventions?.operations.find(op => op.id === el<HTMLSelectElement>('world-operation').value);
  el('world-description').textContent = operation?.description ?? '';
  el<HTMLInputElement>('world-revision').value = String(snapshot.interventions?.revision ?? 0);
  readWorldFields = schemaForm(el('world-fields'), operation?.inputSchema as JsonObject ?? {}, {}, invalidateWorldPreview);
}
function worldEdit(): Omit<HostIntervention, 'operator'> {
  const operation = snapshot.interventions?.operations.find(op => op.id === el<HTMLSelectElement>('world-operation').value);
  if (!operation) throw new Error('Choose a supported operation.');
  return { operationId: operation.id, operationVersion: operation.version, expectedRevision: Number(el<HTMLInputElement>('world-revision').value), arguments: readWorldFields() };
}
let noticeTimer: ReturnType<typeof setTimeout>;
function notify(message: string) { el('notice').textContent = message; el('notice').style.display = 'block'; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => el('notice').style.display = 'none', 9000); }
async function api<T = unknown>(path: string, data?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, { method: data === undefined ? 'GET' : 'POST', headers: { 'X-Simkind-Session': token, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const value = await response.json(); if (!response.ok) throw new Error(value.error ?? 'Request failed.'); return value;
}
function download(name: string, value: unknown) { const url = URL.createObjectURL(new Blob([json(value)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function captureDraft() {
  if (!draft) throw new Error('Load a scenario first.');
  draft.sources[currentPath] = el<HTMLTextAreaElement>('source').value;
  draft.slots = JSON.parse(el<HTMLTextAreaElement>('slots').value);
  return draft;
}
function syncSlot() {
  if (!draft) return;
  const slots: Record<string, Slot> = JSON.parse(el<HTMLTextAreaElement>('slots').value);
  slots.primary = { ...slots.primary, structuredOutputs: undefined, responseMode: el<HTMLSelectElement>('response-mode').value as Slot['responseMode'], provider: el<HTMLSelectElement>('provider').value as Slot['provider'], model: el<HTMLInputElement>('model').value,
    ...(el<HTMLInputElement>('endpoint').value ? { endpoint: el<HTMLInputElement>('endpoint').value } : {}) };
  el<HTMLTextAreaElement>('slots').value = json(slots);
}
function setDraft(value: Draft) {
  sourceForm = undefined; el('document-fields').replaceChildren(); el<HTMLButtonElement>('apply-fields').disabled = true;
  draft = value; currentPath = value.scenarioPath;
  const selector = el<HTMLSelectElement>('document'); selector.replaceChildren(...Object.keys(value.sources).map(path => new Option(path, path))); selector.value = currentPath;
  el<HTMLTextAreaElement>('source').value = value.sources[currentPath];
  el<HTMLInputElement>('model').value = value.slots.primary.model;
  el<HTMLSelectElement>('response-mode').value = value.slots.primary.responseMode ?? (value.slots.primary.structuredOutputs ? 'schema' : 'json');
  el<HTMLSelectElement>('provider').value = value.slots.primary.provider;
  el<HTMLTextAreaElement>('slots').value = json(value.slots);
  el('scenario-title').textContent = currentPath.replace('.json', '').replaceAll('-', ' ');
}
async function catalog() {
  const value = await api<{ templates: string[]; recordings: string[]; connection: { openrouterKey: boolean; model: string } }>('catalog');
  const selection = el<HTMLSelectElement>('template').value;
  el<HTMLSelectElement>('template').replaceChildren(...value.templates.map(name => new Option(name.replace('.json', '').replaceAll('-', ' '), name)));
  if (selection) el<HTMLSelectElement>('template').value = selection;
  el<HTMLSelectElement>('recordings').replaceChildren(...value.recordings.map(name => new Option(name, name)));
  const comparison = el<HTMLSelectElement>('comparison-recording'); const previous = comparison.value;
  comparison.replaceChildren(new Option('Parent prefix totals', ''), ...value.recordings.map(name => new Option(name, name)));
  if (value.recordings.includes(previous)) comparison.value = previous;
  el('connection-status').textContent = value.connection.openrouterKey ? 'OpenRouter key is configured locally.' : 'OpenRouter key is not configured. Add OPENROUTER_API_KEY to .env, or choose a local Ollama model.';
}
function actorOf(event: RunEvent): string | undefined { const data = event.data as JsonObject; return (data.actor ?? data.recipient ?? (data.context as JsonObject | undefined)?.instanceId) as string | undefined; }
function showEvent(event: RunEvent) {
  if ((event.data as JsonObject).projection === 'observer-summary' || snapshot.memoryEnabled) {
    inspectingState = false; selectedEvent = event.sequence;
    void api('evidence', { sequence: event.sequence }).then(value => { el('detail').textContent = json(value); el('inspector-note').textContent = 'Original recorded evidence, loaded from the archive.'; el<HTMLDialogElement>('evidence-dialog').showModal(); }).catch(error => notify(error.message));
    return;
  }
  inspectingState = false;
  selectedEvent = event.sequence;
  const evidence = snapshot.events?.filter(e => e.sequence <= shownBoundary);
  const data = event.data as JsonObject;
  if (event.type === 'action' || event.type === 'proposal') {
    const proposal = event.type === 'proposal' ? event : evidence?.find(e => e.type === 'proposal' && (e.data as JsonObject).id === data.actionId);
    const proposalData = proposal?.data as JsonObject | undefined;
    const request = evidence?.find(e => e.type === 'request' && (e.data as JsonObject).context && ((e.data as JsonObject).context as JsonObject).requestId === proposalData?.requestId);
    const outcomes = evidence?.filter(e => e.type === 'action' && (e.data as JsonObject).actionId === proposalData?.id);
    el('detail').textContent = json({ selected: event, originalRequest: request ?? 'Unavailable / operator intervention', proposal, outcomes });
  } else el('detail').textContent = json(event);
  if (!el<HTMLDialogElement>('evidence-dialog').open) el<HTMLDialogElement>('evidence-dialog').showModal();
  el('inspector-note').textContent = 'Original recorded evidence. Context inclusion shows availability; it does not prove causal influence.';
}
function render() {
  const runId = snapshot.manifest?.runId ?? '';
  if (displayedRunId !== runId) {
    displayedRunId = runId; selectedEvent = -1; cursor.follow(); stopReplay(); renderedReport = ''; inspectingState = false;
    el<HTMLDialogElement>('evidence-dialog').close();
    el<HTMLDialogElement>('order-dialog').close(); orderEdit = undefined;
    el<HTMLSelectElement>('perspective').value = 'operator'; el<HTMLTextAreaElement>('edit').value = '';
    el('detail').textContent = 'No event selected.';
    el('comparison-traces').replaceChildren(); el('comparison').textContent = 'No branch comparison selected.';
    el('timeline').textContent = 'No events in this run yet. Step or Run to create a fresh continuation.';
    const operations = snapshot.interventions?.operations ?? [];
    el<HTMLSelectElement>('world-operation').replaceChildren(...operations.map(op => new Option(op.id.replace('operator.', ''), op.id)));
    editWorldOperation();
  }
  el('mode').textContent = snapshot.mode === 'live' ? snapshot.automatic ? 'Running' : snapshot.status?.stopped ? 'Stopped' : 'Live run' : snapshot.mode === 'playback' ? 'Saved run' : 'Setup';
  const status = snapshot.status;
  el('status').textContent = snapshot.failure ?? (status ? `${status.steps} steps · ${status.pendingRequests} pending decisions · ${status.activeProviders} provider calls · ${status.unresolvedActions} unresolved actions${status.paused ? ' · Dispatch paused' : ''}`
    : snapshot.mode === 'playback' ? 'Recorded playback · no providers or host tools execute.' : 'Review your sources and connection slots, then start a run.');
  const metrics = el('metrics'); metrics.replaceChildren();
  const events = snapshot.events ?? [];
  frames = snapshot.manifest?.host.contractId === 'example.fabrication' ? shopFrames(events, snapshot.mode === 'live' ? snapshot.shop : undefined) : economyFrames(events, snapshot.mode === 'live' ? snapshot.economy : undefined);
  const frameIndex = cursor.index(frames);
  const frame = frames[frameIndex];
  shownShop = isShop(frame?.report) ? frame.report : undefined;
  shownMarket = frame && !isShop(frame.report) ? frame.report : undefined;
  const shownReport = shownShop ?? shownMarket;
  shownBoundary = frame?.sequence ?? events.at(-1)?.sequence ?? Infinity;
  const usage = events.reduce((sum, event) => { const values = (event.data as JsonObject).usage as JsonObject | undefined; return sum + Number(values?.inputTokens ?? 0) + Number(values?.outputTokens ?? 0); }, 0);
  for (const [value, name] of [[status?.requests ?? events.filter(e => e.type === 'request').length, 'decisions requested'], [events.filter(e => e.type === 'proposal').length, 'proposals'], [usage, 'reported tokens'], [snapshot.canCheckpoint ? 'Ready' : snapshot.mode === 'playback' ? 'Playback' : '—', 'checkpoint']] as const) {
    const metric = document.createElement('div'); metric.className = 'metric'; const strong = document.createElement('b'); strong.textContent = String(value); metric.append(strong, name); metrics.append(metric);
  }
  const perspective = el<HTMLSelectElement>('perspective'); const chosen = perspective.value;
  const actors = Object.keys(snapshot.launch?.states ?? snapshot.manifest?.effectiveConfig ?? {});
  perspective.replaceChildren(new Option('Operator · all records', 'operator'), ...actors.map(actor => new Option(snapshot.launch?.characters[actor]?.name ?? actor, actor)));
  if (actors.includes(chosen)) perspective.value = chosen;
  if (inspectingState && snapshot.launch?.states[perspective.value]) el('detail').textContent = json(snapshot.launch.states[perspective.value]);
  const filter = el<HTMLSelectElement>('filter').value;
  const shown = events.filter(e => e.sequence <= shownBoundary && (filter === 'all' || e.type === filter) && (perspective.value === 'operator' || actorOf(e) === perspective.value));
  if (events.length) {
    const timeline = el('timeline'); const atBottom = timeline.scrollTop + timeline.clientHeight >= timeline.scrollHeight - 40; timeline.replaceChildren();
    for (const event of shown.slice(-300)) {
      const button = document.createElement('button'); button.className = `event${selectedEvent === event.sequence ? ' selected' : ''}`;
      const index = document.createElement('small'); index.textContent = String(event.sequence).padStart(3, '0');
      const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = event.type;
      const summary = document.createElement('span'); summary.className = 'summary'; const data = event.data as JsonObject;
      summary.textContent = `${actorOf(event)?.replace('simkin:', '') ?? 'run'} · ${data.status ?? data.toolId ?? (data.output as JsonObject | undefined)?.toolId ?? data.code ?? `time ${event.time.value}`}`;
      button.append(index, tag, summary); button.onclick = () => { showEvent(event); render(); }; timeline.append(button);
    }
    if (!shown.length) timeline.textContent = 'No records match this perspective and filter.';
    if (atBottom) timeline.scrollTop = timeline.scrollHeight;
  }
  for (const id of ['run', 'pause', 'step', 'advance', 'stop', 'save', 'intervene']) el<HTMLButtonElement>(id).disabled = snapshot.mode !== 'live' || (snapshot.busy && !['pause', 'stop'].includes(id));
  el<HTMLButtonElement>('intervene').disabled ||= perspective.value === 'operator';
  el<HTMLButtonElement>('start').disabled = snapshot.busy;
  el<HTMLButtonElement>('branch').disabled = snapshot.mode === 'authoring' || snapshot.busy || snapshot.mode === 'live' && !snapshot.canCheckpoint;
  const canIntervene = snapshot.mode === 'live' && snapshot.canCheckpoint && !snapshot.automatic && !!snapshot.interventions?.operations.length;
  el('world-note').textContent = snapshot.interventions?.operations.length ? `Current host revision: ${snapshot.interventions.revision}. Pause at a settled boundary. Characters learn changes through their usual observations.` : 'This host version has no world operations. New conversation and settlement runs support them; old recordings keep their original host version.';
  el<HTMLButtonElement>('world-preview').disabled = !canIntervene;
  el<HTMLButtonElement>('world-apply').disabled = !canIntervene || !previewedWorld || previewedWorld.expectedRevision !== snapshot.interventions?.revision;
  const slider = el<HTMLInputElement>('economy-snapshot'); slider.max = String(Math.max(0, frames.length - 1)); slider.value = String(frameIndex);
  const recapContainer = el('economy-recap'); recapContainer.hidden = !shownReport;
  el('turn-transport').hidden = !shownReport;
  el('market-details').hidden = !shownReport;
  el('watch-empty').hidden = !!shownReport;
  el('shop-orders-panel').hidden = !shownShop;
  el('economy-csv').hidden = !!shownShop;
  el('add-order').hidden = snapshot.mode !== 'live';
  el<HTMLButtonElement>('add-order').disabled = !canIntervene || !cursor.following || !!shownShop?.completed || (shownShop?.tick ?? 0) >= (shownShop?.turns ?? Infinity);
  el('shop-finish-work').hidden = !shownShop || snapshot.mode !== 'live' || !cursor.following || !(status?.unresolvedActions) || !!snapshot.busy || !!snapshot.automatic;
  el<HTMLButtonElement>('shop-finish-work').disabled = !!status?.pendingRequests || !!status?.activeProviders;
  el('shop-order-note').textContent = snapshot.mode === 'playback' ? 'Orders at the selected recorded turn.' : !cursor.following ? 'Return to live to add an order.' : !canIntervene ? 'Pause, then finish current work to add an order.' : 'Add an order, then advance a turn for the characters to react.';
  el('watch-empty').textContent = snapshot.mode === 'authoring' ? 'Choose a scenario in Setup to begin.' : 'This host’s controls and recorded events are available in Diagnostics.';
  el('economy-controls').hidden = !shownReport;
  if (shownReport) {
    el('scenario-title').textContent = shownShop ? 'Fabrication shop' : 'Small economy';
    const report = shownReport;
    slider.setAttribute('aria-valuetext', `Turn ${report.tick}`);
    const isLive = cursor.following && snapshot.mode === 'live' && !ended();
    el('turn-position').textContent = `Turn ${report.tick} · ${isShop(report) ? `Week ${Math.min(Math.ceil(report.turns / report.rentEvery), Math.max(1, Math.ceil(report.tick / report.rentEvery)))}` : `Day ${Math.min(report.day, report.days)}`} · ${isLive ? 'Live' : 'Replay'}`;
    el('turn-status').textContent = snapshot.failure ?? (isLive && snapshot.busy ? `Resolving turn · ${status?.pendingRequests ?? 0} decisions pending` : snapshot.automatic ? 'Running live · Pause to read or browse earlier turns.' : !isLive ? 'Recorded turns · no model calls.' : 'Next turn asks the characters to act.');
    el<HTMLButtonElement>('turn-prev').disabled = frameIndex === 0;
    const next = cursor.next(frames, snapshot.mode === 'live' && !ended());
    el<HTMLButtonElement>('turn-next').disabled = navigationBusy || (next === 'generate' && (!!snapshot.busy || !!snapshot.automatic)) || next === 'end';
    el('turn-next').textContent = next === 'generate' ? 'Next turn' : 'Next';
    el('turn-play').textContent = snapshot.automatic || replayTimer ? 'Pause' : isLive ? 'Play live' : 'Play replay';
    el<HTMLButtonElement>('turn-play').disabled = navigationBusy || (!snapshot.automatic && !!snapshot.busy && isLive) || (!isLive && frames.length < 2);
    el('economy-latest').hidden = cursor.following || snapshot.mode !== 'live' || ended();
    const key = `${snapshot.manifest?.runId}:${frame?.sequence}:${report.tick}:${report.revision}:${isLive}:${status?.stopped}`;
    if (key !== renderedReport) {
      renderedReport = key;
      const inspect = (sequence: number) => { const event = events.find(e => e.sequence === sequence); if (event) showEvent(event); };
      const previous = frames[frameIndex - 1]?.report;
      if (isShop(report)) {
        renderShopRecap(recapContainer, report, shopRecap(events, report, shownBoundary, isLive), isShop(previous) ? previous : undefined, inspect);
        renderShopOrders(el('shop-orders'), report);
        renderShopWorld(el('economy-view'), report);
      } else {
        const recap = economyRecap(events, report, { previous: previous && !isShop(previous) ? previous : undefined, throughSequence: shownBoundary, live: isLive });
        renderEconomyRecap(recapContainer, recap, report, inspect);
        renderEconomy(el('economy-view'), report);
      }
    }
  }
  const models = Object.values(snapshot.manifest?.effectiveConfig ?? {}).map(c => `${c.model.provider}/${c.model.model}`);
  const fixtureMarket = Object.values(snapshot.manifest?.effectiveConfig ?? {}).some(c => c.model.provider === 'fixture');
  el('run-label').hidden = !fixtureMarket;
  el('run-label').textContent = 'Scripted developer sample';
  el('economy-run-kind').textContent = `${fixtureMarket ? 'Scripted developer fixture · no live-model behavior' : snapshot.mode === 'playback' ? 'Recorded model run' : 'Live model run'} · ${[...new Set(models)].join(', ')}`;
  const failures = events.filter(e => e.type === 'model-error' || e.type === 'model-timeout' || e.type === 'memory-retrieval' && ['failed', 'timeout'].includes(String((e.data as JsonObject).phase))).length;
  if (shownReport) el('economy-run-kind').textContent += ` · ${events.filter(e => e.type === 'request').length} requests · ${failures} provider/output failures or timeouts`;
  el('economy-save-status').textContent = snapshot.savedRecording ? `Saved: ${snapshot.savedRecording}. ${snapshot.saveNote ?? 'Recording is ready to open.'}` : snapshot.mode === 'playback' ? 'Verified recorded evidence. Scrub snapshots; no model calls.' : 'Run saves automatically at its configured limit. Save manually before closing the server.';
  el<HTMLButtonElement>('economy-open-saved').disabled = !snapshot.savedRecording || snapshot.busy || !!snapshot.automatic;
  const canvas = el<HTMLCanvasElement>('spatial');
  const spatial = snapshot.host as SpatialView | undefined;
  canvas.hidden = !spatial?.world?.positions || !Array.isArray(spatial.world.obstacles);
  if (!canvas.hidden && spatial) {
    const scene = projectScene(spatial); const ctx = canvas.getContext('2d')!; ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#2a4352';
    for (let i = -12; i <= 12; i += 2) { ctx.beginPath(); ctx.moveTo(440 + i * 21, 30); ctx.lineTo(440 + i * 21, 300); ctx.stroke(); }
    for (const obstacle of scene.obstacles) { ctx.fillStyle = '#344b59'; ctx.beginPath(); ctx.arc(440 + obstacle.x * 24, 170 + obstacle.y * 24, obstacle.radius * 24, 0, 2 * Math.PI); ctx.fill(); }
    for (const [index, body] of scene.bodies.entries()) { ctx.fillStyle = ['#c3f078', '#78dce8', '#edbc7c'][index % 3]; ctx.beginPath(); ctx.arc(440 + body.x * 24, 170 + body.y * 24, 8, 0, 2 * Math.PI); ctx.fill(); ctx.font = '14px system-ui'; ctx.fillText(body.id.replace('simkin:', ''), 454 + body.x * 24, 175 + body.y * 24); }
    ctx.fillStyle = '#9ab1c0'; ctx.font = '12px system-ui'; ctx.fillText('3D world · orthographic view · metres · Y up', 18, 25);
  }
}
let refreshSequence = 0;
async function refresh() {
  const sequence = ++refreshSequence;
  const previous = snapshot;
  const next = await api<Snapshot>(`state?runId=${encodeURIComponent(previous.manifest?.runId ?? '')}&after=${previous.events?.length ?? 0}&view=summary`);
  if (sequence !== refreshSequence) return;
  const more = next.memoryEnabled && next.events?.length === 256;
  if (next.manifest?.runId === previous.manifest?.runId && next.eventsOffset === previous.events?.length) next.events = [...(previous.events ?? []), ...(next.events ?? [])];
  snapshot = next; render();
  if (more) setTimeout(() => { void refresh().catch(error => notify(error.message)); }, 20);
}
function bind(id: string, action: () => Promise<unknown> | void) { el(id).addEventListener('click', () => { void Promise.resolve().then(action).then(refresh).catch(error => notify(error.message)); }); }
el<HTMLSelectElement>('document').onchange = () => { if (!draft) return; draft.sources[currentPath] = el<HTMLTextAreaElement>('source').value; currentPath = el<HTMLSelectElement>('document').value; el<HTMLTextAreaElement>('source').value = draft.sources[currentPath]; };
for (const id of ['provider', 'model', 'endpoint']) el(id).addEventListener('change', () => { try { syncSlot(); } catch { notify('Correct the connection slot JSON first.'); } });
el<HTMLSelectElement>('perspective').onchange = () => {
  const actor = el<HTMLSelectElement>('perspective').value; const state = snapshot.launch?.states[actor];
  inspectingState = !!state;
  if (state) { el('detail').textContent = json(state); el<HTMLTextAreaElement>('edit').value = json({ expectedRevision: state.revision, intentions: state.context.intentions ?? [] }); }
  render();
};
el<HTMLSelectElement>('filter').onchange = render;
el<HTMLSelectElement>('world-operation').onchange = editWorldOperation;
el('world-revision').addEventListener('input', invalidateWorldPreview);
bind('world-preview', async () => {
  const edit = worldEdit(); const identity = snapshot.manifest?.runId;
  const result = await api<InterventionPreview>('world-preview', edit);
  if (identity !== snapshot.manifest?.runId || json(edit) !== json(worldEdit())) return;
  previewedWorld = result.valid ? edit : undefined;
  el('world-preview-result').textContent = json(result);
});
bind('world-apply', async () => {
  if (!previewedWorld || json(previewedWorld) !== json(worldEdit())) throw new Error('Preview the current change first.');
  const edit = previewedWorld; invalidateWorldPreview();
  try { await api('world-intervene', edit); notify('World change recorded. Advance or step to deliver observations.'); }
  finally { await refresh(); }
});
el<HTMLInputElement>('economy-snapshot').oninput = () => { void seekTurn(Number(el<HTMLInputElement>('economy-snapshot').value)).catch(error => notify(error.message)); };
bind('economy-latest', () => { stopReplay(); cursor.follow(); });
bind('turn-prev', () => seekTurn(cursor.index(frames) - 1));
bind('turn-next', async () => {
  const next = cursor.next(frames, snapshot.mode === 'live' && !ended());
  if (next === 'recorded') { await seekTurn(cursor.index(frames) + 1); return; }
  if (next !== 'generate' || navigationBusy || snapshot.busy || snapshot.automatic) return;
  navigationBusy = true; render();
  try { await api('step', {}); if (!snapshot.memoryEnabled) { const saved = await api<{name: string}>('save', {}); await catalog(); el<HTMLSelectElement>('recordings').value = saved.name; } }
  finally { navigationBusy = false; }
});
bind('turn-play', async () => {
  if (snapshot.automatic) { await api('pause', {}); return; }
  if (replayTimer) { stopReplay(); return; }
  if (cursor.following && snapshot.mode === 'live' && !ended()) {
    if (navigationBusy || snapshot.busy) return;
    navigationBusy = true; render(); try { await api('run', {}); } finally { navigationBusy = false; } return;
  }
  // Replay has no path to dispatch. Reaching its final frame always stops.
  if (cursor.index(frames) === frames.length - 1) cursor.seek(frames, 0);
  replayTimer = setInterval(() => {
    const index = cursor.index(frames);
    if (index >= frames.length - 1) { stopReplay(); render(); return; }
    cursor.seek(frames, index + 1);
    if (index + 1 === frames.length - 1) stopReplay();
    render();
  }, 1500);
  render();
});
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-page]')) button.onclick = () => showPage(button.dataset.page!);
el('response-mode').onchange = syncSlot;
el('close-evidence').onclick = () => el<HTMLDialogElement>('evidence-dialog').close();
bind('shop-finish-work', async () => { await api('advance', {}); notify('Advanced the workshop one turn without asking for new decisions.'); });
bind('add-order', () => {
  if (!snapshot.shop || !snapshot.interventions || !snapshot.canCheckpoint || snapshot.automatic || !cursor.following) throw new Error('Pause at a settled live turn first.');
  orderEdit = undefined;
  const schema = structuredClone(orderSchema);
  (schema.properties as JsonObject).recipient = { type: ['string', 'null'], enum: [null, ...Object.keys(snapshot.shop.people)], title: 'Who receives the order?' };
  readOrderFields = schemaForm(el('order-fields'), schema, {
    id: `order:new-${snapshot.shop.orders.length + 1}`, customer: 'New customer', quantity: 4, quality: 'standard', payment: 30,
    deadline: Math.min(snapshot.shop.turns, snapshot.shop.tick + 16), recipient: null, brief: 'A new production request.',
  }, () => { orderEdit = undefined; el<HTMLButtonElement>('order-send').disabled = true; el('order-preview-result').textContent = 'Preview your edited order.'; });
  for (const option of el('order-fields').querySelectorAll<HTMLOptionElement>('select[aria-label="Who receives the order?"] option')) {
    const recipient = JSON.parse(option.value); option.textContent = recipient === null ? 'Everyone (public)' : `${String(recipient).replace('simkin:', '').replace(/^./, c => c.toUpperCase())} only (private)`;
  }
  el<HTMLButtonElement>('order-send').disabled = true;
  el('order-preview-result').textContent = 'Preview the order before sending it into the simulation.';
  el<HTMLDialogElement>('order-dialog').showModal();
});
bind('order-preview', async () => {
  if (!snapshot.interventions) return;
  orderEdit = undefined; el<HTMLButtonElement>('order-send').disabled = true;
  const edit = { operationId: 'operator.add_order', operationVersion: '1.0.0', expectedRevision: snapshot.interventions.revision, arguments: readOrderFields() };
  const result = await api<InterventionPreview>('world-preview', edit);
  el('order-preview-result').textContent = result.valid ? `Ready: ${edit.arguments.quantity} ${edit.arguments.quality} units for $${edit.arguments.payment}, due turn ${edit.arguments.deadline}. ${edit.arguments.recipient ? `Private lead for ${edit.arguments.recipient}.` : 'Visible to everyone.'}` : result.reason ?? 'Order is invalid.';
  if (result.valid) { orderEdit = edit; el<HTMLButtonElement>('order-send').disabled = false; }
});
bind('order-send', async () => {
  if (!orderEdit) throw new Error('Preview the order first.');
  const edit = orderEdit; orderEdit = undefined; el<HTMLButtonElement>('order-send').disabled = true;
  await api('world-intervene', edit); await api('save', {});
  el<HTMLDialogElement>('order-dialog').close(); notify('Customer order added and saved. Advance a turn for the characters to react.');
});
el('order-close').onclick = () => el<HTMLDialogElement>('order-dialog').close();
bind('economy-csv', async () => { if (shownMarket) downloadEconomy(snapshot.memoryEnabled ? await api<EconomyReport>('economy-report', { tick: shownMarket.tick }) : shownMarket); });
bind('economy-open-saved', async () => { if (snapshot.savedRecording) { await api('open', { name: snapshot.savedRecording }); await catalog(); showPage('watch'); } });
bind('load-template', async () => setDraft(await api<Draft>('template', { name: el<HTMLSelectElement>('template').value })));
bind('load-fields', async () => {
  const source = el<HTMLTextAreaElement>('source').value; const path = currentPath;
  const result = await api<{ document: PortableDocument; schema: JsonObject }>('document-fields', { source, representation: path.endsWith('.md') ? 'markdown' : 'json' });
  if (path !== currentPath || source !== el<HTMLTextAreaElement>('source').value) throw new Error('Source changed while loading fields. Load again.');
  sourceForm = { path, source, read: schemaForm(el('document-fields'), result.schema, result.document as unknown as JsonObject) };
  el<HTMLButtonElement>('apply-fields').disabled = false;
});
bind('apply-fields', async () => {
  const form = sourceForm;
  if (!form || form.path !== currentPath || form.source !== el<HTMLTextAreaElement>('source').value) throw new Error('Source changed. Reload fields to keep your edits.');
  const result = await api<{ source: string }>('document-save', { document: form.read(), representation: form.path.endsWith('.md') ? 'markdown' : 'json' });
  if (form.path !== currentPath || form.source !== el<HTMLTextAreaElement>('source').value) throw new Error('Source changed while validating. Reload fields.');
  el<HTMLTextAreaElement>('source').value = result.source; draft!.sources[currentPath] = result.source; form.source = result.source;
  notify('Fields validated and applied to the authoritative source. Validate the full scenario before starting.');
});
bind('validate', async () => { const launch = await api<PreparedLaunch>('validate', captureDraft()); el('detail').textContent = json({ effectiveConfig: launch.effectiveConfig, configurationSources: launch.configurationSources, states: launch.states }); el('inspector-note').textContent = 'Validated configuration and starting character states.'; el<HTMLDialogElement>('evidence-dialog').showModal(); });
bind('start', async () => { await api('start', captureDraft()); selectedEvent = -1; showPage('watch'); notify('Run created. Next turn asks your characters to act.'); });
for (const command of ['run', 'pause', 'step', 'advance', 'stop', 'branch']) bind(command, async () => {
  if (command === 'advance') await api('pause', {});
  await api(command, {}); if (command === 'branch') notify('Fresh continuation created. Parent checkpoint remains unchanged.');
});
bind('save', async () => { const result = await api<{ name: string }>('save', {}); notify(`Saved ${result.name}`); await catalog(); el<HTMLSelectElement>('recordings').value = result.name; });
bind('open', async () => { await api('open', { name: el<HTMLSelectElement>('recordings').value }); showPage('watch'); });
bind('intervene', () => api('intervene', { actor: el<HTMLSelectElement>('perspective').value, edit: JSON.parse(el<HTMLTextAreaElement>('edit').value) }));
bind('compare', async () => {
  const runId = snapshot.manifest?.runId;
  const result = await api<ReturnType<typeof compareBranches> | { left: unknown; right: unknown }>('compare', { name: el<HTMLSelectElement>('comparison-recording').value });
  if (snapshot.manifest?.runId !== runId) return;
  const traces = el('comparison-traces'); traces.replaceChildren();
  if (!('kind' in result)) { el('comparison').textContent = json({ parentPrefix: result.left, currentContinuation: result.right }); return; }
  el('comparison').textContent = json({ sharedPrefix: result.sharedPrefix, left: { runId: result.left.runId, totals: result.left.totals }, right: { runId: result.right.runId, totals: result.right.totals } });
  for (const [name, branch] of [['Current', result.left], ['Saved', result.right]] as const) {
    const column = document.createElement('section'); const title = document.createElement('h4'); title.textContent = `${name} continuation · ${branch.events.length} events`; column.append(title);
    for (const event of branch.events.slice(-300)) {
      const detail = document.createElement('details'); const label = document.createElement('summary');
      label.textContent = `${event.sequence} · ${event.type} · ${actorOf(event) ?? 'run'} · ${event.time.value}`;
      const content = document.createElement('pre'); content.textContent = json(event); detail.append(label, content); column.append(detail);
    }
    if (branch.events.length > 300) { const note = document.createElement('p'); note.textContent = 'Showing the last 300 events. Open the recording for full playback.'; column.prepend(note); }
    traces.append(column);
  }
});
bind('export', async () => download('simkind-playback.json', await api('export', { redact: false })));
bind('redact', async () => download('simkind-metadata.json', await api('export', { redact: true })));
bind('download-draft', () => { const value = captureDraft(); download('simkind-sources.json', { ...value, slots: Object.fromEntries(Object.entries(value.slots).map(([slot, config]) => [slot, { provider: config.provider, model: config.model }])) }); });
async function init() { await catalog(); await refresh(); if (snapshot.shop) el<HTMLSelectElement>('template').value = 'fabrication-shop.json'; else if (snapshot.economy) el<HTMLSelectElement>('template').value = 'small-economy.json'; setDraft(await api<Draft>('template', { name: el<HTMLSelectElement>('template').value })); showPage(snapshot.mode === 'authoring' ? 'setup' : 'watch'); render(); setInterval(() => void refresh().catch(() => {}), 1000); }
void init().catch(error => notify(error.message));

for (const kind of ['playback', 'draft'] as const) el<HTMLInputElement>(`import-${kind}`).onchange = async event => {
  try {
    const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return;
    if (file.size > 1024 * 1024) throw new Error('Import limit is 1 MiB. Open larger recorded directories through Saved recordings.');
    const value = JSON.parse(await file.text());
    if (kind === 'playback') { await api('import', value); selectedEvent = -1; await refresh(); }
    else { if (!value.sources || !value.scenarioPath || !value.configPath || !value.slots) throw new Error('Invalid source bundle.'); setDraft(value); notify('Sources loaded. Review connection slots and validate before starting.'); }
  } catch (error) { notify((error as Error).message); }
};

bind('inspect-memory', async () => { inspectingState = false; const actor = el<HTMLSelectElement>('perspective').value; const query = el<HTMLInputElement>('memory-query').value.trim(); const value = await api('memory', { actor, query: query ? { query } : {} }); el('detail').textContent = json(value); el('inspector-note').textContent = 'Current memory at this run boundary. Interpretations remain distinct from original evidence.'; el<HTMLDialogElement>('evidence-dialog').showModal(); });
