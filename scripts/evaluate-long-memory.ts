/** Opt-in live evaluation. Scripted history is explicitly separate from fully live decisions. */
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { parseEnv, parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createCharacterRunner, contextProfile, type ModelConnection, type DecisionContext } from '../src/runner/index.js';
import { loadScenario, resolveSources, SqliteRunnerStorage, saveArchivedRun } from '../src/runner/node.js';
import { openRouterConnection } from '../src/providers/index.js';
import { conversationPerceptionHost } from '../examples/portable/hosts/conversation.js';
import { economyPerceptionHost } from '../examples/economy/host.js';
import { economyReport } from '../examples/economy/report.js';
const { values } = parseArgs({ options: { phase: { type: 'string', default: 'memory' }, model: { type: 'string' }, 'max-calls': { type: 'string' }, 'batch-records': { type: 'string', default: '96' }, 'batch-turns': { type: 'string', default: '80' }, output: { type: 'string', default: '.internal/long-memory/live' } } });
const batchRecords = Number(values['batch-records']), batchTurns = Number(values['batch-turns']);
if (![batchRecords, batchTurns].every(value => Number.isSafeInteger(value) && value >= 1 && value <= 1000)) throw new Error('Batch sizes must be integers from 1 to 1000.');
const limit = Number(values['max-calls']);
if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000) throw new Error('Explicit --max-calls between 1 and 10000 is required. The counter persists across phases in the output directory.');
const root = new URL('../examples/portable/scenarios/', import.meta.url).pathname;
const out = resolve(values.output!) + '/'; mkdirSync(out, { recursive: true, mode: 0o700 });
const env = { ...parseEnv(readFileSync('.env', 'utf8')), ...process.env };
const model = values.model ?? env.OPENROUTER_MODEL;
if (!model) throw new Error('Choose an explicit --model or OPENROUTER_MODEL with structured-output support.');
const provider = openRouterConnection(env.OPENROUTER_API_KEY!, model, {}, { structuredOutputs: true });
const budgetPath = out + 'live-budget.json';
let used = 0;
try {
  const budget = JSON.parse(readFileSync(budgetPath, 'utf8'));
  if (budget.model !== model || !Number.isSafeInteger(budget.used) || budget.used < 0) throw new Error('Budget file does not match this model. Use a different output directory.');
  used = budget.used;
} catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
const phase = values.phase!;
if (!['memory', 'economy'].includes(phase)) throw new Error('Choose --phase memory or economy.');
const responses: unknown[] = []; let lastTurn = 0;
let transportFailure: string | undefined;
let consecutiveTransportFailures = 0;
async function real(context: DecisionContext, signal: AbortSignal) {
  if (transportFailure) throw new Error(transportFailure);
  if (used >= limit) throw new Error('Evaluation reached its configured call ceiling.');
  const call = ++used, started = Date.now();
  writeFileSync(budgetPath, JSON.stringify({ used, limit, model, updated: new Date().toISOString() }));
  appendFileSync(out+'live-calls.jsonl', JSON.stringify({ event:'start',call,phase,turn:lastTurn,actor:context.instanceId,purpose:context.purpose??'decision',characters:JSON.stringify(context).length })+'\n');
  try {
    const result = await provider.fulfill(context,signal);
    consecutiveTransportFailures = 0;
    const record = { event:'end',call,phase,turn:lastTurn,actor:context.instanceId,purpose:context.purpose??'decision',elapsedMs:Date.now()-started,usage:result.usage,output:result.output };
    appendFileSync(out+'live-calls.jsonl',JSON.stringify(record)+'\n');
    responses.push(record);
    process.stdout.write(JSON.stringify({call,turn:lastTurn,actor:context.instanceId,purpose:context.purpose??'decision',ms:record.elapsedMs,usage:result.usage})+'\n');
    return result;
  } catch(error) {
    const status = (error as { diagnostic?: { httpStatus?: number } }).diagnostic?.httpStatus;
    if ([400, 401, 403, 404].includes(status ?? 0) || ++consecutiveTransportFailures >= 3) {
      transportFailure = status ? `Provider HTTP ${status}; stop this evaluation before more paid calls.` : 'Three consecutive transport failures; stop this evaluation.';
    }
    appendFileSync(out+'live-calls.jsonl',JSON.stringify({ event:'error',call,phase,turn:lastTurn,actor:context.instanceId,elapsedMs:Date.now()-started,diagnostic:(error as any).diagnostic,message:(error as Error).message })+'\n');
    throw error;
  }
}
const loaded = await loadScenario(root, phase==='memory'?'shared-decision.json':'small-economy.json',phase==='memory'?'config-continuity.json':'config-economy-memory.json');
if(!loaded.ok) throw new Error(JSON.stringify(loaded.diagnostics));
const sources = { ...loaded.value.sources };
const scenarioPath = phase==='memory'?'shared-decision.json':'small-economy.json';
const configPath = phase==='memory'?'config-continuity.json':'config-economy-memory.json';
const scenario = JSON.parse(sources[scenarioPath]), config = JSON.parse(sources[configPath]);
config.profiles[contextProfile.id] = {version:contextProfile.version,required:true};
config.features[contextProfile.id] = {enabled:true,config:phase==='memory'?{recentTurns:4,batchRecords,batchTurns,maxInternalCalls:4,maintenanceTimeoutMs:300000}:{recentTurns:4,batchRecords:24,batchTurns:8,maxInternalCalls:4}};
const turns = phase==='memory'?1009:25;
config.limits = {maxSteps:turns+1,maxRequests:phase==='memory'?10000:240,maxInFlight:phase==='memory'?2:4,requestTimeoutMs:300000};
if(phase==='memory') {
  scenario.cast = scenario.cast.slice(0,2); delete config.modelAssignments['simkin:sol'];
  scenario.initialConditions.sharedContext = 'You are keepers of an expedition log. Record facts accurately, preserve uncertainty and amendments, and distinguish unaccepted offers from agreements. When asked a CHECKPOINT QUESTION, use say addressed privately to YOURSELF to answer; use recall as needed. If the log does not establish an answer, say you do not know. Do not invent missing details.';
} else { scenario.initialConditions.days=6; }
sources[scenarioPath]=JSON.stringify(scenario); sources[configPath]=JSON.stringify(config);
const resolved=resolveSources(sources,scenarioPath,configPath); if(!resolved.ok) throw new Error(JSON.stringify(resolved.diagnostics));
const original=phase==='memory'?conversationPerceptionHost:economyPerceptionHost;
const host={...original,descriptor:{...original.descriptor,limits:{...original.descriptor.limits,...config.limits}}};
const connection:ModelConnection = {...provider, public:phase==='memory'?{...provider.public,provider:'evaluation-mixed',model:'scripted-idle+'+model}:provider.public,
  fulfill:async(context,signal)=> {
    if(phase==='economy'||context.purpose==='consolidation'||context.observations.some(observation => observation.content.some((part: any) => (part.data?.kind === 'dialogue' && part.data.text?.startsWith('CHECKPOINT QUESTION:')) || part.data?.messages?.some((message: any) => message.text.startsWith('CHECKPOINT QUESTION:'))))) return real(context,signal);
    return {output:{toolId:null,arguments:{}}};
  }};
