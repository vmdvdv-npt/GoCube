import type { PointId } from '../core/topology/Topology';
import type { SharedGameActionResult } from './GameSessionControllerFacade';

/**
 * Explicit presentation-facing gameplay boundary. The authoritative controller
 * remains the source of snapshots, availability and endgame APIs; this adapter
 * owns user move/pass dispatch plus history dispatch/availability when a game
 * mode needs application-level history semantics.
 */
export interface GameInteractionBoundary {
  placeStone(point: PointId): Promise<SharedGameActionResult>;
  pass(): Promise<SharedGameActionResult>;
  undo(): Promise<SharedGameActionResult>;
  redo(): Promise<SharedGameActionResult>;
  canUndo(): boolean;
  canRedo(): boolean;
}
