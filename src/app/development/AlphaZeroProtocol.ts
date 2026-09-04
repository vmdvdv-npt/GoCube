import type { RuleSet, StoneColor } from '../../core/game/types';
import { CubeTopology, isValidCubeSize } from '../../core/topology/CubeTopology';
import type { PointId, Topology } from '../../core/topology/Topology';
import { TORUS_SIZES, TorusTopology, type TorusSize } from '../../core/topology/TorusTopology';
import {
  ALPHAZERO_PROTOCOL_VERSION,
  AlphaZeroGatewayError,
  type AlphaZeroAction,
  type AlphaZeroCheckpointDescriptor,
  type AlphaZeroGeneratedGame,
  type AlphaZeroGeneratedMove,
  type AlphaZeroHealth,
  type AlphaZeroTopology,
} from './AlphaZeroGateway';

const protocolError = (message: string): never => {
  throw new AlphaZeroGatewayError(message, 'protocol');
};

const asRecord = (value: unknown, context: string): Readonly<Record<string, unknown>> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return protocolError(`${context} must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
};

const requiredString = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  context: string,
): string => {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    return protocolError(`${context}.${key} must be a non-empty string.`);
  }
  return value;
};

const finiteNumber = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  context: string,
): number => {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return protocolError(`${context}.${key} must be a finite number.`);
  }
  return value;
};

const safeInteger = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  context: string,
  minimum = 0,
): number => {
  const value = finiteNumber(record, key, context);
  if (!Number.isSafeInteger(value) || value < minimum) {
    return protocolError(`${context}.${key} must be a safe integer >= ${minimum}.`);
  }
  return value;
};

const protocolVersion = (record: Readonly<Record<string, unknown>>, context: string): 1 => {
  const version = safeInteger(record, 'protocolVersion', context, 1);
  if (version !== ALPHAZERO_PROTOCOL_VERSION) {
    return protocolError(
      `${context}.protocolVersion ${version} is unsupported; expected ${ALPHAZERO_PROTOCOL_VERSION}.`,
    );
  }
  return ALPHAZERO_PROTOCOL_VERSION;
};

const topologyValue = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  context: string,
): AlphaZeroTopology => {
  const value = record[key];
  if (value !== 'cube' && value !== 'torus') {
    return protocolError(`${context}.${key} must be "cube" or "torus".`);
  }
  return value;
};

const ruleSetValue = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  context: string,
): RuleSet => {
  const value = record[key];
  if (value !== 'chinese' && value !== 'japanese') {
    return protocolError(`${context}.${key} must be "chinese" or "japanese".`);
  }
  return value;
};

const colorValue = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  context: string,
): StoneColor => {
  const value = record[key];
  if (value !== 'black' && value !== 'white') {
    return protocolError(`${context}.${key} must be "black" or "white".`);
  }
  return value;
};

const torusSize = (size: number): TorusSize | null =>
  TORUS_SIZES.find((candidate) => candidate === size) ?? null;

const topologyFor = (topology: AlphaZeroTopology, size: number, context: string): Topology => {
  if (topology === 'cube') {
    if (!isValidCubeSize(size)) {
      return protocolError(`${context}.size must be a valid Cube size >= 2.`);
    }
    return new CubeTopology(size);
  }

  const supportedSize = torusSize(size);
  if (supportedSize === null) {
    return protocolError(
      `${context}.size ${size} is not a supported Torus size (${TORUS_SIZES.join(', ')}).`,
    );
  }
  return new TorusTopology(supportedSize);
};

const normalizedKomi = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  context: string,
): number => {
  const value = finiteNumber(record, key, context);
  if (!Number.isInteger(value - 0.5)) {
    return protocolError(`${context}.${key} must be normalized to an x.5 GoCube value.`);
  }
  return value;
};

const pointIdValue = (
  value: unknown,
  topology: Topology,
  context: string,
): PointId => {
  if (typeof value !== 'string' || value.length === 0 || !topology.has(value)) {
    return protocolError(`${context} must be a canonical PointId for ${topology.id}.`);
  }
  return value;
};

export const parseAlphaZeroHealth = (value: unknown): AlphaZeroHealth => {
  const record = asRecord(value, 'health');
  return Object.freeze({
    protocolVersion: protocolVersion(record, 'health'),
    service: requiredString(record, 'service', 'health'),
    version: requiredString(record, 'version', 'health'),
  });
};

const parseCheckpoint = (value: unknown, context: string): AlphaZeroCheckpointDescriptor => {
  const record = asRecord(value, context);
  const topology = topologyValue(record, 'topology', context);
  const size = safeInteger(record, 'size', context, 2);
  topologyFor(topology, size, context);

  return Object.freeze({
    id: requiredString(record, 'id', context),
    runName: requiredString(record, 'runName', context),
    iteration: safeInteger(record, 'iteration', context),
    topology,
    size,
    ruleSet: ruleSetValue(record, 'ruleSet', context),
    komi: normalizedKomi(record, 'komi', context),
  });
};

export const parseAlphaZeroCheckpointList = (
  value: unknown,
): readonly AlphaZeroCheckpointDescriptor[] => {
  const record = asRecord(value, 'checkpointList');
  protocolVersion(record, 'checkpointList');
  const rawCheckpoints = record.checkpoints;
  if (!Array.isArray(rawCheckpoints)) {
    return protocolError('checkpointList.checkpoints must be an array.');
  }

  const checkpoints = rawCheckpoints.map((checkpoint, index) =>
    parseCheckpoint(checkpoint, `checkpointList.checkpoints[${index}]`),
  );
  const ids = new Set<string>();
  for (const checkpoint of checkpoints) {
    if (ids.has(checkpoint.id)) {
      return protocolError(`checkpointList contains duplicate checkpoint id "${checkpoint.id}".`);
    }
    ids.add(checkpoint.id);
  }
  return Object.freeze(checkpoints);
};

const parseAction = (
  value: unknown,
  topology: Topology,
  context: string,
): AlphaZeroAction => {
  const record = asRecord(value, context);
  if (record.type === 'pass') {
    return Object.freeze({ type: 'pass' });
  }
  if (record.type === 'place') {
    return Object.freeze({
      type: 'place',
      pointId: pointIdValue(record.pointId, topology, `${context}.pointId`),
    });
  }
  return protocolError(`${context}.type must be "place" or "pass".`);
};

const parseCaptured = (
  value: unknown,
  topology: Topology,
  context: string,
): readonly PointId[] | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return protocolError(`${context} must be an array when present.`);
  const points = value.map((point, index) =>
    pointIdValue(point, topology, `${context}[${index}]`),
  );
  if (new Set(points).size !== points.length) {
    return protocolError(`${context} must not contain duplicate PointIds.`);
  }
  return Object.freeze(points);
};

const parseMove = (
  value: unknown,
  expectedMoveNumber: number,
  topology: Topology,
  context: string,
): AlphaZeroGeneratedMove => {
  const record = asRecord(value, context);
  const moveNumber = safeInteger(record, 'moveNumber', context, 1);
  if (moveNumber !== expectedMoveNumber) {
    return protocolError(
      `${context}.moveNumber must be ${expectedMoveNumber}; received ${moveNumber}.`,
    );
  }
  const captured = parseCaptured(record.captured, topology, `${context}.captured`);
  return Object.freeze({
    moveNumber,
    color: colorValue(record, 'color', context),
    action: parseAction(record.action, topology, `${context}.action`),
    ...(captured === undefined ? {} : { captured }),
  });
};

export const parseAlphaZeroGeneratedGame = (value: unknown): AlphaZeroGeneratedGame => {
  const record = asRecord(value, 'generatedGame');
  const topologyName = topologyValue(record, 'topology', 'generatedGame');
  const size = safeInteger(record, 'size', 'generatedGame', 2);
  const topology = topologyFor(topologyName, size, 'generatedGame');
  const rawMoves = record.moves;
  if (!Array.isArray(rawMoves)) {
    return protocolError('generatedGame.moves must be an array.');
  }

  const moves = rawMoves.map((move, index) =>
    parseMove(move, index + 1, topology, `generatedGame.moves[${index}]`),
  );

  const game: AlphaZeroGeneratedGame = {
    protocolVersion: protocolVersion(record, 'generatedGame'),
    topology: topologyName,
    size,
    ruleSet: ruleSetValue(record, 'ruleSet', 'generatedGame'),
    komi: normalizedKomi(record, 'komi', 'generatedGame'),
    blackCheckpoint: requiredString(record, 'blackCheckpoint', 'generatedGame'),
    whiteCheckpoint: requiredString(record, 'whiteCheckpoint', 'generatedGame'),
    mctsSimulations: safeInteger(record, 'mctsSimulations', 'generatedGame', 1),
    moves: Object.freeze(moves),
    ...(Object.prototype.hasOwnProperty.call(record, 'terminal') ? { terminal: record.terminal } : {}),
    ...(Object.prototype.hasOwnProperty.call(record, 'result') ? { result: record.result } : {}),
  };
  return Object.freeze(game);
};