const id=randomUUID(), storage=new SqliteRunnerStorage(out+phase+'-'+id+'.sqlite');
const created=createCharacterRunner(resolved.value,host,{primary:connection},'run:'+id,{storage, recordTimings:true}); if(!created.ok) throw new Error(JSON.stringify(created.diagnostics));
const runner=created.value;
const questions:Record<number,string>={980:'What is the CURRENT agreed transmitter fee after all amendments?',984:'What is the agreed transmitter delivery deadline?',988:'What was the initial transmitter price offered before acceptance?',992:'What did the visitor claim about the fallback code, and was that claim verified?',996:'What is your OWN private locker code?',1000:'What color was the replacement gasket?',1004:'What is the OTHER keeper\'s private locker code?',1008:'What exact calendar date was the final planning meeting?'};
const notices:Record<number,string>={7:'An initial, unaccepted offer: the transmitter supplier asks SEVEN brass tokens. Nobody has agreed yet.',37:'Accepted agreement: the transmitter costs NINE brass tokens and delivery is due at turn 1200. This replaces the unaccepted initial offer.',52:'Maintenance note: the replacement gasket is SAFFRON colored.',125:'An unidentified visitor CLAIMS the fallback code is COBALT-53. Nobody has checked or verified this claim.',660:'Accepted amendment to the transmitter agreement: its fee is now ELEVEN brass tokens. The delivery deadline remains unchanged.'};
const message=(text:string,to:string|null=null)=>runner.interveneHost({operator:'operator:log',operationId:'operator.message',operationVersion:'1.0.0',expectedRevision:runner.hostInterventions().revision,arguments:{text,to}});
let failure: unknown;
const start=Date.now(), errors:unknown[]=[]; let eventCursor=0,maxContext=0;
try {
  for(let turn=1;turn<=turns;turn++) {
    if(used>=limit-5) break;
    lastTurn=turn;
    if(phase==='memory') {
      if (!await runner.drainProviders()) throw new Error('Provider cleanup is still pending; preserve the trace before another intervention.');
      if(turn===430) {message('Your private locker code is PINE-482. This message is private to Aya.','simkin:aya');message('Your private locker code is ASH-761. This message is private to Mira.','simkin:mira');}
      else message(questions[turn]?'CHECKPOINT QUESTION: '+questions[turn]+' Answer privately to yourself, with your evidence or uncertainty.':notices[turn]??`Log turn ${turn}: routine field survey ${turn%17}. The ${['east','south','west','north'][turn%4]} path is ${['dry','muddy','clear'][turn%3]}; survey markers ${turn*13} through ${turn*13+4} were counted. No contract was changed, no code was assigned and no meeting date was set.`);
    }
    runner.step(); await runner.settleDecisions();
    for(;;) { const page=runner.events(eventCursor,128); if(!page.length)break; for(const event of page){eventCursor=event.sequence+1;if(event.type==='model-error'||event.type==='model-timeout')errors.push(event);if(event.type==='request')maxContext=Math.max(maxContext,JSON.stringify((event.data as any).context).length);} }
    if (transportFailure) throw new Error(transportFailure);
    if(Object.keys(runner.status().contextFailures??{}).length) {writeFileSync(out+phase+'-failure.json',JSON.stringify(runner.status(),null,2));throw new Error('Context operation failed; inspect status.');}
    if(turn%100===0||phase==='economy') {if (!runner.status().unresolvedActions && !runner.status().pendingRequests && !runner.status().activeProviders) runner.checkpoint();process.stdout.write(JSON.stringify({phase,turn,used,status:runner.status()})+'\n');}
  }
 } catch (error) { failure = error; }
