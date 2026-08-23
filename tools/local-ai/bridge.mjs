#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const PROTOCOL_VERSION = 1;
const BRIDGE_VERSION = '0.3.03';
const HOST = '127.0.0.1';
const PORT = Number(process.env.CUBEGO_LOCAL_AI_PORT ?? '4777');
const MAX_BODY_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = Number(process.env.CUBEGO_LOCAL_AI_TIMEOUT_MS ?? '30000');
const MAX_VISITS = Number(process.env.CUBEGO_KATAGO_MAX_VISITS ?? '200');
const KATAGO_PATH = process.env.CUBEGO_KATAGO_PATH ?? '';
const MODEL_PATH = process.env.CUBEGO_KATAGO_MODEL ?? '';
const CONFIG_PATH = process.env.CUBEGO_KATAGO_CONFIG ?? '';
const AUTH_TOKEN = process.env.CUBEGO_LOCAL_AI_TOKEN ?? '';
const ALLOWED_ORIGINS = new Set(
  (process.env.CUBEGO_LOCAL_AI_ORIGINS ?? 'http://127.0.0.1:5173,http://localhost:5173')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);

let engine = null;
let stdoutBuffer = '';
let stderrTail = '';
const pending = new Map();

const configurationProblem = () => {
  if (!Number.isSafeInteger(PORT) || PORT < 1 || PORT > 65535) return `Invalid port: ${String(PORT)}`;
  if (!KATAGO_PATH) return 'CUBEGO_KATAGO_PATH is not configured.';
  if (!MODEL_PATH) return 'CUBEGO_KATAGO_MODEL is not configured.';
  if (!CONFIG_PATH) return 'CUBEGO_KATAGO_CONFIG is not configured.';
  if (!Number.isFinite(REQUEST_TIMEOUT_MS) || REQUEST_TIMEOUT_MS < 100) {
    return `Invalid CUBEGO_LOCAL_AI_TIMEOUT_MS: ${String(REQUEST_TIMEOUT_MS)}`;
  }
  if (!Number.isSafeInteger(MAX_VISITS) || MAX_VISITS < 1) {
    return `Invalid CUBEGO_KATAGO_MAX_VISITS: ${String(MAX_VISITS)}`;
  }
  return null;
};

const sendJson = (response, status, body, origin = null) => {
  const text = `${JSON.stringify(body)}\n`;
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
  });
  response.end(text);
};

const rejectPending = (message) => {
  for (const { reject, timeout } of pending.values()) {
    clearTimeout(timeout);
    reject(new Error(message));
  }
  pending.clear();
};

const handleEngineLine = (line) => {
  if (!line.trim()) return;
  let payload;
  try {
    payload = JSON.parse(line);
  } catch {
    return;
  }
  if (!payload || typeof payload !== 'object' || typeof payload.id !== 'string') return;
  const request = pending.get(payload.id);
  if (!request) return;
  pending.delete(payload.id);
  clearTimeout(request.timeout);
  if (payload.error) request.reject(new Error(String(payload.error)));
  else request.resolve(payload);
};

const startEngine = () => {
  const problem = configurationProblem();
  if (problem) throw new Error(problem);
  if (engine && engine.exitCode === null) return engine;

  engine = spawn(
    KATAGO_PATH,
    ['analysis', '-model', MODEL_PATH, '-config', CONFIG_PATH],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
  );
  stdoutBuffer = '';
  stderrTail = '';

  engine.stdout.setEncoding('utf8');
  engine.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk;
    while (true) {
      const newline = stdoutBuffer.indexOf('\n');
      if (newline < 0) break;
      const line = stdoutBuffer.slice(0, newline);
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      handleEngineLine(line);
    }
  });

  engine.stderr.setEncoding('utf8');
  engine.stderr.on('data', (chunk) => {
    stderrTail = `${stderrTail}${chunk}`.slice(-4000);
  });

  engine.on('error', (error) => rejectPending(`KataGo process error: ${error.message}`));
  engine.on('exit', (code, signal) => {
    rejectPending(`KataGo exited (code=${String(code)}, signal=${String(signal)}). ${stderrTail}`.trim());
    engine = null;
  });

  return engine;
};

const katagoColumn = (column) => {
  let value = column;
  let label = '';
  while (value >= 0) {
    let digit = value % 25;
    value = Math.floor(value / 25) - 1;
    if (digit >= 8) digit += 1; // GTP coordinates skip I.
    label = String.fromCharCode(65 + digit) + label;
  }
  return label;
};

const katagoLocation = (row, column, boardSize) => `${katagoColumn(column)}${boardSize - row}`;

