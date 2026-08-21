import type { CaptureCounts, GamePhase, GameState, PointOccupancy, RuleSet, StoneColor } from '../core/game/types';
import type { GameSessionSnapshot } from '../core/persistence/GameSessionSnapshot';
import type { FinalScore } from '../core/scoring/Scoring';
import type { PointId } from '../core/topology/Topology';

export interface GameViewPoint {
  readonly logicalPointId: PointId;
  readonly occupancy: PointOccupancy;
  /** Action number that placed the currently visible stone. Present when history is available. */
  readonly moveNumber?: number | null;
}

export interface GameViewModel {
  readonly points: readonly GameViewPoint[];
  readonly currentPlayer: StoneColor;
  readonly moveNumber: number;
  readonly consecutivePasses: number;
  readonly phase: GamePhase;
  readonly captures: CaptureCounts;
  readonly ruleSet: RuleSet;
  readonly komi: number;
  readonly finalScore: FinalScore | null;
  /** Logical point of the most recently placed stone. Passes do not change it. */
  readonly lastMovePointId?: PointId | null;
}

export interface PresentationContext {
  readonly ruleSet: RuleSet;
  readonly komi: number;
  readonly finalScore: FinalScore | null;
  /** Optional session history used only to derive presentation metadata such as stone numbers. */
  readonly history?: readonly GameState[];
}

export interface PresentationSessionSource {
  state(): GameState;
  snapshot(): GameSessionSnapshot;
}

const comparePointIds = (left: PointId, right: PointId): number =>
  left < right ? -1 : left > right ? 1 : 0;

const cloneCaptures = (captures: CaptureCounts): CaptureCounts =>
  Object.freeze({ black: captures.black, white: captures.white });

const cloneFinalScore = (score: FinalScore): FinalScore =>
  Object.freeze({
    ruleSet: score.ruleSet,
    black: score.black,
    white: score.white,
    komi: score.komi,
    territory: Object.freeze({
      black: score.territory.black,
      white: score.territory.white,
      neutral: score.territory.neutral,
      seki: score.territory.seki,
    }),
    territoryPoints: Object.freeze({
      black: Object.freeze([...score.territoryPoints.black].sort(comparePointIds)),
      white: Object.freeze([...score.territoryPoints.white].sort(comparePointIds)),
      neutral: Object.freeze([...score.territoryPoints.neutral].sort(comparePointIds)),
      seki: Object.freeze([...score.territoryPoints.seki].sort(comparePointIds)),
    }),
    stonesOnBoard: Object.freeze({
      black: score.stonesOnBoard.black,
      white: score.stonesOnBoard.white,
    }),
    captures: cloneCaptures(score.captures),
    prisoners: score.prisoners ? cloneCaptures(score.prisoners) : null,
    deadStones: Object.freeze({
      black: score.deadStones.black,
      white: score.deadStones.white,
    }),
    winner: score.winner,
    margin: score.margin,
  });

interface StoneMoveMetadata {
  readonly moveNumbers: ReadonlyMap<PointId, number>;
  readonly lastMovePointId: PointId | null;
}

const deriveStoneMoveMetadata = (
  history: readonly GameState[],
  currentState: GameState,
): StoneMoveMetadata => {
  const moveNumbers = new Map<PointId, number>();
  let lastMovePointId: PointId | null = null;

  for (let index = 1; index < history.length; index += 1) {
    const previous = history[index - 1]!;
    const next = history[index]!;
    const placedPoints = Object.keys(next.board).filter(
      (point) => previous.board[point] === 'empty' && next.board[point] !== 'empty',
    );

    if (next.moveNumber === previous.moveNumber + 1 && placedPoints.length === 1) {
      const placedPoint = placedPoints[0]!;
      moveNumbers.set(placedPoint, next.moveNumber);
      lastMovePointId = placedPoint;
    }

    for (const point of Object.keys(next.board)) {
      if (next.board[point] === 'empty') moveNumbers.delete(point);
    }
  }

  for (const point of Object.keys(currentState.board)) {
    if (currentState.board[point] === 'empty') moveNumbers.delete(point);
  }

  if (lastMovePointId && currentState.board[lastMovePointId] === 'empty') {
    lastMovePointId = null;
  }

  return Object.freeze({ moveNumbers, lastMovePointId });
};

export class PresentationModel {
  fromSession(session: PresentationSessionSource): GameViewModel {
    const snapshot = session.snapshot();
    return this.create(session.state(), {
      ruleSet: snapshot.ruleSet,
      komi: snapshot.komi,
      finalScore: snapshot.finalScore,
      history: snapshot.history,
    });
  }

  create(state: GameState, context: PresentationContext): GameViewModel {
    const stoneMetadata = context.history
      ? deriveStoneMoveMetadata(context.history, state)
      : null;
    const points = Object.keys(state.board)
      .sort(comparePointIds)
      .map((logicalPointId) => {
        const point = {
          logicalPointId,
          occupancy: state.board[logicalPointId]!,
        };
        return Object.freeze(
          stoneMetadata
            ? {
                ...point,
                moveNumber:
                  state.board[logicalPointId] === 'empty'
                    ? null
                    : stoneMetadata.moveNumbers.get(logicalPointId) ?? null,
              }
            : point,
        );
      });

    const viewModel = {
      points: Object.freeze(points),
      currentPlayer: state.currentPlayer,
      moveNumber: state.moveNumber,
      consecutivePasses: state.consecutivePasses,
      phase: state.phase,
      captures: cloneCaptures(state.captures),
      ruleSet: context.ruleSet,
      komi: context.komi,
      finalScore:
        state.phase === 'finished' && context.finalScore
          ? cloneFinalScore(context.finalScore)
          : null,
    };

    return Object.freeze(
      stoneMetadata
        ? { ...viewModel, lastMovePointId: stoneMetadata.lastMovePointId }
        : viewModel,
    );
  }
}
