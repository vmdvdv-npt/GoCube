import type { PointId } from '../topology/Topology';

export type StoneColor = 'black' | 'white';
export type PointOccupancy = StoneColor | 'empty';
export type RuleSet = 'chinese' | 'japanese';

export type BoardOccupancy = Readonly<Record<PointId, PointOccupancy>>;

export interface GameState {
  readonly board: BoardOccupancy;
}
