import { resolve } from 'node:path';
import { build } from 'esbuild';

/** HTML/CSS are read on demand; the client and its imports must be fresh too.
 * Reloading the operator UI must not require restarting its in-memory run. */
export async function bundleClient(frontendRoot: string): Promise<string> {
  const compiled = await build({ entryPoints: [resolve(frontendRoot, 'client.ts')], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', minify: false });
  return compiled.outputFiles[0].text;
}
