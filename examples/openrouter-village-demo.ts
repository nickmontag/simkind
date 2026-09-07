import { readOpenRouterApiKey } from './openrouter-env.js';
import {
  createOpenRouterLunaJsonProvider,
  OPENROUTER_MODEL,
} from './openrouter-luna.js';
import { runVillageLiveSoak, type VillageRequest } from './village-soak.js';

const schema = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['Move', 'Gather', 'Give', 'Speak', 'Brew', 'Wait'] },
    to: { type: 'string', enum: ['square', 'grove', 'aya', 'mira', 'none'] },
    item: { type: 'string', enum: ['mint', 'mint-tea', 'none'] },
    topic: { type: 'string', enum: ['mint-location', 'none'] },
    message: { type: 'string' },
  },
  required: ['kind', 'to', 'item', 'topic', 'message'],
  additionalProperties: false,
};

function prompt(request: VillageRequest): string {
  const { snapshot } = request;
  const objective = request.simkinId === 'aya'
    ? [
        'You are Aya. Your measurable promise is to give one mint to Mira.',
        'You also personally want to keep mint, but the promise has higher priority.',
        'If you do not know the mint location, wait for Mira to tell you.',
      ]
    : [
        'You are Mira. Your goal is to brew mint tea in the square.',
        'If Aya does not know where mint grows and is present, tell Aya that mint grows in the grove.',
        'After Aya gives you mint, brew the tea.',
      ];
  return [
    ...objective,
    `Tick: ${request.issuedAtTick}`,
    `Your place: ${snapshot.place}`,
    `Mint carried: ${snapshot.mint}`,
    `Mint remaining in grove: ${snapshot.groveMint}`,
    `Other simkin's place: ${snapshot.otherPlace}`,
    `Aya knows mint location: ${snapshot.ayaKnowsMintLocation}`,
    `Aya promise complete: ${snapshot.ayaPromiseComplete}`,
    `Mira tea goal complete: ${snapshot.miraTeaGoalComplete}`,
    `Recalled memory IDs: ${snapshot.recalledMemoryIds.join(', ') || 'none'}`,
    'Choose exactly one action that is legal now.',
    'Move: to square/grove; other fields none/empty.',
    'Gather: only at grove while mint remains; item mint.',
    'Give: only while carrying mint at recipient location; to mira; item mint.',
    'Speak: only while together; to aya; topic mint-location; message "Mint grows in the grove."',
    'Brew: only Mira at square while carrying mint; item mint-tea.',
    'Wait: use none for to/item/topic and an empty message.',
  ].join('\n');
}

const apiKey = await readOpenRouterApiKey();
const provider = createOpenRouterLunaJsonProvider<VillageRequest, unknown>(apiKey, {
  schemaName: 'simkind_village_intent',
  schema,
  prompt,
  output: (request, intent) => ({ requestId: request.id, simkinId: request.simkinId, intent }),
  system: 'Act as one simkin. Choose one legal engine action from the supplied state. Return only schema-conforming JSON.',
});
const { report, log } = await runVillageLiveSoak(provider.fulfill);
console.log(JSON.stringify({ model: OPENROUTER_MODEL, report, usage: provider.usage, log }, null, 2));
