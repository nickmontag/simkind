import { readFile, writeFile } from 'node:fs/promises';

const template = await readFile(new URL('../.env.example', import.meta.url));
try {
  await writeFile(new URL('../.env', import.meta.url), template, {
    flag: 'wx', mode: 0o600,
  });
  console.log('Created .env.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('Kept your existing .env unchanged.');
}

console.log(`
Next:
1. Create an OpenRouter API key: https://openrouter.ai/settings/keys
2. Select a model supporting structured outputs: https://openrouter.ai/models
3. Open .env and set OPENROUTER_API_KEY and OPENROUTER_MODEL.
   Add OPENROUTER_MODEL if your existing .env does not have it yet.
4. Run: npm run demo:openrouter

Interactive settlement: npm run demo:settlement -- --live
Live runs consume credits from your OpenRouter account.
`);
