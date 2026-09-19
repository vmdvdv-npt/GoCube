import type { PointId } from '../core/topology/Topology';
import type { GameViewModel } from '../presentation/PresentationModel';

/**
 * Cube 3D presentation boundary.
 *
 * Presentation data enters the renderer; hit-testing may only return the
 * renderer-neutral logical PointId. Domain/application authority stays outside
 * this module.
 */
export interface Renderer3D {
  render(viewModel: GameViewModel): void;
  pointFromClientPosition(x: number, y: number): PointId | null;
}
