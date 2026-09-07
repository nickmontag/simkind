import { runTwoSimkinScenario } from './two-simkins.js';

const { summary, log } = await runTwoSimkinScenario();
console.log(JSON.stringify({ summary, log }, null, 2));
