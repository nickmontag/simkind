import { createSituationalMemoryPolicy, type MemoryPolicy, type MemoryPolicyIdentity } from 'simkind/runner';
import { compatibleMemoryEmbeddings } from 'simkind/providers';

/** Local connection configuration, kept outside portable scenario and character documents. */
export function memoryPolicyFromEnvironment(env: Record<string, string | undefined>, expected?: MemoryPolicyIdentity): MemoryPolicy | undefined {
  if (expected?.id === 'simkind.situational' && expected.settings.embeddings === null) return createSituationalMemoryPolicy();
  const model = env.SIMKIND_EMBEDDING_MODEL;
  if (!model) return undefined;
  const endpoint = env.SIMKIND_EMBEDDING_ENDPOINT ?? 'https://openrouter.ai/api/v1/embeddings';
  const dimensions = env.SIMKIND_EMBEDDING_DIMENSIONS ? Number(env.SIMKIND_EMBEDDING_DIMENSIONS) : undefined;
  const apiKey = env.SIMKIND_EMBEDDING_API_KEY ?? (new URL(endpoint).origin === 'https://openrouter.ai' ? env.OPENROUTER_API_KEY : undefined);
  if (new URL(endpoint).origin === 'https://openrouter.ai' && !apiKey) throw new Error('Configure an embedding API key.');
  return createSituationalMemoryPolicy({ embeddings: compatibleMemoryEmbeddings({
    id: env.SIMKIND_EMBEDDING_ID ?? `${model}:dimensions:${dimensions ?? 'default'}`, model, endpoint, apiKey, dimensions,
  }) });
}
