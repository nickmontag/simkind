import type { ScenarioInput, ScenarioRequest } from './two-simkins.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

interface OpenRouterResponse {
  choices?: { message?: { content?: string | null } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
  };
}

export interface OpenRouterUsage {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
}

export interface OpenRouterJsonProviderOptions<Request, Output> {
  schemaName: string;
  schema: object;
  prompt(request: Request): string;
  output(request: Request, json: unknown): Output;
  system?: string;
  maxTokens?: number;
}

function promptFor(request: ScenarioRequest): string {
  const { snapshot } = request;
  const role = request.simkinId === 'aya'
    ? 'You are Aya. You promised to bring Mira one mint. Complete that promise efficiently.'
    : 'You are Mira. Remain in the square and wait for Aya to bring mint.';
  return [
    role,
    `Current tick: ${request.issuedAtTick}`,
    `Your place: ${snapshot.place}`,
    `Mint you carry: ${snapshot.mint}`,
    `Mint remaining in grove: ${snapshot.groveMint}`,
    `Mira's place: ${snapshot.miraPlace}`,
    `Promise complete: ${snapshot.commitmentComplete}`,
    `Recalled memory evidence: ${JSON.stringify(snapshot.recalledMemories ?? [])}`,
    'Choose exactly one legal intent.',
    'Move: to must be square or grove; item must be none.',
    'Gather: only useful at the grove when mint remains; to must be none; item must be mint.',
    'Give: only useful while carrying mint at Mira’s place; to must be mira; item must be mint.',
    'Wait: to and item must both be none.',
  ].join('\n');
}

function responseSchema() {
  return {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['Move', 'Gather', 'Give', 'Wait'] },
      to: { type: 'string', enum: ['square', 'grove', 'aya', 'mira', 'none'] },
      item: { type: 'string', enum: ['mint', 'none'] },
    },
    required: ['kind', 'to', 'item'],
    additionalProperties: false,
  };
}

function scenarioInput(request: ScenarioRequest, intent: unknown): ScenarioInput {
  return {
    requestId: request.id,
    simkinId: request.simkinId,
    intent: intent as ScenarioInput['intent'],
  };
}

export function createOpenRouterJsonProvider<Request, Output>(
  apiKey: string,
  model: string,
  options: OpenRouterJsonProviderOptions<Request, Output>,
) {
  if (!apiKey.trim()) throw new Error('OPENROUTER_API_KEY is empty');
  if (!model.trim()) throw new Error('OPENROUTER_MODEL is empty');
  const usage: OpenRouterUsage = {
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cost: 0,
  };

  return {
    usage,
    async fulfill(request: Request): Promise<Output> {
      const response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/nickmibarra/simkind',
          'X-OpenRouter-Title': 'Simkind live scenario',
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content: options.system ?? 'Return JSON that follows the supplied schema.',
            },
            { role: 'user', content: options.prompt(request) },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: options.schemaName,
              strict: true,
              schema: options.schema,
            },
          },
          provider: { require_parameters: true },
          max_tokens: options.maxTokens,
        }),
      });
      const payload = await response.json() as OpenRouterResponse & {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(`OpenRouter ${response.status}: ${payload.error?.message ?? 'request failed'}`);
      }
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new Error('OpenRouter returned no message content');
      usage.requests += 1;
      usage.promptTokens += payload.usage?.prompt_tokens ?? 0;
      usage.completionTokens += payload.usage?.completion_tokens ?? 0;
      usage.totalTokens += payload.usage?.total_tokens ?? 0;
      usage.cost += payload.usage?.cost ?? 0;
      return options.output(request, JSON.parse(content) as unknown);
    },
  };
}

export function createOpenRouterProvider(apiKey: string, model: string) {
  return createOpenRouterJsonProvider<ScenarioRequest, ScenarioInput>(apiKey, model, {
    schemaName: 'simkind_intent',
    schema: responseSchema(),
    prompt: promptFor,
    output: scenarioInput,
    system: 'Choose one engine intent from current world state. Never invent facts or claim an action already happened.',
  });
}
