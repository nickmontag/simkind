import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { build } from 'esbuild';
import { readJson } from 'simkind/format';
import { PlaygroundSession, type Draft } from './session.js';
import type { HostIntervention, StateEdit } from 'simkind/runner';
import { documentFields, saveDocumentFields } from './authoring.js';
import type { PortableDocument } from 'simkind/format';

/** Local operator interface. Its session token is never part of a portable artifact. */
export async function createPlaygroundServer(options: { port?: number; fixture?: boolean; runRoot?: string } = {}) {
  const appRoot = new URL('.', import.meta.url).pathname;
  const token = randomBytes(32).toString('hex');
  let fileEnv: ReturnType<typeof parseEnv> = {};
  try { fileEnv = parseEnv(await readFile('.env', 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const env = { ...fileEnv, ...process.env };
  const session = new PlaygroundSession(resolve(appRoot, '../examples/portable/scenarios'), options.runRoot ?? resolve('.internal/playground-runs'), env,
    options.fixture ? { public: { provider: 'fixture', model: 'no-action-v1', settings: {} }, capabilities: { text: true, json: true }, fulfill: async () => ({ output: { toolId: null, arguments: {} } }) } : undefined);
  const compiled = await build({ entryPoints: [resolve(appRoot, 'client.ts')], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', minify: false });
  const script = compiled.outputFiles[0].text;
  let origin = '';
  function send(response: ServerResponse, code: number, value: unknown) { response.writeHead(code, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); }
  async function body(request: IncomingMessage) {
    if (request.headers['content-type'] !== 'application/json') throw new Error('Use application/json.');
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of request) { size += chunk.length; if (size > 1024 * 1024) throw new Error('Request exceeds 1 MiB.'); chunks.push(chunk); }
    const parsed = readJson(Buffer.concat(chunks).toString('utf8'));
    if (!parsed.ok) throw new Error('Invalid request JSON.');
    return parsed.value as Record<string, unknown>;
  }
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    if (request.headers.host !== new URL(origin).host || request.headers.origin && request.headers.origin !== origin
      || request.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(String(request.headers['sec-fetch-site']))) { send(response, 403, { error: 'Local same-origin access required.' }); return; }
    try {
      const path = new URL(request.url!, origin).pathname;
      if (request.method === 'GET' && ['/', '/client.js', '/style.css'].includes(path)) {
        const type = path === '/' ? 'text/html' : path.endsWith('.js') ? 'text/javascript' : 'text/css';
        const source = path === '/' ? (await readFile(resolve(appRoot, 'index.html'), 'utf8')).replace('SESSION_TOKEN', token)
          : path === '/client.js' ? script : await readFile(resolve(appRoot, 'style.css'), 'utf8');
        response.writeHead(200, { 'Content-Type': type }); response.end(source); return;
      }
      if (request.headers['x-simkind-session'] !== token) { send(response, 403, { error: 'Missing local session token.' }); return; }
      if (request.method === 'GET' && path === '/api/catalog') { send(response, 200, await session.catalog()); return; }
      if (request.method === 'GET' && path === '/api/state') { send(response, 200, session.state()); return; }
      if (request.method !== 'POST') { send(response, 404, { error: 'Unknown route.' }); return; }
      const data = await body(request);
      let result: unknown = {};
      switch (path) {
        case '/api/document-fields': result = documentFields(String(data.source), data.representation === 'markdown' ? 'markdown' : 'json'); break;
        case '/api/document-save': result = { source: saveDocumentFields(data.document as PortableDocument, data.representation === 'markdown' ? 'markdown' : 'json') }; break;
        case '/api/template': result = await session.template(String(data.name)); break;
        case '/api/validate': result = session.validate(data as unknown as Draft); break;
        case '/api/start': session.start(data as unknown as Draft); break;
        case '/api/step': session.dispatch(); await session.step(); break;
        case '/api/advance': await session.step(); break;
        case '/api/run': session.run(); break;
        case '/api/pause': session.pause(); break;
        case '/api/stop': session.stop(); break;
        case '/api/save': result = { name: await session.save() }; break;
        case '/api/open': await session.open(String(data.name)); break;
        case '/api/branch': session.branch(); break;
        case '/api/intervene': session.intervene(String(data.actor), data.edit as StateEdit); break;
        case '/api/world-preview': result = session.previewWorld(data as unknown as HostIntervention); break;
        case '/api/world-intervene': session.interveneWorld(data as unknown as HostIntervention); break;
        case '/api/compare': result = await session.compare(typeof data.name === 'string' ? data.name : undefined); break;
        case '/api/import': session.importPlayback(data as unknown as Parameters<PlaygroundSession['importPlayback']>[0]); break;
        case '/api/export': result = session.exportPlayback(data.redact === true); break;
        default: send(response, 404, { error: 'Unknown route.' }); return;
      }
      send(response, 200, result);
    } catch (error) { send(response, 400, { error: error instanceof Error ? error.message : 'Request failed.' }); }
  });
  await new Promise<void>(resolve => server.listen(options.port ?? 4317, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No local server address.');
  origin = `http://127.0.0.1:${address.port}`;
  return { server, origin, session, token };
}
