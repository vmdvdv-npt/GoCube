import type { BoardOccupancy, GameState } from '../game/types';

/** Minimal application/session context required for immediate-ko comparison. */
export interface SimpleKoContext {
  readonly previousBoard: BoardOccupancy | null;
}

export const NO_SIMPLE_KO_CONTEXT: SimpleKoContext = Object.freeze({
  previousBoard: null,
});

export const boardsEqual = (
  left: BoardOccupancy,
  right: BoardOccupancy,
): boolean => {
  const leftPoints = Object.keys(left);
  const rightPoints = Object.keys(right);

  if (leftPoints.length !== rightPoints.length) {
    return false;
  }

  return leftPoints.every(
    (point) => Object.prototype.hasOwnProperty.call(right, point) && left[point] === right[point],
  );
};

/** Standard simple ko: reject only immediate recreation of the previous board position. */
export class SimpleKoPolicy {
  isAllowed(context: SimpleKoContext, candidateState: GameState): boolean {
    return context.previousBoard === null || !boardsEqual(context.previousBoard, candidateState.board);
  }
}
