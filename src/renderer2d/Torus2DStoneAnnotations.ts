import type { StoneColor } from '../core/game/types';
import type { PointId } from '../core/topology/Topology';
import type { GameViewModel } from '../presentation/PresentationModel';
import { applyTorus2DStoneArtwork } from './Torus2DStoneArtwork';

const SVG_NS = 'http://www.w3.org/2000/svg';
const ANNOTATION_CLASS = 'torus-board__stone-annotation';
const PLACEMENT_ANIMATION_CLASS = 'torus-board__stone--placing';
const FINAL_TERRITORY_CLASS = 'torus-board__final-territory';
const FINAL_TERRITORY_POINT_CLASS = 'torus-board__final-territory-point';
const DEAD_STONE_CLASS = 'torus-board__stone--dead';
export const TORUS_FINAL_TERRITORY_OPACITY = 0.2;
export const TORUS_DEAD_STONE_OPACITY = 0.38;
const previousViewModelBySvg = new WeakMap<SVGSVGElement, GameViewModel>();

type TerritoryOwner = 'black' | 'white';

interface TerritoryVisualPoint {
  readonly logicalPointId: PointId;
  readonly x: number;
  readonly y: number;
  readonly duplicate: boolean;
}

const contrastColor = (color: StoneColor): string =>
  color === 'black' ? '#ffffff' : '#111111';

const wrap = (value: number, size: number): number => ((value % size) + size) % size;

const pointMoveNumbers = (viewModel: GameViewModel): ReadonlyMap<PointId, number> =>
  new Map(
    viewModel.points.flatMap((point) =>
      point.occupancy !== 'empty' && typeof point.moveNumber === 'number'
        ? [[point.logicalPointId, point.moveNumber] as const]
        : [],
    ),
  );

const directStoneCircles = (stoneLayer: Element): readonly SVGCircleElement[] =>
  Array.from(stoneLayer.children).filter(
    (child): child is SVGCircleElement =>
      child instanceof SVGElement && child.classList.contains('torus-board__stone'),
  );

const finalTerritoryOwners = (viewModel: GameViewModel): ReadonlyMap<PointId, TerritoryOwner> => {
  const owners = new Map<PointId, TerritoryOwner>();
  if (viewModel.phase !== 'finished' || !viewModel.finalScore) return owners;

  for (const point of viewModel.finalScore.territoryPoints.black) owners.set(point, 'black');
  for (const point of viewModel.finalScore.territoryPoints.white) owners.set(point, 'white');
  return owners;
};

/**
 * Scoring temporarily removes classified dead stones before building territory regions.
 * Therefore an occupied final-board point that appears in any territory-point bucket is
 * precisely a stone that was removed for scoring and must be visually muted.
 */
export const finalDeadStonePointIds = (viewModel: GameViewModel): ReadonlySet<PointId> => {
  if (viewModel.phase !== 'finished' || !viewModel.finalScore) return new Set<PointId>();

  const scoringEmptyPoints = new Set<PointId>([
    ...viewModel.finalScore.territoryPoints.black,
    ...viewModel.finalScore.territoryPoints.white,
    ...viewModel.finalScore.territoryPoints.neutral,
    ...viewModel.finalScore.territoryPoints.seki,
  ]);

  return new Set(
    viewModel.points.flatMap((point) =>
      point.occupancy !== 'empty' && scoringEmptyPoints.has(point.logicalPointId)
        ? [point.logicalPointId]
        : [],
    ),
  );
};

const minimumSpacing = (values: readonly number[]): number | null => {
  const unique = [...new Set(values.filter(Number.isFinite))].sort((left, right) => left - right);
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 1; index < unique.length; index += 1) {
    const delta = unique[index]! - unique[index - 1]!;
    if (delta > 0 && delta < minimum) minimum = delta;
  }
  return Number.isFinite(minimum) ? minimum : null;
};

