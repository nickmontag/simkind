import { readFile } from 'node:fs/promises';

function envValue(source: string, name: string): string | undefined {
  const prefix = `${name}=`;
  const line = source.split(/\r?\n/).find((candidate) => candidate.startsWith(prefix));
  if (line === undefined) return undefined;
  const raw = line.slice(prefix.length).trim();
  if (
    raw.length >= 2 &&
    ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")))
  ) {
    return raw.slice(1, -1);
  }
  return raw;
}

export async function readOpenRouterApiKey(): Promise<string> {
  const env = await readFile(new URL('../.env', import.meta.url), 'utf8');
  const apiKey = envValue(env, 'OPENROUTER_API_KEY');
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error('Set OPENROUTER_API_KEY in .env before running a live demo');
  }
  return apiKey;
}
