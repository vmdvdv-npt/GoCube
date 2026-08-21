import type { EndgameClassification, GroupStatus } from '../../core/endgame/EndgameClassifier';
import type { StoneColor } from '../../core/game/types';
import type { FinalScore } from '../../core/scoring/Scoring';
import type { PointId } from '../../core/topology/Topology';
import type { EndgameGroupPresentation } from '../EndgameGroupPresentation';

export interface CapturedStoneEffect {
  readonly id: string;
  readonly pointId: PointId;
  readonly color: StoneColor;
  readonly order: number;
}

export interface Cube2DPointVisualStatus {
  readonly pointId: PointId;
  readonly groupStatus: GroupStatus | null;
  readonly selected: boolean;
  readonly hovered: boolean;
}

export interface Cube2DVisualEffectsModel {
  readonly territory: ReadonlyMap<PointId, 'black' | 'white'>;
  readonly pointStatuses: ReadonlyMap<PointId, Cube2DPointVisualStatus>;
  readonly capturedStones: readonly CapturedStoneEffect[];
}

export interface Cube2DVisualEffectsInput {
  readonly finalScore: FinalScore | null;
  readonly finalClassification?: EndgameClassification | null;
  readonly endgameGroups?: readonly EndgameGroupPresentation[];
  readonly decisions?: Readonly<Partial<Record<string, GroupStatus>>>;
  readonly selectedGroupId?: string | null;
  readonly hoveredGroupId?: string | null;
  readonly capturedStones?: readonly CapturedStoneEffect[];
}

export const createCube2DVisualEffectsModel = (
  input: Cube2DVisualEffectsInput,
): Cube2DVisualEffectsModel => {
  const territory = new Map<PointId, 'black' | 'white'>();
  for (const pointId of input.finalScore?.territoryPoints.black ?? []) territory.set(pointId, 'black');
  for (const pointId of input.finalScore?.territoryPoints.white ?? []) territory.set(pointId, 'white');

  const pointStatuses = new Map<PointId, Cube2DPointVisualStatus>();
  const setGroup = (
    points: readonly PointId[],
    status: GroupStatus | null,
    selected: boolean,
    hovered: boolean,
  ) => {
    for (const pointId of points) {
      pointStatuses.set(
        pointId,
        Object.freeze({ pointId, groupStatus: status, selected, hovered }),
      );
    }
  };

  if (input.finalClassification) {
    for (const group of input.finalClassification) {
      setGroup(group.points, group.status, false, false);
    }
  } else {
    for (const group of input.endgameGroups ?? []) {
      setGroup(
        group.points,
        input.decisions?.[group.id] ?? null,
        input.selectedGroupId === group.id,
        input.hoveredGroupId === group.id,
      );
    }
  }

  return Object.freeze({
    territory,
    pointStatuses,
    capturedStones: Object.freeze([...(input.capturedStones ?? [])]),
  });
};
