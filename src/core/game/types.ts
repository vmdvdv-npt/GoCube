import type { PointId } from '../topology/Topology';

export type StoneColor = 'black' | 'white';
export type RuleSet = 'chinese' | 'japanese';

export interface Stone {
  point: PointId;
  color: StoneColor;
}

export interface GameState {
  readonly stones: ReadonlyMap<PointId, StoneColor>;
  readonly toMove: StoneColor;
  readonly consecutivePasses: number;
  readonly moveNumber: number;
}

export type GameCommand =
  | { type: 'play'; point: PointId }
  | { type: 'pass' }
  | { type: 'undo' };
