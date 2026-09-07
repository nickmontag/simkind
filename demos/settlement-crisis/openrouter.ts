import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { renderCapabilityPrompt } from 'simkind';
import { settlementCapabilities } from './engine.js';
import type { SettlementProvider, SettlementRequest, SimkinId } from './types.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const objectives: Record<SimkinId, string> = {
  aya: 'You are Aya, the mechanic. Prevent or repair pump failure. You need two parts and begin with one.',
  mira: 'You are Mira, the medic. Treat sick people, prioritizing severe illness and conserving medicine.',
  sol: 'You are Sol, the farmer. Protect the food supply, but honor reasonable requests from trusted or urgent people.',
  ivo: 'You are Ivo, the courier. Spread critical local facts and investigate infrastructure.',
  nia: 'You are Nia, the elder. Reduce shortages and support vulnerable people with what you carry.',
  ren: 'You are Ren, an ill newcomer with little trust. Seek treatment, food, and water without global knowledge.',
};

const schema = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['Move', 'Collect', 'Ask', 'Give', 'Share', 'PostNotice', 'Repair', 'Treat', 'Wait'] },
    to: { type: 'string', enum: ['aya', 'mira', 'sol', 'ivo', 'nia', 'ren', 'square', 'farm', 'clinic', 'reservoir', 'none'] },
    resource: { type: 'string', enum: ['food', 'medicine', 'parts', 'water', 'none'] },
    fact: { type: 'string', enum: ['bridge-unsafe', 'pump-degrading', 'pump-failed', 'ren-sick', 'nia-sick', 'none'] },
    target: { type: 'string', enum: ['aya', 'mira', 'sol', 'ivo', 'nia', 'ren', 'pump', 'none'] },
  },
  required: ['kind', 'to', 'resource', 'fact', 'target'],
  additionalProperties: false,
};

interface OpenRouterResponse {
  choices?: { message?: { content?: string | null } }[];
  usage?: { total_tokens?: number; cost?: number };
  error?: { message?: string };
}

export async function createSettlementOpenRouterProvider(): Promise<SettlementProvider> {
  let fileEnv: ReturnType<typeof parseEnv> = {};
  try {
    fileEnv = parseEnv(await readFile(new URL('../../.env', import.meta.url), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const apiKey = (process.env.OPENROUTER_API_KEY ?? fileEnv.OPENROUTER_API_KEY ?? '').trim();
  const model = (process.env.OPENROUTER_MODEL ?? fileEnv.OPENROUTER_MODEL ?? '').trim();
  if (!apiKey) throw new Error('Set OPENROUTER_API_KEY in .env or your environment. Run npm run setup to create .env.');
  if (!model) throw new Error('Set OPENROUTER_MODEL in .env or your environment to a model ID from https://openrouter.ai/models. No model is selected by default.');
  const usage = { requests: 0, totalTokens: 0, cost: 0 };
  return {
    name: model,
    usage,
    async decide(request: SettlementRequest): Promise<unknown> {
      const response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/nickmibarra/simkind',
          'X-OpenRouter-Title': 'Simkind settlement crisis demo',
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content: [
                objectives[request.simkinId],
                'Act only from the supplied local snapshot. The engine validates legality.',
                'Choose one action. Use "none" for schema fields irrelevant to that action.',
                renderCapabilityPrompt(settlementCapabilities),
              ].join('\n\n'),
            },
            { role: 'user', content: JSON.stringify(request.snapshot) },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'settlement_intent', strict: true, schema },
          },
          provider: { require_parameters: true },
        }),
      });
      const body = await response.json() as OpenRouterResponse;
      if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${body.error?.message ?? 'request failed'}`);
      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new Error('OpenRouter returned no content');
      usage.requests += 1;
      usage.totalTokens += body.usage?.total_tokens ?? 0;
      usage.cost += body.usage?.cost ?? 0;
      return JSON.parse(content) as unknown;
    },
  };
}
