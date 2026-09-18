import type { PointId } from '../core/topology/Topology';
import type { SharedGameActionResult } from './GameSessionControllerFacade';

/**
 * Explicit presentation-facing gameplay boundary. The authoritative controller
 * remains the source of snapshots, availability and endgame APIs; this adapter
 * only owns user move/pass dispatch and history availability.
 */
export interface GameInteractionBoundary {
  placeStone(point: PointId): Promise<SharedGameActionResult>;
  pass(): Promise<SharedGameActionResult>;
  canUndo(): boolean;
  canRedo(): boolean;
}
