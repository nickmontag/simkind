import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';

// Read staged blobs so a clean working copy cannot hide an unsafe staged value.
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0').filter(Boolean);
const patterns = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['provider token', /\b(?:sk-(?:or-v1-)?|ghp_|github_pat_)[A-Za-z0-9_-]{20,}/],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['URL credentials', /https?:\/\/[^\s/:]+:[^\s/@]+@/],
];
let failures = 0;
function fail(file, reason) {
  console.error(`${file}: ${reason} (value omitted)`);
  failures += 1;
}

for (const file of files) {
  const name = basename(file);
  if ((name === '.env' || name.startsWith('.env.')) && file !== '.env.example') {
    fail(file, 'environment file must not be tracked');
    continue;
  }
  const source = execFileSync('git', ['show', `:${file}`], {
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  if (file === '.env.example') {
    for (const line of source.split(/\r?\n/)) {
      if (line.trim() && !line.trim().startsWith('#') && !/^[A-Z_][A-Z0-9_]*=\s*$/.test(line)) {
        fail(file, 'example must contain only comments and empty assignments');
        break;
      }
    }
  }
  for (const [label, pattern] of patterns) {
    if (pattern.test(source)) fail(file, label);
  }
}

if (failures > 0) process.exitCode = 1;
else console.log(`Public-file checks passed for ${files.length} tracked files.`);
