export * from './Torus2DRendererBase';

import type { PointId } from '../core/topology/Topology';
import { TorusTopology } from '../core/topology/TorusTopology';
import { buildEndgameSekiRegions } from '../presentation/EndgameSekiPresentation';
import type { GameViewModel } from '../presentation/PresentationModel';
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

const contourColor = (status: string | null): string => {
  if (status === 'dead') return '#e52b2b';
  if (status === 'seki') return '#80878f';
  if (status === 'alive') return 'transparent';
  return '#a8e85e';
};

const contourPaintPriority = (status: string | null): number => {
  if (status === 'dead') return 0;
  if (status === 'alive') return 1;
  return 2;
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

  private appendGroupShape(
    target: SVGGElement,
    scene: Torus2DScene,
    pointsById: ReadonlyMap<PointId, Torus2DScenePoint>,
    group: Torus2DEndgameShape,
    radius: number,
  ): void {
    const document = this.navigationRoot.ownerDocument;
    const visibleEdges: Array<
      Readonly<{
        from: Torus2DScenePoint;
        to: Torus2DScenePoint;
      }>
    > = [];

    for (const edge of group.edges) {
      const from = pointsById.get(edge.from);
      const to = pointsById.get(edge.to);
      if (!from || !to) continue;
      const distance = Math.hypot(to.x - from.x, to.y - from.y);
      if (distance > scene.spacing * 1.5) continue;
      visibleEdges.push({ from, to });
    }

    for (const edge of visibleEdges) {
      const line = document.createElementNS(SVG_NS, 'line');
      setAttributes(line, {
        x1: String(edge.from.x), y1: String(edge.from.y), x2: String(edge.to.x), y2: String(edge.to.y),
        stroke: 'currentColor', 'stroke-width': String(radius * 2), 'stroke-linecap': 'round',
      });
      target.appendChild(line);
    }

    // A round-ended capsule for every real edge plus one circle at every stone is
    // already the exact smooth union we need. Extra corner patches create local
    // bulges and duplicate inner bands when the outline is produced by subtraction.
    for (const pointId of group.points) {
      const point = pointsById.get(pointId);
      if (!point) continue;
      const circle = document.createElementNS(SVG_NS, 'circle');
      setAttributes(circle, {
        cx: String(point.x), cy: String(point.y), r: String(radius), fill: 'currentColor',
      });
      target.appendChild(circle);
    }
  }

  private appendOutlineMask(
    defs: SVGDefsElement,
    maskId: string,
    scene: Torus2DScene,
    pointsById: ReadonlyMap<PointId, Torus2DScenePoint>,
    group: Torus2DEndgameShape,
    innerRadius: number,
  ): void {
    const document = this.navigationRoot.ownerDocument;
    const mask = document.createElementNS(SVG_NS, 'mask');
    setAttributes(mask, {
      id: maskId,
      x: '0',
      y: '0',
      width: String(scene.viewBoxSize),
      height: String(scene.viewBoxSize),
      maskUnits: 'userSpaceOnUse',
    });

    const background = document.createElementNS(SVG_NS, 'rect');
    setAttributes(background, {
      x: '0',
      y: '0',
      width: String(scene.viewBoxSize),
      height: String(scene.viewBoxSize),
      fill: '#ffffff',
    });

    const cutout = document.createElementNS(SVG_NS, 'g');
    cutout.setAttribute('style', 'color:#000000');
    this.appendGroupShape(cutout, scene, pointsById, group, innerRadius);

    mask.append(background, cutout);
    defs.appendChild(mask);
  }

  private appendOutlineShape(
    target: SVGGElement,
    scene: Torus2DScene,
    pointsById: ReadonlyMap<PointId, Torus2DScenePoint>,
    group: Torus2DEndgameShape,
    innerRadius: number,
    outlineWidth: number,
    color: string,
    maskId: string,
  ): void {
    const document = this.navigationRoot.ownerDocument;
    const outline = document.createElementNS(SVG_NS, 'g');
    setAttributes(outline, {
      class: 'torus-board__group-contour-source',
      style: `color:${color}`,
      mask: `url(#${maskId})`,
    });
    this.appendGroupShape(
      outline,
      scene,
      pointsById,
      group,
      innerRadius + outlineWidth,
    );
    target.appendChild(outline);
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
          cx: String(point.x), cy: String(point.y), r: String(dotRadius),
          fill: owner === 'black' ? '#111111' : '#ffffff',
          stroke: owner === 'white' ? 'rgb(40 40 40 / 36%)' : 'none',
          'stroke-width': owner === 'white' ? '1' : '0',
          'data-logical-point-id': pointId, 'data-territory-owner': owner,
          class: `torus-board__territory-dot torus-board__territory-dot--${owner}`,
        });
        territoryLayer.appendChild(dot);
      }
      root.appendChild(territoryLayer);
    }

    if (overlay) {
      const defs = document.createElementNS(SVG_NS, 'defs');
      const groupsLayer = document.createElementNS(SVG_NS, 'g');
      groupsLayer.setAttribute('class', 'torus-board__endgame-contours');
      const shapeRadius = scene.stoneRadius;
      const outlineWidth = 3.7;
      const sekiRegions = buildEndgameSekiRegions(overlay.groups, new TorusTopology(scene.size));
      const sekiGroupIds = new Set(sekiRegions.flatMap((region) => region.groupIds));
      const regularGroups = overlay.groups
        .map((group, index) => ({
          group,
          index,
          status: group.status === 'unknown' ? null : group.status,
        }))
        .filter(({ group }) => !sekiGroupIds.has(group.id))
        .sort(
          (left, right) =>
            contourPaintPriority(left.status) - contourPaintPriority(right.status) ||
            left.index - right.index,
        );

      // Paint red first. Any coincident unresolved or seki contour is then one
      // visible non-red stroke, while the red contour naturally continues as a branch.
      for (const { group, index, status } of regularGroups) {
        const color = contourColor(status);
        const maskId = `torus-endgame-outline-mask-${index}`;

        this.appendOutlineMask(defs, maskId, scene, pointsById, group, shapeRadius);

        const groupLayer = document.createElementNS(SVG_NS, 'g');
        setAttributes(groupLayer, {
          class: `torus-board__group-contour torus-board__group-contour--${status ?? 'unresolved'}`,
          'data-endgame-group-id': group.id,
          'data-endgame-status': status ?? 'unresolved',
        });

        this.appendOutlineShape(
          groupLayer,
          scene,
          pointsById,
          group,
          shapeRadius,
          outlineWidth,
          color,
          maskId,
        );
        groupsLayer.appendChild(groupLayer);
      }

      sekiRegions.forEach((region, index) => {
        const maskId = `torus-endgame-seki-outline-mask-${index}`;

        this.appendOutlineMask(defs, maskId, scene, pointsById, region, shapeRadius);

        const regionLayer = document.createElementNS(SVG_NS, 'g');
        setAttributes(regionLayer, {
          class: 'torus-board__group-contour torus-board__group-contour--seki',
          'data-endgame-seki-region-id': region.id,
          'data-endgame-group-ids': region.groupIds.join(' '),
          'data-endgame-status': 'seki',
        });

        const sekiMask = document.createElementNS(SVG_NS, 'g');
        setAttributes(sekiMask, {
          class: 'torus-board__seki-mask', style: 'color:#80878f', opacity: '0.6',
        });
        this.appendGroupShape(sekiMask, scene, pointsById, region, shapeRadius);
        regionLayer.appendChild(sekiMask);

        this.appendOutlineShape(
          regionLayer,
          scene,
          pointsById,
          region,
          shapeRadius,
          outlineWidth,
          '#80878f',
          maskId,
        );
        groupsLayer.appendChild(regionLayer);
      });

      root.append(defs, groupsLayer);
    }

    this.navigationRoot.appendChild(root);
  }
}
