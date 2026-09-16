import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const launcher = readFileSync(resolve(root, 'dev'), 'utf8');
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const playwright = readFileSync(resolve(root, 'playwright.config.ts'), 'utf8');

assert.match(
  launcher,
  /-m alphazero\.envs\.gocube\.integration\.server/,
  'unified launcher must start the canonical AlphaZero Protocol V1 server directly',
);
assert.doesNotMatch(
  launcher,
  /dev-gocube/,
  'unified launcher must not depend on the obsolete AlphaZero dev-gocube wrapper',
);
assert.equal(packageJson.scripts.dev, 'bash ./dev');
assert.equal(packageJson.scripts['dev:ui'], 'vite');
assert.match(playwright, /npm run dev:ui/);
assert.doesNotMatch(playwright, /npm run dev --/);

console.log('dev launcher contract: OK');
