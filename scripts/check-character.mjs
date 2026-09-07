import { readFile } from 'node:fs/promises';
import { readCharacter, readDocument } from 'simkind/format';

const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error('Usage: npm run format:check -- <character.simkind.json|character.simkind.md> [...]');
  process.exitCode = 1;
}
for (const path of paths) {
  try {
    const source = await readFile(path, 'utf8');
    const representation = path.endsWith('.md') ? 'markdown' : 'json';
    let result = readDocument(source, representation);
    if (!result.ok && result.diagnostics[0]?.code === 'UNSUPPORTED_VERSION') result = readCharacter(source, representation);
    console.log(JSON.stringify({ path, ...result }, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch {
    console.error(JSON.stringify({ path, code: 'READ_FAILED', message: 'Could not read this local file.' }));
    process.exitCode = 1;
  }
}
