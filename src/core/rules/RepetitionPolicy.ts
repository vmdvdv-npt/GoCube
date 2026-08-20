import type { BoardOccupancy, GameState } from '../game/types';

export interface RepetitionContext {
  /** Ordered game states ending with the current state. */
  readonly states: readonly GameState[];
}

export interface RepetitionPolicy {
  isAllowed(context: RepetitionContext, candidateState: GameState): boolean;
}

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

/**
 * Standard simple ko: reject only an immediate recreation of the board position
 * that existed immediately before the opponent's preceding move.
 *
 * RepetitionContext.states is ordered and ends in the current state, so the
 * prohibited position is the second-to-last state. Older repetitions remain
 * legal here and can be handled by another RepetitionPolicy, e.g. superko.
 */
export class SimpleKoPolicy implements RepetitionPolicy {
  isAllowed(context: RepetitionContext, candidateState: GameState): boolean {
    if (context.states.length < 2) {
      return true;
    }

    const prohibitedState = context.states[context.states.length - 2];
    return !boardsEqual(prohibitedState.board, candidateState.board);
  }
}

/**
 * Positional superko: reject recreation of any board position supplied in the
 * repetition history, not just the position immediately before the last move.
 *
 * GameState also contains turn-flow metadata, but positional superko intentionally
 * compares logical board occupancy only. Turn/player information therefore does
 * not change the repetition identity used by this policy.
 */
export class SuperkoPolicy implements RepetitionPolicy {
  isAllowed(context: RepetitionContext, candidateState: GameState): boolean {
    return context.states.every(
      (historicalState) => !boardsEqual(historicalState.board, candidateState.board),
    );
  }
}