const normalTerritoryVisualPoints = (
  svg: SVGSVGElement,
): Readonly<{ points: readonly TerritoryVisualPoint[]; spacing: number } | null> => {
  const targets = Array.from(
    svg.querySelectorAll<SVGCircleElement>('.torus-board__hit-target'),
  );
  if (targets.length === 0) return null;

  const points = targets.flatMap((target) => {
    const logicalPointId = target.getAttribute('data-logical-point-id');
    const x = Number(target.getAttribute('cx'));
    const y = Number(target.getAttribute('cy'));
    if (!logicalPointId || !Number.isFinite(x) || !Number.isFinite(y)) return [];
    return [
      Object.freeze({
        logicalPointId,
        x,
        y,
        duplicate: target.getAttribute('data-copy-role') === 'duplicate',
      }),
    ];
  });

  const spacing = minimumSpacing(points.map((point) => point.x))
    ?? minimumSpacing(points.map((point) => point.y));
  return spacing ? Object.freeze({ points: Object.freeze(points), spacing }) : null;
};

const panTerritoryVisualPoints = (
  svg: SVGSVGElement,
  grid: Element,
  viewModel: GameViewModel,
): Readonly<{ points: readonly TerritoryVisualPoint[]; spacing: number } | null> => {
  const lines = Array.from(grid.children).filter(
    (child): child is SVGLineElement => child.tagName.toLowerCase() === 'line',
  );
  const xCoordinates = [...new Set(
    lines.flatMap((line) => {
      const x1 = Number(line.getAttribute('x1'));
      const x2 = Number(line.getAttribute('x2'));
      return Number.isFinite(x1) && x1 === x2 ? [x1] : [];
    }),
  )].sort((left, right) => left - right);
  const yCoordinates = [...new Set(
    lines.flatMap((line) => {
      const y1 = Number(line.getAttribute('y1'));
      const y2 = Number(line.getAttribute('y2'));
      return Number.isFinite(y1) && y1 === y2 ? [y1] : [];
    }),
  )].sort((left, right) => left - right);

  const size = Math.sqrt(viewModel.points.length);
  if (!Number.isInteger(size) || xCoordinates.length === 0 || yCoordinates.length === 0) {
    return null;
  }

  const spacing = minimumSpacing(xCoordinates) ?? minimumSpacing(yCoordinates);
  if (!spacing) return null;

  const marginX = (xCoordinates.length - size) / 2;
  const marginY = (yCoordinates.length - size) / 2;
  if (!Number.isInteger(marginX) || !Number.isInteger(marginY)) return null;

  const currentOffsetX = Number(svg.getAttribute('data-view-offset-x')) || 0;
  const currentOffsetY = Number(svg.getAttribute('data-view-offset-y')) || 0;
  const direction = svg.getAttribute('data-pan-direction');
  const offsetDelta =
    direction === 'left'
      ? { x: -1, y: 0 }
      : direction === 'right'
        ? { x: 1, y: 0 }
        : direction === 'up'
          ? { x: 0, y: -1 }
          : direction === 'down'
            ? { x: 0, y: 1 }
            : { x: 0, y: 0 };
  const nextOffsetX = wrap(currentOffsetX + offsetDelta.x, size);
  const nextOffsetY = wrap(currentOffsetY + offsetDelta.y, size);
  const points: TerritoryVisualPoint[] = [];

  for (let rowIndex = 0; rowIndex < yCoordinates.length; rowIndex += 1) {
    const visualRow = rowIndex - marginY;
    for (let columnIndex = 0; columnIndex < xCoordinates.length; columnIndex += 1) {
      const visualColumn = columnIndex - marginX;
      points.push(
        Object.freeze({
          logicalPointId: `${wrap(visualColumn + nextOffsetX, size)},${wrap(visualRow + nextOffsetY, size)}`,
          x: xCoordinates[columnIndex]!,
          y: yCoordinates[rowIndex]!,
          duplicate:
            visualColumn < 0 ||
            visualColumn >= size ||
            visualRow < 0 ||
            visualRow >= size,
        }),
      );
    }
  }

  return Object.freeze({ points: Object.freeze(points), spacing });
};

