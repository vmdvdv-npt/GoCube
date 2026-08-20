import type { GameState } from '../core/game/types';
import type { PointId, Topology } from '../core/topology/Topology';

export interface Renderer2D {
  render(state: GameState, topology: Topology): void;
  pointFromClientPosition(x: number, y: number): PointId | null;
}
