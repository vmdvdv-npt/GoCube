export * from './Torus2DRendererBase';

import type { PointId, Topology } from '../core/topology/Topology';
import { TorusTopology } from '../core/topology/TorusTopology';
import { buildEndgameSekiRegions } from '../presentation/EndgameSekiPresentation';
import type { GameViewModel } from '../presentation/PresentationModel';
import {
  buildEndgameContourPath,
  endgameContourStrokeWidth,
} from './EndgameContourGeometry';
import {
  Torus2DRenderer as BaseTorus2DRenderer,
  buildTorus2DEndgameSegments,
  buildTorus2DScene,
  endgameGroupFromTorusViewBoxPosition,
  type Torus2DEndgameOverlay,
  type Torus2DEndgameSegment,
  type Torus2DScene,
  type Torus2DScenePoint,
  type Torus2DSize,
  type Torus2DViewState,
} from './Torus2DRendererBase';

const SVG_NS = 'http://www.w3.org/2000/svg';
const EMPTY_ENDGAME_SEGMENTS: readonly Torus2DEndgameSegment[] = Object.freeze([]);

type Torus2DEndgameShape = Readonly<{
  points: readonly PointId[];
  edges: readonly Readonly<{ from: PointId; to: PointId }>[];
}>;
type Torus2DEndgameGroup = Torus2DEndgameOverlay['groups'][number];
type ContourStatus = 'dead' | 'seki' | 'unresolved';
type StoneColor = Torus2DEndgameGroup['color'];
type ContourBundle = Readonly<{
  status: ContourStatus;
  color: StoneColor;
  groupIds: readonly string[];
  shape: Torus2DEndgameShape;
}>;

const sameViewState = (
  left: Torus2DViewState | null,
  right: Torus2DViewState,
): boolean =>
  left?.offsetX === right.offsetX && left.offsetY === right.offsetY;

const setAttributes = (
  element: Element,
  attributes: Readonly<Record<string, string>>,
): void => {
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
};

const contourStatus = (status: string | null): ContourStatus | null => {
  if (status === 'alive') return null;
  if (status === 'dead') return 'dead';
  if (status === 'seki') return 'seki';
  return 'unresolved';
};

const contourColor = (status: ContourStatus): string => {
  if (status === 'dead') return '#e52b2b';
  if (status === 'seki') return '#80878f';
  return '#a8e85e';
};

const mergedContourShape = (
  groups: readonly Torus2DEndgameShape[],
  topology: Topology,
): Torus2DEndgameShape => {
  const points = [...new Set(groups.flatMap((group) => group.points))];
  const pointSet = new Set(points);
  const edges = new Map<string, Readonly<{ from: PointId; to: PointId }>>();

  for (const from of points) {
    for (const to of topology.neighbors(from)) {
      if (!pointSet.has(to) || from === to) continue;
      const first = from < to ? from : to;
      const second = from < to ? to : from;
      const key = `${first}\u0000${second}`;
      if (!edges.has(key)) edges.set(key, Object.freeze({ from: first, to: second }));
    }
  }

  return Object.freeze({
    points: Object.freeze(points),
    edges: Object.freeze([...edges.values()]),
  });
};

const contourBundles = (
  groups: readonly Torus2DEndgameGroup[],
  topology: Topology,
): readonly ContourBundle[] =>
  Object.freeze(
    (['dead', 'unresolved', 'seki'] as const).flatMap((status) =>
      (['black', 'white'] as const).flatMap((color) => {
        const matching = groups.filter(
          (group) =>
            contourStatus(group.status === 'unknown' ? null : group.status) === status &&
            group.color === color,
        );
        if (matching.length === 0) return [];
        return [
          Object.freeze({
            status,
            color,
            groupIds: Object.freeze(matching.map((group) => group.id)),
            shape: mergedContourShape(matching, topology),
          }),
        ];
      }),
    ),
  );

const contourPathForScene = (
  scene: Torus2DScene,
  shape: Torus2DEndgameShape,
): string => {
  const pointIds = new Set(shape.points);
  const cells = scene.visualPoints.flatMap((point) =>
    pointIds.has(point.logicalPointId)
      ? [{ column: point.visualColumn, row: point.visualRow }]
      : [],
  );
  if (cells.length === 0) return '';

  return buildEndgameContourPath(cells, {
    originX: scene.padding,
    originY: scene.padding,
    spacing: scene.spacing,
  });
};

