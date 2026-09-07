import type { GameState, PointOccupancy, StoneColor } from '../game/types';
import type { Topology } from '../topology/Topology';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStoneColor = (value: unknown): value is StoneColor =>
  value === 'black' || value === 'white';

const isPointOccupancy = (value: unknown): value is PointOccupancy =>
  value === 'empty' || isStoneColor(value);

const isGamePhase = (value: unknown): value is GameState['phase'] =>
  value === 'playing' || value === 'endgame' || value === 'finished';

const isNonNegativeSafeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

/**
 * Runtime trust boundary for serialized GameState values.
 *
 * TypeScript types disappear at persistence boundaries. Every state restored
 * from storage must therefore prove its complete board shape and all
 * rule-relevant scalar fields before History, GameSession or presentation code
 * may treat it as GameState.
 */
export const assertSerializedGameState = (
  value: unknown,
  topology: Topology,
  label: string,
): asserts value is GameState => {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }

  const board = value.board;
  if (!isRecord(board)) {
    throw new Error(`${label} board must be an object`);
  }

  const expectedPoints = topology.points();
  const expectedPointSet = new Set(expectedPoints);
  const boardPoints = Object.keys(board);
  if (
    boardPoints.length !== expectedPoints.length ||
    boardPoints.some((point) => !expectedPointSet.has(point))
  ) {
    throw new Error(`${label} board point set does not match topology`);
  }

  for (const point of expectedPoints) {
    if (!Object.prototype.hasOwnProperty.call(board, point)) {
      throw new Error(`${label} board is missing point ${point}`);
    }
    if (!isPointOccupancy(board[point])) {
      throw new Error(`${label} has invalid occupancy at ${point}`);
    }
  }

  if (!isStoneColor(value.currentPlayer)) {
    throw new Error(`${label} has invalid current player`);
  }
  if (!isNonNegativeSafeInteger(value.moveNumber)) {
    throw new Error(`${label} has invalid move number`);
  }
  if (
    !isNonNegativeSafeInteger(value.consecutivePasses) ||
    value.consecutivePasses > 2 ||
    value.consecutivePasses > value.moveNumber
  ) {
    throw new Error(`${label} has invalid consecutive pass count`);
  }
  if (!isGamePhase(value.phase)) {
    throw new Error(`${label} has invalid phase`);
  }
  if (
    (value.phase === 'playing' && value.consecutivePasses >= 2) ||
    (value.phase !== 'playing' && value.consecutivePasses !== 2)
  ) {
    throw new Error(`${label} phase is inconsistent with consecutive passes`);
  }

  const captures = value.captures;
  if (
    !isRecord(captures) ||
    !isNonNegativeSafeInteger(captures.black) ||
    !isNonNegativeSafeInteger(captures.white)
  ) {
    throw new Error(`${label} has invalid capture counters`);
  }
};

/** Validates every current/past/redo GameState before snapshot restoration. */
export const assertSerializedSnapshotGameStates = (
  snapshot: unknown,
  topology: Topology,
): void => {
  if (!isRecord(snapshot)) {
    throw new Error('Saved session snapshot must be an object');
  }

  if (!Array.isArray(snapshot.history) || snapshot.history.length === 0) {
    throw new Error('Saved game history must be a non-empty array');
  }

  snapshot.history.forEach((state, index) =>
    assertSerializedGameState(state, topology, `Saved history state ${index}`),
  );

  if (snapshot.redo === undefined) return;
  if (!Array.isArray(snapshot.redo)) {
    throw new Error('Saved Redo stack must be an array');
  }

  snapshot.redo.forEach((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Saved Redo entry ${index} must be an object`);
    }
    assertSerializedGameState(entry.state, topology, `Saved Redo state ${index}`);
  });
};