const validatePosition = (position) => {
  if (!position || typeof position !== 'object' || Array.isArray(position)) {
    throw new Error('position must be an object.');
  }
  const { boardSize, currentPlayer, stones, targetCoordinates } = position;
  if (!Number.isSafeInteger(boardSize) || boardSize < 2 || boardSize > 25) {
    throw new Error('boardSize must be an integer from 2 to 25.');
  }
  if (currentPlayer !== 'black' && currentPlayer !== 'white') {
    throw new Error('currentPlayer must be black or white.');
  }
  if (!Array.isArray(stones) || stones.length > boardSize * boardSize) {
    throw new Error('stones must be a bounded array.');
  }
  if (!Array.isArray(targetCoordinates) || targetCoordinates.length > boardSize * boardSize) {
    throw new Error('targetCoordinates must be a bounded array.');
  }

  const seen = new Set();
  const validatedStones = stones.map((stone) => {
    if (!stone || typeof stone !== 'object' || Array.isArray(stone)) throw new Error('Invalid stone.');
    const { row, column, color } = stone;
    if (
      !Number.isSafeInteger(row) ||
      !Number.isSafeInteger(column) ||
      row < 0 ||
      column < 0 ||
      row >= boardSize ||
      column >= boardSize ||
      (color !== 'black' && color !== 'white')
    ) {
      throw new Error('Invalid stone coordinate or color.');
    }
    const key = `${row},${column}`;
    if (seen.has(key)) throw new Error(`Duplicate stone coordinate: ${key}`);
    seen.add(key);
    return { row, column, color };
  });

  const validatedTargets = targetCoordinates.map((target) => {
    if (!target || typeof target !== 'object' || Array.isArray(target)) {
      throw new Error('Invalid target coordinate.');
    }
    const { row, column } = target;
    if (
      !Number.isSafeInteger(row) ||
      !Number.isSafeInteger(column) ||
      row < 0 ||
      column < 0 ||
      row >= boardSize ||
      column >= boardSize
    ) {
      throw new Error('Invalid target coordinate.');
    }
    return { row, column };
  });

  return { boardSize, currentPlayer, stones: validatedStones, targetCoordinates: validatedTargets };
};

const runKataGo = (position) => {
  const process = startEngine();
  const id = `cubego-${randomUUID()}`;
  const query = {
    id,
    boardXSize: position.boardSize,
    boardYSize: position.boardSize,
    rules: 'Chinese',
    komi: 7.5,
    initialPlayer: position.currentPlayer === 'black' ? 'B' : 'W',
    initialStones: position.stones.map((stone) => [
      stone.color === 'black' ? 'B' : 'W',
      katagoLocation(stone.row, stone.column, position.boardSize),
    ]),
    moves: [],
    analyzeTurns: [0],
    maxVisits: MAX_VISITS,
    includeOwnership: true,
    includePolicy: true,
  };

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`KataGo analysis timed out after ${REQUEST_TIMEOUT_MS} ms.`));
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timeout });
    process.stdin.write(`${JSON.stringify(query)}\n`, (error) => {
      if (!error) return;
      pending.delete(id);
      clearTimeout(timeout);
      reject(error);
    });
  });
};

const readJsonBody = (request) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error(`Request exceeds ${MAX_BODY_BYTES} bytes.`));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(new Error(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
    request.on('error', reject);
  });

const originFor = (request) => {
  const origin = request.headers.origin;
  if (!origin) return null;
  return ALLOWED_ORIGINS.has(origin) ? origin : false;
};

const authorized = (request) =>
  !AUTH_TOKEN || request.headers.authorization === `Bearer ${AUTH_TOKEN}`;

const server = createServer(async (request, response) => {
  const origin = originFor(request);
  if (origin === false) {
    sendJson(response, 403, { error: 'Origin is not allowed.' });
    return;
  }
  if (!authorized(request)) {
    sendJson(response, 401, { error: 'Invalid local analysis token.' }, origin);
    return;
  }

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Max-Age': '600',
    });
    response.end();
    return;
  }

  if (request.method === 'GET' && (request.url === '/health' || request.url === '/version')) {
    const problem = configurationProblem();
    sendJson(
      response,
      200,
      {
        protocolVersion: PROTOCOL_VERSION,
        version: BRIDGE_VERSION,
        available: problem === null,
        ...(problem ? { reason: problem } : {}),
        engineWarm: Boolean(engine && engine.exitCode === null),
      },
      origin,
    );
    return;
  }

  if (request.method !== 'POST' || request.url !== '/analyze') {
    sendJson(response, 404, { error: 'Not found.' }, origin);
    return;
  }

  const problem = configurationProblem();
  if (problem) {
    sendJson(response, 503, { error: problem }, origin);
    return;
  }
  if (pending.size >= 1) {
    sendJson(response, 429, { error: 'Local analysis bridge is busy.' }, origin);
    return;
  }

  try {
    const body = await readJsonBody(request);
    if (!body || typeof body !== 'object' || body.protocolVersion !== PROTOCOL_VERSION) {
      throw new Error(`protocolVersion must be ${PROTOCOL_VERSION}.`);
    }
    const position = validatePosition(body.position);
    const result = await runKataGo(position);
    sendJson(response, 200, { protocolVersion: PROTOCOL_VERSION, result }, origin);
  } catch (error) {
    sendJson(
      response,
      400,
      { error: error instanceof Error ? error.message : String(error) },
      origin,
    );
  }
});

server.listen(PORT, HOST, () => {
  const problem = configurationProblem();
  console.log(`CubeGo Local Analysis Bridge ${BRIDGE_VERSION} listening on http://${HOST}:${PORT}`);
  if (problem) console.log(`Local AI unavailable until configured: ${problem}`);
});

const shutdown = () => {
  server.close();
  if (engine && engine.exitCode === null) engine.kill();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
