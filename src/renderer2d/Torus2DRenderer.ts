export * from './Torus2DRendererBase';

import type { PointId } from '../core/topology/Topology';
import {
  ENDGAME_TERRITORY_MARKER_RADIUS_FRACTION,
  ENDGAME_TERRITORY_MARKER_STYLES,
  type EndgamePresentationModel,
  type EndgamePresentationShape,
} from '../presentation/EndgamePresentation';
import type { GameViewModel } from '../presentation/PresentationModel';
import {
  buildEndgameContourPath,
  endgameContourStrokeWidth,
} from './EndgameContourGeometry';
import {
  Torus2DRenderer as BaseTorus2DRenderer,
  buildTorus2DScene,
  type Torus2DScene,
  type Torus2DScenePoint,
  type Torus2DSize,
  type Torus2DViewState,
} from './Torus2DRendererBase';

const SVG_NS = 'http://www.w3.org/2000/svg';

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

const canonicalCellCoordinate = (value: number): number =>
  Object.is(value, -0) ? 0 : value;

export interface Torus2DEndgameContourCell {
  readonly column: number;
  readonly row: number;
}

/** Torus-only adapter: logical presentation shape -> current wrapped scene cells. */
export const torus2DEndgameContourCells = (
  scene: Torus2DScene,
  shape: EndgamePresentationShape,
): readonly Torus2DEndgameContourCell[] => {
  const pointIds = new Set(shape.points);
  return Object.freeze(
    scene.visualPoints.flatMap((point) =>
      pointIds.has(point.logicalPointId)
        ? [Object.freeze({
            column: canonicalCellCoordinate(point.visualColumn),
            row: canonicalCellCoordinate(point.visualRow),
          })]
        : [],
    ),
  );
};

const contourPathForScene = (
  scene: Torus2DScene,
  shape: EndgamePresentationShape,
): string => {
  const cells = torus2DEndgameContourCells(scene, shape);
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
  private presentationState: EndgamePresentationModel | null = null;

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

  setEndgamePresentation(presentation: EndgamePresentationModel | null): void {
    this.presentationState = presentation;
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
    this.renderEndgameOverlay();
  }

  protected override renderPanPresentation(scene: Torus2DScene, target: SVGGElement): void {
    this.appendEndgamePresentation(scene, target);
  }

  private territoryForRender(): ReadonlyMap<PointId, 'black' | 'white'> | null {
    if (this.presentationState) return this.presentationState.territory;
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

  private appendEndgamePresentation(scene: Torus2DScene, target: SVGElement): void {
    const presentation = this.presentationState;
    const territory = this.territoryForRender();
    if ((!presentation || presentation.groups.length === 0) && (!territory || territory.size === 0)) {
      return;
    }

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
      const dotRadius = Math.max(
        4,
        scene.spacing * ENDGAME_TERRITORY_MARKER_RADIUS_FRACTION,
      );
      for (const [pointId, owner] of territory) {
        const point = pointsById.get(pointId);
        if (!point) continue;
        const markerStyle = ENDGAME_TERRITORY_MARKER_STYLES[owner];
        const dot = document.createElementNS(SVG_NS, 'circle');
        setAttributes(dot, {
          cx: String(point.x),
          cy: String(point.y),
          r: String(dotRadius),
          fill: markerStyle.fill,
          stroke: markerStyle.stroke ?? 'none',
          'stroke-width': markerStyle.stroke ? '1' : '0',
          'data-logical-point-id': pointId,
          'data-territory-owner': owner,
          class: `torus-board__territory-dot torus-board__territory-dot--${owner}`,
        });
        territoryLayer.appendChild(dot);
      }
      root.appendChild(territoryLayer);
    }

    if (presentation) {
      const groupsLayer = document.createElementNS(SVG_NS, 'g');
      groupsLayer.setAttribute('class', 'torus-board__endgame-contours');
      const contourWidth = endgameContourStrokeWidth(scene.spacing, scene.stoneRadius);

      for (const contour of presentation.contours) {
        const path = contourPathForScene(scene, contour);
        if (!path) continue;

        const groupLayer = document.createElementNS(SVG_NS, 'g');
        setAttributes(groupLayer, {
          class: `torus-board__group-contour torus-board__group-contour--${contour.status}${contour.selected ? ' is-selected' : ''}${contour.hovered ? ' is-hovered' : ''}`,
          'data-endgame-group-ids': contour.groupIds.join(' '),
          'data-endgame-status': contour.status,
          'data-endgame-color': contour.color,
        });
        this.appendContourPath(groupLayer, path, contour.contourColor, contourWidth);
        groupsLayer.appendChild(groupLayer);
      }

      for (const region of presentation.sekiRegions) {
        const path = contourPathForScene(scene, region);
        if (!path) continue;

        const regionLayer = document.createElementNS(SVG_NS, 'g');
        setAttributes(regionLayer, {
          class: `torus-board__group-contour torus-board__group-contour--seki${region.selected ? ' is-selected' : ''}${region.hovered ? ' is-hovered' : ''}`,
          'data-endgame-seki-region-id': region.id,
          'data-endgame-group-ids': region.groupIds.join(' '),
          'data-endgame-status': 'seki',
        });

        const sekiMask = document.createElementNS(SVG_NS, 'path');
        setAttributes(sekiMask, {
          class: 'torus-board__seki-mask',
          d: path,
          fill: region.maskColor,
          'fill-rule': 'evenodd',
          opacity: String(region.maskOpacity),
        });
        regionLayer.appendChild(sekiMask);

        this.appendContourPath(regionLayer, path, region.contourColor, contourWidth);
        groupsLayer.appendChild(regionLayer);
      }

      root.appendChild(groupsLayer);
    }

    target.appendChild(root);
  }

  private renderEndgameOverlay(): void {
    const scene = this.latestScene;
    if (!scene) return;
    if (typeof this.navigationRoot.querySelector !== 'function') return;
    if (this.navigationRoot.getAttribute('data-pan-animating') === 'true') return;

    this.navigationRoot.querySelector('.torus-board__endgame-overlay')?.remove();
    this.appendEndgamePresentation(scene, this.navigationRoot);
  }
}