const removeTerritoryLayer = (grid: Element): void => {
  for (const child of Array.from(grid.children)) {
    if (child.classList.contains(FINAL_TERRITORY_CLASS)) child.remove();
  }
};

const renderFinalTerritory = (
  svg: SVGSVGElement,
  viewModel: GameViewModel,
): void => {
  const owners = finalTerritoryOwners(viewModel);
  const grids = Array.from(svg.querySelectorAll('.torus-board__grid'));
  for (const grid of grids) removeTerritoryLayer(grid);

  if (owners.size === 0 || grids.length === 0) {
    svg.setAttribute('data-final-territory-visible', 'false');
    return;
  }

  let rendered = 0;
  for (const grid of grids) {
    const inPanTransition = Boolean(grid.closest('.torus-board__pan-content--grid'));
    const visual = inPanTransition
      ? panTerritoryVisualPoints(svg, grid, viewModel)
      : normalTerritoryVisualPoints(svg);
    if (!visual) continue;

    const layer = svg.ownerDocument.createElementNS(SVG_NS, 'g');
    layer.setAttribute('class', FINAL_TERRITORY_CLASS);
    layer.setAttribute('pointer-events', 'none');

    for (const point of visual.points) {
      const owner = owners.get(point.logicalPointId);
      if (!owner) continue;

      const rect = svg.ownerDocument.createElementNS(SVG_NS, 'rect');
      const overlap = 0.5;
      rect.setAttribute('x', String(point.x - visual.spacing / 2 - overlap / 2));
      rect.setAttribute('y', String(point.y - visual.spacing / 2 - overlap / 2));
      rect.setAttribute('width', String(visual.spacing + overlap));
      rect.setAttribute('height', String(visual.spacing + overlap));
      rect.setAttribute('fill', owner === 'black' ? '#000000' : '#ffffff');
      rect.setAttribute('opacity', String(TORUS_FINAL_TERRITORY_OPACITY));
      rect.setAttribute('pointer-events', 'none');
      rect.setAttribute('data-logical-point-id', point.logicalPointId);
      rect.setAttribute('data-territory-owner', owner);
      rect.setAttribute('data-copy-role', point.duplicate ? 'duplicate' : 'primary');
      rect.setAttribute('class', `${FINAL_TERRITORY_POINT_CLASS} ${FINAL_TERRITORY_POINT_CLASS}--${owner}`);
      layer.appendChild(rect);
      rendered += 1;
    }

    if (layer.childNodes.length > 0) grid.insertBefore(layer, grid.firstChild);
  }

  svg.setAttribute('data-final-territory-visible', rendered > 0 ? 'true' : 'false');
};

export const stonePlacementPointFromTransition = (
  previousViewModel: GameViewModel | null,
  nextViewModel: GameViewModel,
): PointId | null => {
  if (!previousViewModel || nextViewModel.moveNumber !== previousViewModel.moveNumber + 1) {
    return null;
  }

  const logicalPointId = nextViewModel.lastMovePointId ?? null;
  if (!logicalPointId) return null;

  const previousPoint = previousViewModel.points.find(
    (point) => point.logicalPointId === logicalPointId,
  );
  const nextPoint = nextViewModel.points.find((point) => point.logicalPointId === logicalPointId);
  if (!previousPoint || !nextPoint) return null;
  if (previousPoint.occupancy !== 'empty' || nextPoint.occupancy === 'empty') return null;
  if (
    typeof nextPoint.moveNumber === 'number' &&
    nextPoint.moveNumber !== nextViewModel.moveNumber
  ) {
    return null;
  }

  return logicalPointId;
};

/**
 * Adds renderer-only annotations to every visible stone copy. The function works
 * for both the normal board and the temporary pan-transition stone layers.
 *
 * It also renders final territory below the grid and mutes dead stones from the
 * finished ViewModel. Tracking the previous ViewModel on the persistent SVG root
 * avoids replaying the placement animation for unrelated presentation updates.
 */
