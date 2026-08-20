import type { GameViewModel } from '../presentation/PresentationModel';
import type { PointId } from '../core/topology/Topology';

/** Renderer boundary: presentation data in, logical point identifiers out. */
export interface Renderer2D {
  render(viewModel: GameViewModel): void;
  pointFromClientPosition(x: number, y: number): PointId | null;
}
