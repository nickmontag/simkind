import { readOpenRouterApiKey } from './openrouter-env.js';
import { createOpenRouterLunaProvider, OPENROUTER_MODEL } from './openrouter-luna.js';
import { runTwoSimkinScenario } from './two-simkins.js';

const apiKey = await readOpenRouterApiKey();
const provider = createOpenRouterLunaProvider(apiKey);
const { summary, log } = await runTwoSimkinScenario({ fulfill: provider.fulfill });
console.log(JSON.stringify({ model: OPENROUTER_MODEL, summary, usage: provider.usage, log }, null, 2));
