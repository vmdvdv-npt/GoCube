import type { GroupStatus } from '../core/endgame/EndgameClassifier';
import type { StoneColor } from '../core/game/types';
import type { PointId, Topology } from '../core/topology/Topology';
import {
  type EndgameGroupEdge,
  type EndgameGroupPresentation,
  type EndgameGroupRenderState,
  type EndgamePresentationStatus,
} from './EndgameGroupPresentation';
import { buildEndgameSekiRegions } from './EndgameSekiPresentation';
import type { EndgameTerritoryOwner } from './EndgameTerritoryPresentation';

export interface EndgamePresentationStyle {
  readonly contourVisible: boolean;
  readonly contourColor: string | null;
  readonly maskColor: string | null;
  readonly maskOpacity: number;
}

export const ENDGAME_PRESENTATION_STYLES: Readonly<
  Record<EndgamePresentationStatus, EndgamePresentationStyle>
> = Object.freeze({
  alive: Object.freeze({
    contourVisible: false,
    contourColor: null,
    maskColor: null,
    maskOpacity: 0,
  }),
  dead: Object.freeze({
    contourVisible: true,
    contourColor: '#e52b2b',
    maskColor: null,
    maskOpacity: 0,
  }),
  seki: Object.freeze({
    contourVisible: true,
    contourColor: '#80878f',
    maskColor: '#80878f',
    maskOpacity: 0.6,
  }),
  unresolved: Object.freeze({
    contourVisible: true,
    contourColor: '#f8cf4d',
    maskColor: null,
    maskOpacity: 0,
  }),
});

export interface EndgamePresentationGroup extends EndgameGroupRenderState {
  readonly selected: boolean;
  readonly hovered: boolean;
}

export interface EndgamePresentationShape {
  readonly points: readonly PointId[];
  readonly edges: readonly EndgameGroupEdge[];
}

export interface EndgamePresentationContour extends EndgamePresentationShape {
  readonly status: Exclude<EndgamePresentationStatus, 'alive' | 'seki'>;
  readonly color: StoneColor;
  readonly groupIds: readonly string[];
  readonly contourColor: string;
  readonly selected: boolean;
  readonly hovered: boolean;
}

export interface EndgamePresentationSekiRegion extends EndgamePresentationShape {
  readonly id: string;
  readonly status: 'seki';
  readonly groupIds: readonly string[];
  readonly contourColor: string;
  readonly maskColor: string;
  readonly maskOpacity: number;
  readonly selected: boolean;
  readonly hovered: boolean;
}

export interface EndgamePresentationModel {
  readonly groups: readonly EndgamePresentationGroup[];
  readonly contours: readonly EndgamePresentationContour[];
  readonly sekiRegions: readonly EndgamePresentationSekiRegion[];
  readonly territory: ReadonlyMap<PointId, EndgameTerritoryOwner>;
}

export interface BuildEndgamePresentationOptions {
  readonly groups: readonly EndgameGroupPresentation[];
  readonly decisions: Readonly<Partial<Record<string, GroupStatus>>>;
  readonly topology: Topology;
  readonly territory?: ReadonlyMap<PointId, EndgameTerritoryOwner>;
  readonly selectedGroupId?: string | null;
  readonly hoveredGroupId?: string | null;
}

export const normalizeEndgamePresentationStatus = (
  decision: GroupStatus | undefined,
): EndgamePresentationStatus => decision ?? 'unresolved';

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const mergedContourShape = (
  groups: readonly EndgamePresentationGroup[],
  topology: Topology,
): EndgamePresentationShape => {
  const points = [...new Set(groups.flatMap((group) => group.points))];
  const pointSet = new Set(points);
  const edges = new Map<string, EndgameGroupEdge>();

  for (const from of points) {
    for (const to of topology.neighbors(from)) {
      if (!pointSet.has(to) || from === to) continue;
      const first = compareText(from, to) <= 0 ? from : to;
      const second = first === from ? to : from;
      const key = `${first}\u0000${second}`;
      if (!edges.has(key)) edges.set(key, Object.freeze({ from: first, to: second }));
    }
  }

  return Object.freeze({
    points: Object.freeze([...points].sort(compareText)),
    edges: Object.freeze([...edges.values()].sort((left, right) =>
      compareText(left.from, right.from) || compareText(left.to, right.to),
    )),
  });
};

const buildContours = (
  groups: readonly EndgamePresentationGroup[],
  topology: Topology,
): readonly EndgamePresentationContour[] => {
  const contours: EndgamePresentationContour[] = [];

  for (const status of ['dead', 'unresolved'] as const) {
    for (const color of ['black', 'white'] as const) {
      const matching = groups.filter(
        (group) => group.status === status && group.color === color,
      );
      if (matching.length === 0) continue;
      const style = ENDGAME_PRESENTATION_STYLES[status];
      if (!style.contourVisible || !style.contourColor) continue;
      const shape = mergedContourShape(matching, topology);
      contours.push(Object.freeze({
        ...shape,
        status,
        color,
        groupIds: Object.freeze(matching.map((group) => group.id)),
        contourColor: style.contourColor,
        selected: matching.some((group) => group.selected),
        hovered: matching.some((group) => group.hovered),
      }));
    }
  }

  return Object.freeze(contours);
};

export const buildEndgamePresentation = ({
  groups,
  decisions,
  topology,
  territory = new Map(),
  selectedGroupId = null,
  hoveredGroupId = null,
}: BuildEndgamePresentationOptions): EndgamePresentationModel => {
  const presentationGroups: readonly EndgamePresentationGroup[] = Object.freeze(
    groups.map((group) => Object.freeze({
      ...group,
      status: normalizeEndgamePresentationStatus(decisions[group.id]),
      selected: selectedGroupId === group.id,
      hovered: hoveredGroupId === group.id,
    })),
  );

  const rawSekiRegions = buildEndgameSekiRegions(presentationGroups, topology);
  const sekiStyle = ENDGAME_PRESENTATION_STYLES.seki;
  if (!sekiStyle.contourColor || !sekiStyle.maskColor) {
    throw new Error('Seki presentation style requires contour and mask colors');
  }
  const sekiRegions: readonly EndgamePresentationSekiRegion[] = Object.freeze(
    rawSekiRegions.map((region) => Object.freeze({
      ...region,
      status: 'seki' as const,
      contourColor: sekiStyle.contourColor!,
      maskColor: sekiStyle.maskColor!,
      maskOpacity: sekiStyle.maskOpacity,
      selected: region.groupIds.some((groupId) => groupId === selectedGroupId),
      hovered: region.groupIds.some((groupId) => groupId === hoveredGroupId),
    })),
  );
  const sekiGroupIds = new Set(sekiRegions.flatMap((region) => region.groupIds));
  const regularGroups = presentationGroups.filter((group) => !sekiGroupIds.has(group.id));

  return Object.freeze({
    groups: presentationGroups,
    contours: buildContours(regularGroups, topology),
    sekiRegions,
    territory: new Map(territory),
  });
};
