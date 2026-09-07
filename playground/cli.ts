import { parseArgs } from 'node:util';
import { createPlaygroundServer } from './server.js';
const { values } = parseArgs({ options: { port: { type: 'string' }, fixture: { type: 'boolean', default: false } } });
const { server, origin, session } = await createPlaygroundServer({ port: values.port ? Number(values.port) : undefined, fixture: values.fixture });
console.log(`Simkind playground: ${origin}${values.fixture ? ' (deterministic developer fixture)' : ''}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { session.stop(); server.close(); });
