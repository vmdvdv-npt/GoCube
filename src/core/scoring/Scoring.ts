import type { EndgameClassification } from '../endgame/EndgameClassifier';
import { resolveTerritory } from '../endgame/TerritoryResolver';
import type { CaptureCounts, GameState, RuleSet, StoneColor } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';

export type ScoreWinner = StoneColor | 'draw';

export interface TerritoryBreakdown {
  readonly black: number;
  readonly white: number;
  /** Empty points that are not owned by either color for non-seki reasons. */
  readonly neutral: number;
  /** Empty points kept neutral because their region touches a classified seki group. */
  readonly seki: number;
}

export interface StoneBreakdown {
  readonly black: number;
  readonly white: number;
}

export interface TerritoryPointBreakdown {
  readonly black: readonly PointId[];
  readonly white: readonly PointId[];
  readonly neutral: readonly PointId[];
  readonly seki: readonly PointId[];
}

export interface FinalScore {
  readonly ruleSet: RuleSet;
  readonly black: number;
  readonly white: number;
  readonly komi: number;
  readonly territory: TerritoryBreakdown;
  /** Logical points behind the territory totals, reusable by future presentation code. */
  readonly territoryPoints: TerritoryPointBreakdown;
  readonly stonesOnBoard: StoneBreakdown;
  /** Captures made during normal play, credited to the capturing color. */
  readonly captures: CaptureCounts;
  /** Japanese prisoners: captures during play plus opponent dead stones. Null for area scoring. */
  readonly prisoners: CaptureCounts | null;
  /** Dead stones by their own color. */
  readonly deadStones: StoneBreakdown;
  readonly winner: ScoreWinner;
  readonly margin: number;
}

export interface ScoringStrategy {
  readonly ruleSet: RuleSet;
  score(
    state: GameState,
    classification: EndgameClassification,
    komi: number,
  ): FinalScore;
}

export interface ScoringPosition {
  readonly territory: TerritoryBreakdown;
  /** Logical points behind the territory totals, reusable by future presentation code. */
  readonly territoryPoints: TerritoryPointBreakdown;
  readonly stonesOnBoard: StoneBreakdown;
  readonly captures: CaptureCounts;
  readonly deadStones: StoneBreakdown;
}

const freezePair = <T extends { readonly black: number; readonly white: number }>(
  value: T,
): T => Object.freeze({ ...value }) as T;

const classificationStatuses = (
  classification: EndgameClassification,
): ReadonlyMap<PointId, 'alive' | 'dead' | 'seki'> => {
  const statuses = new Map<PointId, 'alive' | 'dead' | 'seki'>();
  for (const group of classification) {
    for (const point of group.points) statuses.set(point, group.status);
  }
  return statuses;
};

export const analyzeScoringPosition = (
  state: GameState,
  classification: EndgameClassification,
  topology: Topology,
): ScoringPosition => {
  // TerritoryResolver is the authoritative handoff for dead removal, region
  // connectivity, seki neutrality, and ordinary dame ownership.
  const resolution = resolveTerritory(state, classification, topology);
  const statuses = classificationStatuses(classification);
  const deadStones = { black: 0, white: 0 };
  const stonesOnBoard = { black: 0, white: 0 };

  for (const point of topology.points()) {
    const occupancy = state.board[point];
    if (occupancy !== 'black' && occupancy !== 'white' && occupancy !== 'empty') {
      throw new Error(`GameState board is missing or invalid at point: ${point}`);
    }

    if (statuses.get(point) === 'dead') {
      if (occupancy === 'empty') {
        throw new Error(`Dead classification points to an empty point: ${point}`);
      }
      deadStones[occupancy] += 1;
      continue;
    }

    if (occupancy === 'black' || occupancy === 'white') stonesOnBoard[occupancy] += 1;
  }

  const territory = {
    black: 0,
    white: 0,
    neutral: 0,
    seki: 0,
  };
  const territoryPoints = {
    black: [] as PointId[],
    white: [] as PointId[],
    neutral: [] as PointId[],
    seki: [] as PointId[],
  };

  for (const region of resolution.regions) {
    if (region.touchesSeki) {
      territory.seki += region.points.length;
      territoryPoints.seki.push(...region.points);
    } else if (region.owner === 'BLACK') {
      territory.black += region.points.length;
      territoryPoints.black.push(...region.points);
    } else if (region.owner === 'WHITE') {
      territory.white += region.points.length;
      territoryPoints.white.push(...region.points);
    } else {
      territory.neutral += region.points.length;
      territoryPoints.neutral.push(...region.points);
    }
  }

  return Object.freeze({
    territory: Object.freeze({ ...territory }),
    territoryPoints: Object.freeze({
      black: Object.freeze([...territoryPoints.black]),
      white: Object.freeze([...territoryPoints.white]),
      neutral: Object.freeze([...territoryPoints.neutral]),
      seki: Object.freeze([...territoryPoints.seki]),
    }),
    stonesOnBoard: freezePair(stonesOnBoard),
    captures: freezePair(state.captures),
    deadStones: freezePair(deadStones),
  });
};

export const finishScore = (
  ruleSet: RuleSet,
  black: number,
  white: number,
  komi: number,
  position: ScoringPosition,
  prisoners: CaptureCounts | null,
): FinalScore => {
  if (!Number.isFinite(komi)) throw new Error('Komi must be a finite number');

  const winner: ScoreWinner = black === white ? 'draw' : black > white ? 'black' : 'white';

  return Object.freeze({
    ruleSet,
    black,
    white,
    komi,
    territory: position.territory,
    territoryPoints: position.territoryPoints,
    stonesOnBoard: position.stonesOnBoard,
    captures: position.captures,
    prisoners: prisoners ? freezePair(prisoners) : null,
    deadStones: position.deadStones,
    winner,
    margin: Math.abs(black - white),
  });
};
