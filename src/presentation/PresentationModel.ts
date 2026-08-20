import type { CaptureCounts, GamePhase, GameState, PointOccupancy, RuleSet, StoneColor } from '../core/game/types';
import type { GameSessionSnapshot } from '../core/persistence/GameSessionSnapshot';
import type { FinalScore } from '../core/scoring/Scoring';
import type { PointId } from '../core/topology/Topology';

export interface GameViewPoint {
  readonly logicalPointId: PointId;
  readonly occupancy: PointOccupancy;
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
}

export interface PresentationContext {
  readonly ruleSet: RuleSet;
  readonly komi: number;
  readonly finalScore: FinalScore | null;
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

export class PresentationModel {
  fromSession(session: PresentationSessionSource): GameViewModel {
    const snapshot = session.snapshot();
    return this.create(session.state(), {
      ruleSet: snapshot.ruleSet,
      komi: snapshot.komi,
      finalScore: snapshot.finalScore,
    });
  }

  create(state: GameState, context: PresentationContext): GameViewModel {
    const points = Object.keys(state.board)
      .sort(comparePointIds)
      .map((logicalPointId) =>
        Object.freeze({
          logicalPointId,
          occupancy: state.board[logicalPointId]!,
        }),
      );

    return Object.freeze({
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
    });
  }
}
