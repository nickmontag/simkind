import { readOpenRouterConfig } from './openrouter-env.js';
import { createOpenRouterProvider } from './openrouter-provider.js';
import { runTwoSimkinScenario } from './two-simkins.js';

const { apiKey, model } = await readOpenRouterConfig();
const provider = createOpenRouterProvider(apiKey, model);
const { summary, log } = await runTwoSimkinScenario({ fulfill: provider.fulfill });
console.log(JSON.stringify({ model, summary, usage: provider.usage, log }, null, 2));
