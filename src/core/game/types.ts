import type { PointId } from '../topology/Topology';

export type StoneColor = 'black' | 'white';
export type PointOccupancy = StoneColor | 'empty';
export type RuleSet = 'chinese' | 'japanese';
export type GamePhase = 'playing' | 'endgame' | 'finished';

export type BoardOccupancy = Readonly<Record<PointId, PointOccupancy>>;

export interface GameState {
  readonly board: BoardOccupancy;
  readonly currentPlayer: StoneColor;
  /** Counts every accepted game action, including Pass. */
  readonly moveNumber: number;
  readonly consecutivePasses: number;
  readonly phase: GamePhase;
}
