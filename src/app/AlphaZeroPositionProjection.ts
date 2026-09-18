import { inferGameStateTransition } from '../core/history/GameStateTransition';
import type { GameSessionSnapshot } from '../core/persistence/GameSessionSnapshot';
import type { PointId } from '../core/topology/Topology';
import type {
  AlphaZeroPosition,
  AlphaZeroPositionMove,
  AlphaZeroTopology,
} from './development/AlphaZeroGateway';

export interface AlphaZeroPositionProjectionOptions {
  readonly topology: AlphaZeroTopology;
  readonly size: number;
}

/**
 * Projects the authoritative GoCube History into the stateless Protocol V1
 * position contract. No parallel bot history is stored: every projection is
 * rebuilt from the supplied GameSessionSnapshot.
 */
export const projectGameSessionToAlphaZeroPosition = (
  snapshot: GameSessionSnapshot,
  options: AlphaZeroPositionProjectionOptions,
): AlphaZeroPosition => {
  if (!Number.isSafeInteger(options.size) || options.size <= 0) {
    throw new Error(`AlphaZero board size must be a positive safe integer, got ${String(options.size)}`);
  }
  if (snapshot.boardSize !== undefined && snapshot.boardSize !== options.size) {
    throw new Error(
      `AlphaZero board size mismatch: session=${snapshot.boardSize}, requested=${options.size}`,
    );
  }
  if (snapshot.history.length === 0) {
    throw new Error('GameSession history must contain an initial state');
  }

  const moves: AlphaZeroPositionMove[] = [];
  for (let index = 1; index < snapshot.history.length; index += 1) {
    const source = snapshot.history[index - 1]!;
    const target = snapshot.history[index]!;
    const pointIds = Object.keys(source.board) as PointId[];
    const transition = inferGameStateTransition(
      source,
      target,
      pointIds,
      `GameSession history transition ${index - 1} -> ${index}`,
    );

    moves.push(
      Object.freeze({
        moveNumber: transition.moveNumber,
        color: transition.color,
        action:
          transition.action.type === 'pass'
            ? Object.freeze({ type: 'pass' as const })
            : Object.freeze({ type: 'place' as const, pointId: transition.action.point }),
      }),
    );
  }

  return Object.freeze({
    topology: options.topology,
    size: options.size,
    ruleSet: snapshot.ruleSet,
    komi: snapshot.komi,
    moves: Object.freeze(moves),
  });
};
