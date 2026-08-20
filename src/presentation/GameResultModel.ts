import type { EndgameClassification } from '../core/endgame/EndgameClassifier';
import type { CaptureCounts, RuleSet } from '../core/game/types';
import type { GameSessionSnapshot } from '../core/persistence/GameSessionSnapshot';
import type { FinalScore, StoneBreakdown } from '../core/scoring/Scoring';

export interface GameResultStatistics {
  readonly totalActions: number;
  readonly passes: number;
  readonly boardSize: number | null;
  readonly ruleSet: RuleSet;
  /** Captures made during play, credited to the capturing color. */
  readonly captures: CaptureCounts;
  /** Dead stones by their own color. */
  readonly deadStones: StoneBreakdown;
  /** Dead classified groups by their own color. Null only for legacy finished saves. */
  readonly deadGroups: StoneBreakdown | null;
}

export interface GameResultViewModel {
  readonly score: FinalScore;
  readonly statistics: GameResultStatistics;
}

const cloneFinalScore = (score: FinalScore): FinalScore =>
  Object.freeze({
    ...score,
    territory: Object.freeze({ ...score.territory }),
    territoryPoints: Object.freeze({
      black: Object.freeze([...score.territoryPoints.black]),
      white: Object.freeze([...score.territoryPoints.white]),
      neutral: Object.freeze([...score.territoryPoints.neutral]),
      seki: Object.freeze([...score.territoryPoints.seki]),
    }),
    stonesOnBoard: Object.freeze({ ...score.stonesOnBoard }),
    captures: Object.freeze({ ...score.captures }),
    prisoners: score.prisoners ? Object.freeze({ ...score.prisoners }) : null,
    deadStones: Object.freeze({ ...score.deadStones }),
  });

const countPasses = (snapshot: GameSessionSnapshot): number => {
  let passes = 0;

  for (let index = 1; index < snapshot.history.length; index += 1) {
    const previous = snapshot.history[index - 1]!;
    const current = snapshot.history[index]!;
    if (
      current.moveNumber === previous.moveNumber + 1 &&
      current.consecutivePasses === previous.consecutivePasses + 1
    ) {
      passes += 1;
    }
  }

  return passes;
};

const countDeadGroups = (
  snapshot: GameSessionSnapshot,
  classification: EndgameClassification | null | undefined,
): StoneBreakdown | null => {
  if (classification === undefined || classification === null) return null;

  const finalState = snapshot.history.at(-1);
  if (!finalState) throw new Error('Finished game history must not be empty');

  const deadGroups = { black: 0, white: 0 };
  for (const group of classification) {
    if (group.status !== 'dead') continue;
    const firstPoint = group.points[0];
    if (!firstPoint) throw new Error('Endgame classification contains an empty group');

    const color = finalState.board[firstPoint];
    if (color !== 'black' && color !== 'white') {
      throw new Error(`Dead group does not point to a stone: ${firstPoint}`);
    }
    deadGroups[color] += 1;
  }

  return Object.freeze(deadGroups);
};

export const createGameResultModel = (
  snapshot: GameSessionSnapshot,
  boardSizeFallback?: number,
): GameResultViewModel | null => {
  const finalState = snapshot.history.at(-1);
  const score = snapshot.finalScore;
  if (!finalState || finalState.phase !== 'finished' || !score) return null;

  const boardSize = snapshot.boardSize ?? boardSizeFallback ?? null;
  if (boardSize !== null && (!Number.isInteger(boardSize) || boardSize <= 0)) {
    throw new Error(`Board size must be a positive integer, got ${String(boardSize)}`);
  }

  return Object.freeze({
    score: cloneFinalScore(score),
    statistics: Object.freeze({
      totalActions: finalState.moveNumber,
      passes: countPasses(snapshot),
      boardSize,
      ruleSet: snapshot.ruleSet,
      captures: Object.freeze({ ...score.captures }),
      deadStones: Object.freeze({ ...score.deadStones }),
      deadGroups: countDeadGroups(snapshot, snapshot.endgameClassification),
    }),
  });
};
