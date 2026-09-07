import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

export async function readOpenRouterConfig(): Promise<{ apiKey: string; model: string }> {
  let fileEnv: ReturnType<typeof parseEnv> = {};
  try {
    fileEnv = parseEnv(await readFile(new URL('../.env', import.meta.url), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const apiKey = (process.env.OPENROUTER_API_KEY ?? fileEnv.OPENROUTER_API_KEY ?? '').trim();
  const model = (process.env.OPENROUTER_MODEL ?? fileEnv.OPENROUTER_MODEL ?? '').trim();
  if (!apiKey) throw new Error('Set OPENROUTER_API_KEY in .env or your environment. Run npm run setup to create .env.');
  if (!model) throw new Error('Set OPENROUTER_MODEL in .env or your environment to a model ID from https://openrouter.ai/models. No model is selected by default.');
  return { apiKey, model };
}
