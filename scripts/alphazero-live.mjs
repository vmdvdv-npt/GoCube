import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const alphaZeroRoot = resolve(
  process.env.GOCUBE_ALPHAZERO_DIR ?? resolve(root, '..', 'gocube-alphazero'),
);
const alphaZeroPython = resolve(alphaZeroRoot, '.venv', 'bin', 'python');
const defaultBaseUrl = 'http://127.0.0.1:8765';
const baseUrl = (process.env.VITE_ALPHAZERO_BASE_URL ?? defaultBaseUrl).replace(/\/+$/, '');

let ownedService = null;
let shuttingDown = false;

const fail = (message) => {
  throw new Error(`GoCube AlphaZero live acceptance: ${message}`);
};

const health = async () => {
  try {
    const response = await fetch(`${baseUrl}/v1/health`, { signal: AbortSignal.timeout(1_000) });
    if (!response.ok) return false;
    const payload = await response.json();
    return (
      payload?.protocolVersion === 1 &&
      payload?.status === 'ok' &&
      payload?.service === 'gocube-alphazero' &&
      payload?.capabilities?.selectMove === true
    );
  } catch {
    return false;
  }
};

const ensureExecutable = async (path, label) => {
  try {
    await access(path, constants.X_OK);
  } catch {
    fail(`${label} is unavailable: ${path}`);
  }
};

const stopOwnedService = async () => {
  if (!ownedService || ownedService.exitCode !== null || shuttingDown) return;
  shuttingDown = true;
  ownedService.kill('SIGTERM');
  await Promise.race([
    new Promise((resolvePromise) => ownedService.once('exit', resolvePromise)),
    sleep(5_000),
  ]);
  if (ownedService.exitCode === null) ownedService.kill('SIGKILL');
};

const startLocalService = async () => {
  if (baseUrl !== defaultBaseUrl) {
    fail(
      `configured service ${baseUrl} is unavailable; automatic startup is only supported for ${defaultBaseUrl}`,
    );
  }

  await ensureExecutable(alphaZeroPython, 'sibling AlphaZero Python');

  console.log(`GoCube AlphaZero live acceptance: starting service from ${alphaZeroRoot}`);
  ownedService = spawn(
    alphaZeroPython,
    [
      '-m',
      'alphazero.envs.gocube.integration.server',
      '--checkpoint-dir',
      resolve(alphaZeroRoot, 'runs'),
      '--host',
      '127.0.0.1',
      '--port',
      '8765',
    ],
    {
      cwd: alphaZeroRoot,
      stdio: 'inherit',
      env: process.env,
    },
  );

  const startupDeadline = Date.now() + 30_000;
  while (Date.now() < startupDeadline) {
    if (ownedService.exitCode !== null) {
      fail(`AlphaZero service exited during startup with status ${ownedService.exitCode}`);
    }
    if (await health()) {
      console.log('GoCube AlphaZero live acceptance: service ready');
      return;
    }
    await sleep(200);
  }

  fail(`AlphaZero service did not become healthy at ${baseUrl} within 30 seconds`);
};

const runPlaywright = async () => {
  const child = spawn(
    'playwright',
    [
      'test',
      'e2e/alphazero-live.spec.ts',
      'e2e/alphazero-live-lifecycle.spec.ts',
      '--project=chromium',
      '--workers=1',
    ],
    {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        ALPHAZERO_LIVE: '1',
        VITE_ALPHAZERO_BASE_URL: baseUrl,
      },
    },
  );

  return await new Promise((resolvePromise, rejectPromise) => {
    child.once('error', rejectPromise);
    child.once('exit', (code, signal) => {
      if (signal) {
        rejectPromise(new Error(`Playwright terminated by ${signal}`));
        return;
      }
      resolvePromise(code ?? 1);
    });
  });
};

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await stopOwnedService();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  });
}

let exitCode = 1;
try {
  if (await health()) {
    console.log(`GoCube AlphaZero live acceptance: reusing healthy service at ${baseUrl}`);
  } else {
    await startLocalService();
  }
  exitCode = await runPlaywright();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exitCode = 1;
} finally {
  await stopOwnedService();
}

process.exitCode = exitCode;
