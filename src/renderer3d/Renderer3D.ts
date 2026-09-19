import type { CubeSize } from '../core/topology/CubeTopology';
import type { PointId } from '../core/topology/Topology';
import type { GamePointHoverStatus } from '../presentation/GamePointHoverStatus';
import type { GameViewModel } from '../presentation/PresentationModel';
import type { Cube3DViewState } from '../presentation/cube/Cube3DViewState';

export interface Renderer3DFrame {
  readonly size: CubeSize;
  readonly viewModel: GameViewModel;
  readonly viewState: Cube3DViewState;
  readonly hoveredPointId: PointId | null;
  readonly hoverStatus: GamePointHoverStatus;
  readonly inputDisabled: boolean;
}

/**
 * Cube 3D presentation boundary.
 *
 * Presentation data enters the renderer; hit-testing may only return the
 * renderer-neutral logical PointId. Domain/application authority stays outside
 * this module.
 */
export interface Renderer3D {
  render(frame: Renderer3DFrame): void;
  pointFromClientPosition(x: number, y: number): PointId | null;
}