export class Torus2DRenderer extends BaseTorus2DRenderer {
  private latestViewModel: GameViewModel | null = null;
  private latestScene: Torus2DScene | null = null;
  private renderedViewState: Torus2DViewState | null = null;
  private duplicateRegionsVisibleState = false;
  private renderedDuplicateRegionsVisible = false;
  private overlayState: Torus2DEndgameOverlay | null = null;
  private territoryState: ReadonlyMap<PointId, 'black' | 'white'> | null = null;
  private overlaySegments: readonly Torus2DEndgameSegment[] = EMPTY_ENDGAME_SEGMENTS;

  constructor(
    private readonly navigationRoot: SVGSVGElement,
    size: Torus2DSize,
  ) {
    super(navigationRoot, size);
    navigationRoot.setAttribute('data-navigation-busy', 'false');
    navigationRoot.setAttribute('data-navigation-queue-length', '0');
  }

  override setDuplicateRegionsVisible(visible: boolean): void {
    this.duplicateRegionsVisibleState = visible;
    super.setDuplicateRegionsVisible(visible);
  }

  override setEndgameOverlay(overlay: Torus2DEndgameOverlay | null): void {
    this.overlayState = overlay;
    super.setEndgameOverlay(overlay);
    this.refreshEndgameSegments();
    this.renderEndgameOverlay();
  }

  setEndgameTerritory(
    territory: ReadonlyMap<PointId, 'black' | 'white'> | null,
  ): void {
    this.territoryState = territory;
    this.renderEndgameOverlay();
  }

  override render(viewModel: GameViewModel): void {
    const currentViewState = this.viewState();
    const coreSceneIsCurrent =
      this.latestViewModel === viewModel &&
      sameViewState(this.renderedViewState, currentViewState) &&
      this.renderedDuplicateRegionsVisible === this.duplicateRegionsVisibleState;

    if (coreSceneIsCurrent) {
      this.renderEndgameOverlay();
      return;
    }

    super.render(viewModel);
    this.latestViewModel = viewModel;
    this.renderedViewState = this.viewState();
    this.renderedDuplicateRegionsVisible = this.duplicateRegionsVisibleState;
    this.latestScene = buildTorus2DScene(
      viewModel,
      this.size,
      this.renderedViewState,
      this.duplicateRegionsVisibleState,
    );
    this.refreshEndgameSegments();
    this.renderEndgameOverlay();
  }

  override endgameGroupFromClientPosition(x: number, y: number): string | null {
    const scene = this.latestScene;
    if (!scene) return super.endgameGroupFromClientPosition(x, y);

    const bounds = this.navigationRoot.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return null;

    return endgameGroupFromTorusViewBoxPosition(
      this.overlaySegments,
      ((x - bounds.left) / bounds.width) * scene.viewBoxSize,
      ((y - bounds.top) / bounds.height) * scene.viewBoxSize,
    );
  }

  private refreshEndgameSegments(): void {
    const scene = this.latestScene;
    const overlay = this.overlayState;
    this.overlaySegments =
      scene && overlay
        ? buildTorus2DEndgameSegments(scene, overlay)
        : EMPTY_ENDGAME_SEGMENTS;
  }

  private territoryForRender(): ReadonlyMap<PointId, 'black' | 'white'> | null {
    if (this.territoryState !== null) return this.territoryState;
    const viewModel = this.latestViewModel;
    if (viewModel?.phase !== 'finished' || !viewModel.finalScore) return null;

    const territory = new Map<PointId, 'black' | 'white'>();
    for (const pointId of viewModel.finalScore.territoryPoints.black) territory.set(pointId, 'black');
    for (const pointId of viewModel.finalScore.territoryPoints.white) territory.set(pointId, 'white');
    return territory;
  }

  private appendContourPath(
    target: SVGGElement,
    path: string,
    color: string,
    strokeWidth: number,
  ): void {
    const element = this.navigationRoot.ownerDocument.createElementNS(SVG_NS, 'path');
    setAttributes(element, {
      class: 'torus-board__group-contour-source',
      d: path,
      fill: 'none',
      stroke: color,
      'stroke-width': String(strokeWidth),
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    });
    target.appendChild(element);
  }

