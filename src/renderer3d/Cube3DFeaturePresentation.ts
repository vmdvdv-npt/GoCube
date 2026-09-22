import type { PointId } from '../core/topology/Topology';
import type {
  EndgamePresentationModel,
  EndgamePresentationStatus,
} from '../presentation/EndgamePresentation';
import type { EndgameTerritoryOwner } from '../presentation/EndgameTerritoryPresentation';
import type { GameViewModel, GameViewPoint } from '../presentation/PresentationModel';

export interface Cube3DPointPresentation {
  readonly pointId: PointId;
  readonly occupancy: GameViewPoint['occupancy'];
  readonly moveNumber: number | null;
  readonly lastMove: boolean;
  readonly territoryOwner: EndgameTerritoryOwner | null;
  readonly reviewStatus: EndgamePresentationStatus | null;
  readonly reviewSelected: boolean;
  readonly reviewHovered: boolean;
  readonly sekiRegion: boolean;
}

export interface Cube3DFeaturePresentation {
  readonly points: readonly Cube3DPointPresentation[];
}

export interface CreateCube3DFeaturePresentationOptions {
  readonly viewModel: GameViewModel;
  readonly endgamePresentation?: EndgamePresentationModel | null;
  readonly showMoveNumbers: boolean;
}

const finalTerritoryOwners = (viewModel: GameViewModel): ReadonlyMap<PointId, EndgameTerritoryOwner> => {
  const territory = new Map<PointId, EndgameTerritoryOwner>();
  if (viewModel.phase !== 'finished' || !viewModel.finalScore) return territory;

  for (const pointId of viewModel.finalScore.territoryPoints.black) territory.set(pointId, 'black');
  for (const pointId of viewModel.finalScore.territoryPoints.white) territory.set(pointId, 'white');
  return territory;
};

/**
 * Renderer-facing Cube 3D feature projection.
 *
 * It consumes the same presentation/endgame projections as Cube 2D and never
 * derives rules, scoring or group classification inside Three.js.
 */
export const createCube3DFeaturePresentation = ({
  viewModel,
  endgamePresentation = null,
  showMoveNumbers,
}: CreateCube3DFeaturePresentationOptions): Cube3DFeaturePresentation => {
  const territory =
    viewModel.phase === 'finished'
      ? finalTerritoryOwners(viewModel)
      : endgamePresentation?.territory ?? new Map<PointId, EndgameTerritoryOwner>();

  const reviewByPoint = new Map<
    PointId,
    Readonly<{
      status: EndgamePresentationStatus;
      selected: boolean;
      hovered: boolean;
    }>
  >();
  for (const group of endgamePresentation?.groups ?? []) {
    for (const pointId of group.points) {
      reviewByPoint.set(
        pointId,
        Object.freeze({
          status: group.status,
          selected: group.selected,
          hovered: group.hovered,
        }),
      );
    }
  }

  const sekiPoints = new Set<PointId>(
    (endgamePresentation?.sekiRegions ?? []).flatMap((region) => region.points),
  );

  return Object.freeze({
    points: Object.freeze(
      viewModel.points.map((point) => {
        const review = reviewByPoint.get(point.logicalPointId);
        const lastMove =
          point.occupancy !== 'empty' && viewModel.lastMovePointId === point.logicalPointId;
        return Object.freeze({
          pointId: point.logicalPointId,
          occupancy: point.occupancy,
          moveNumber:
            showMoveNumbers && point.occupancy !== 'empty' && !lastMove
              ? point.moveNumber ?? null
              : null,
          lastMove,
          territoryOwner: territory.get(point.logicalPointId) ?? null,
          reviewStatus: review?.status ?? null,
          reviewSelected: review?.selected ?? false,
          reviewHovered: review?.hovered ?? false,
          sekiRegion: sekiPoints.has(point.logicalPointId),
        });
      }),
    ),
  });
};
