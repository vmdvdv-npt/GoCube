import type { GameState, StoneColor } from '../game/types';
import type { PointId } from '../topology/Topology';

export type InferredGameStateAction =
  | Readonly<{ type: 'pass' }>
  | Readonly<{ type: 'place-stone'; point: PointId }>;

export interface InferredGameStateTransition {
  readonly moveNumber: number;
  readonly color: StoneColor;
  readonly action: InferredGameStateAction;
}

/**
 * Infers the accepted game action represented by two adjacent authoritative
 * GameState snapshots. Captures are intentionally ignored: a placement is
 * identified by the one logical point that changed from empty to the mover's
 * stone color.
 */
export const inferGameStateTransition = (
  source: GameState,
  target: GameState,
  pointIds: readonly PointId[],
  label = 'Game state transition',
): InferredGameStateTransition => {
  const boardChanged = pointIds.some((point) => source.board[point] !== target.board[point]);

  if (!boardChanged) {
    return Object.freeze({
      moveNumber: target.moveNumber,
      color: source.currentPlayer,
      action: Object.freeze({ type: 'pass' as const }),
    });
  }

  const placedPoints = pointIds.filter(
    (point) =>
      source.board[point] === 'empty' &&
      target.board[point] === source.currentPlayer,
  );
  if (placedPoints.length !== 1) {
    throw new Error(`${label} is impossible: expected exactly one newly placed stone`);
  }

  return Object.freeze({
    moveNumber: target.moveNumber,
    color: source.currentPlayer,
    action: Object.freeze({ type: 'place-stone' as const, point: placedPoints[0]! }),
  });
};
