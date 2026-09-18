import type { PointId } from '../core/topology/Topology';
import type { SharedGameActionResult } from './GameSessionControllerFacade';

export interface GameInteractionBoundary {
  placeStone(point: PointId): Promise<SharedGameActionResult>;
  pass(): Promise<SharedGameActionResult>;
}