try {
  runner.pauseDispatch(true);
  const recording='recording-'+id;
  if (!failure && runner.status().unresolvedActions) { runner.step(); await runner.settleDecisions(); }
  await runner.drainProviders();
  const report = {phase,model,structuredOutputs:true,outputCap:null,turns:lastTurn,targetTurns:turns,completedHistory:lastTurn===turns,stopReason:failure?'failure':lastTurn<turns?'call-budget':'history-finished',globalCallsUsed:used,elapsedMs:Date.now()-start,maxContextCharacters:maxContext,errors,recording,status:runner.status(),
    ...(failure ? { failure: (failure as Error).message } : {}), responses:phase==='memory'?responses.filter((r:any)=>r.purpose!=='consolidation'):undefined,economy:phase==='economy'?economyReport(runner.inspect().host):undefined};
  // Analysis survives an export failure; the active database is retained as well.
  writeFileSync(out+phase+'-report.json',JSON.stringify(report,null,2));
  const saved = await saveArchivedRun(out+recording,runner,resolved.value,storage);
  writeFileSync(out+phase+'-report.json',JSON.stringify({...report,resumable:saved.resumable},null,2));
  process.stdout.write(JSON.stringify({done:true,phase,turns:lastTurn,used,recording,errors:errors.length,resumable:saved.resumable})+'\n');
  if (failure) process.exitCode = 1;
} finally {runner.stop();storage.close();}