  private renderEndgameOverlay(): void {
    const scene = this.latestScene;
    if (!scene) return;
    if (typeof this.navigationRoot.querySelector !== 'function') return;
    if (
      typeof this.navigationRoot.getAttribute === 'function' &&
      this.navigationRoot.getAttribute('data-pan-animating') === 'true'
    ) {
      return;
    }

    this.navigationRoot.querySelector('.torus-board__endgame-lines')?.remove();
    this.navigationRoot.querySelector('.torus-board__endgame-overlay')?.remove();

    const overlay = this.overlayState;
    const territory = this.territoryForRender();
    if ((!overlay || overlay.groups.length === 0) && (!territory || territory.size === 0)) return;

    const document = this.navigationRoot.ownerDocument;
    const root = document.createElementNS(SVG_NS, 'g');
    root.setAttribute('class', 'torus-board__endgame-overlay');
    root.setAttribute('pointer-events', 'none');

    const pointsById = new Map<PointId, Torus2DScenePoint>(
      scene.points.map((point) => [point.logicalPointId, point]),
    );

    if (territory && territory.size > 0) {
      const territoryLayer = document.createElementNS(SVG_NS, 'g');
      territoryLayer.setAttribute('class', 'torus-board__endgame-territory');
      const dotRadius = Math.max(4, scene.spacing * 0.115);
      for (const [pointId, owner] of territory) {
        const point = pointsById.get(pointId);
        if (!point) continue;
        const dot = document.createElementNS(SVG_NS, 'circle');
        setAttributes(dot, {
          cx: String(point.x),
          cy: String(point.y),
          r: String(dotRadius),
          fill: owner === 'black' ? '#111111' : '#ffffff',
          stroke: owner === 'white' ? 'rgb(40 40 40 / 36%)' : 'none',
          'stroke-width': owner === 'white' ? '1' : '0',
          'data-logical-point-id': pointId,
          'data-territory-owner': owner,
          class: `torus-board__territory-dot torus-board__territory-dot--${owner}`,
        });
        territoryLayer.appendChild(dot);
      }
      root.appendChild(territoryLayer);
    }

    if (overlay) {
      const groupsLayer = document.createElementNS(SVG_NS, 'g');
      groupsLayer.setAttribute('class', 'torus-board__endgame-contours');
      const contourWidth = endgameContourStrokeWidth(scene.spacing, scene.stoneRadius);
      const topology = new TorusTopology(scene.size);
      const sekiRegions = buildEndgameSekiRegions(overlay.groups, topology);
      const sekiGroupIds = new Set(sekiRegions.flatMap((region) => region.groupIds));
      const regularBundles = contourBundles(
        overlay.groups.filter((group) => !sekiGroupIds.has(group.id)),
        topology,
      );

      for (const bundle of regularBundles) {
        const path = contourPathForScene(scene, bundle.shape);
        if (!path) continue;

        const groupLayer = document.createElementNS(SVG_NS, 'g');
        setAttributes(groupLayer, {
          class: `torus-board__group-contour torus-board__group-contour--${bundle.status}`,
          'data-endgame-group-ids': bundle.groupIds.join(' '),
          'data-endgame-status': bundle.status,
          'data-endgame-color': bundle.color,
        });

        this.appendContourPath(
          groupLayer,
          path,
          contourColor(bundle.status),
          contourWidth,
        );
        groupsLayer.appendChild(groupLayer);
      }

      for (const region of sekiRegions) {
        const path = contourPathForScene(scene, region);
        if (!path) continue;

        const regionLayer = document.createElementNS(SVG_NS, 'g');
        setAttributes(regionLayer, {
          class: 'torus-board__group-contour torus-board__group-contour--seki',
          'data-endgame-seki-region-id': region.id,
          'data-endgame-group-ids': region.groupIds.join(' '),
          'data-endgame-status': 'seki',
        });

        const sekiMask = document.createElementNS(SVG_NS, 'path');
        setAttributes(sekiMask, {
          class: 'torus-board__seki-mask',
          d: path,
          fill: '#80878f',
          'fill-rule': 'evenodd',
          opacity: '0.6',
        });
        regionLayer.appendChild(sekiMask);

        this.appendContourPath(regionLayer, path, '#80878f', contourWidth);
        groupsLayer.appendChild(regionLayer);
      }

      root.appendChild(groupsLayer);
    }

    this.navigationRoot.appendChild(root);
  }
}