export const renderTorus2DStoneAnnotations = (
  svg: SVGSVGElement,
  viewModel: GameViewModel,
  showMoveNumbers: boolean,
): void => {
  const previousViewModel = previousViewModelBySvg.get(svg) ?? null;
  const placementPointId = stonePlacementPointFromTransition(previousViewModel, viewModel);
  previousViewModelBySvg.set(svg, viewModel);

  applyTorus2DStoneArtwork(svg);
  renderFinalTerritory(svg, viewModel);
  const deadStonePointIds = finalDeadStonePointIds(viewModel);
  const moveNumbers = pointMoveNumbers(viewModel);
  const lastMovePointId = viewModel.lastMovePointId ?? null;

  for (const stoneLayer of svg.querySelectorAll('.torus-board__stones')) {
    for (const existing of stoneLayer.querySelectorAll(`.${ANNOTATION_CLASS}`)) {
      existing.remove();
    }

    for (const stone of directStoneCircles(stoneLayer)) {
      const logicalPointId = stone.getAttribute('data-logical-point-id');
      const occupancy = stone.getAttribute('data-occupancy') as StoneColor | null;
      const cx = stone.getAttribute('cx');
      const cy = stone.getAttribute('cy');
      const radius = Number(stone.getAttribute('r'));
      if (!logicalPointId || !occupancy || !cx || !cy || !Number.isFinite(radius)) continue;

      const dead = deadStonePointIds.has(logicalPointId);
      if (dead) {
        stone.classList.add(DEAD_STONE_CLASS);
        stone.setAttribute('opacity', String(TORUS_DEAD_STONE_OPACITY));
        stone.setAttribute('data-dead-stone', 'true');
      } else {
        stone.classList.remove(DEAD_STONE_CLASS);
        stone.removeAttribute('opacity');
        stone.removeAttribute('data-dead-stone');
      }

      if (logicalPointId === placementPointId) {
        stone.classList.add(PLACEMENT_ANIMATION_CLASS);
      }

      if (logicalPointId === lastMovePointId) {
        const marker = svg.ownerDocument.createElementNS(SVG_NS, 'circle');
        marker.setAttribute('cx', cx);
        marker.setAttribute('cy', cy);
        marker.setAttribute('r', String(Math.max(2.5, radius * 0.16)));
        marker.setAttribute('fill', contrastColor(occupancy));
        marker.setAttribute('pointer-events', 'none');
        marker.setAttribute('data-logical-point-id', logicalPointId);
        marker.setAttribute('data-last-move-marker', 'true');
        marker.setAttribute('class', `${ANNOTATION_CLASS} torus-board__last-move-marker`);
        if (dead) marker.setAttribute('opacity', String(TORUS_DEAD_STONE_OPACITY));
        stoneLayer.appendChild(marker);
        continue;
      }

      if (!showMoveNumbers) continue;
      const moveNumber = moveNumbers.get(logicalPointId);
      if (moveNumber === undefined) continue;

      const label = svg.ownerDocument.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', cx);
      label.setAttribute('y', cy);
      label.setAttribute('fill', contrastColor(occupancy));
      label.setAttribute('font-size', String(Math.max(8, radius * 0.72)));
      label.setAttribute('font-weight', '700');
      label.setAttribute('font-family', 'system-ui, sans-serif');
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('dominant-baseline', 'central');
      label.setAttribute('pointer-events', 'none');
      label.setAttribute('data-logical-point-id', logicalPointId);
      label.setAttribute('data-move-number', String(moveNumber));
      label.setAttribute('class', `${ANNOTATION_CLASS} torus-board__move-number`);
      if (dead) label.setAttribute('opacity', String(TORUS_DEAD_STONE_OPACITY));
      label.textContent = String(moveNumber);
      stoneLayer.appendChild(label);
    }
  }
};
