import { runVillageSoak } from './village-soak.js';

const { report, log } = await runVillageSoak();
console.log(JSON.stringify({ report, log }, null, 2));
