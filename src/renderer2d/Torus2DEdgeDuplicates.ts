import type { PointOccupancy } from '../core/game/types';
import type { PointId } from '../core/topology/Topology';
import type { GameViewModel } from '../presentation/PresentationModel';
import type { Torus2DSize, Torus2DViewState } from './Torus2DRenderer';

const SVG_NS = 'http://www.w3.org/2000/svg';
const VIEW_BOX_SIZE = 1000;
const BOARD_PADDING = 120;
const GRID_COLOR = '#201e1c';
const DUPLICATE_GRID_DASH = '14 10';
const DUPLICATE_GRID_OPACITY = 0.72;
const DUPLICATE_BAND_OPACITY = 0.16;
const DUPLICATE_STONE_OPACITY = 0.5;
let duplicateGridMaskSequence = 0;

export const TORUS_EDGE_DUPLICATE_GRID_DASH = DUPLICATE_GRID_DASH;
export const TORUS_EDGE_DUPLICATE_STONE_OPACITY = DUPLICATE_STONE_OPACITY;

type DuplicateSide = 'left' | 'right' | 'top' | 'bottom';

type DuplicateVisualPoint = Readonly<{
  logicalPointId: PointId;
  occupancy: PointOccupancy;
  x: number;
  y: number;
  side: DuplicateSide;
}>;

const wrap = (value: number, size: number): number => ((value % size) + size) % size;
const pointId = (x: number, y: number): PointId => `${x},${y}`;

const gridStrokeWidth = (size: Torus2DSize): number =>
  size === 19 ? 0.8 : size === 13 ? 1.5 : 2;

const directOverlay = (svg: SVGSVGElement): SVGGElement | null =>
  Array.from(svg.children).find(
    (child): child is SVGGElement =>
      child instanceof SVGGElement && child.classList.contains('torus-board__edge-duplicates'),
  ) ?? null;

const directPrimaryStoneLayer = (svg: SVGSVGElement): SVGGElement | null =>
  Array.from(svg.children).find(
    (child): child is SVGGElement =>
      child instanceof SVGGElement &&
      child.classList.contains('torus-board__stones') &&
      !child.classList.contains('torus-board__edge-duplicate-stones'),
  ) ?? null;

const setAttributes = (element: Element, attributes: Readonly<Record<string, string>>): void => {
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
};

const appendLine = (
  group: SVGGElement,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  size: Torus2DSize,
): void => {
  const line = group.ownerDocument.createElementNS(SVG_NS, 'line');
  setAttributes(line, {
    x1: String(x1),
    y1: String(y1),
    x2: String(x2),
    y2: String(y2),
    stroke: GRID_COLOR,
    'stroke-width': String(gridStrokeWidth(size)),
    'stroke-dasharray': DUPLICATE_GRID_DASH,
    'stroke-linecap': 'round',
    'vector-effect': 'non-scaling-stroke',
    opacity: String(DUPLICATE_GRID_OPACITY),
    'pointer-events': 'none',
    class: 'torus-board__edge-duplicate-grid-line',
  });
  group.appendChild(line);
};

const finalTerritoryOwners = (
  viewModel: GameViewModel,
): ReadonlyMap<PointId, 'black' | 'white'> => {
  const owners = new Map<PointId, 'black' | 'white'>();
  if (viewModel.phase !== 'finished' || !viewModel.finalScore) return owners;

  for (const id of viewModel.finalScore.territoryPoints.black) owners.set(id, 'black');
  for (const id of viewModel.finalScore.territoryPoints.white) owners.set(id, 'white');
  return owners;
};

const buildDuplicatePoints = (
  viewModel: GameViewModel,
  size: Torus2DSize,
  viewState: Torus2DViewState,
  spacing: number,
): readonly DuplicateVisualPoint[] => {
  const byId = new Map<PointId, PointOccupancy>(
    viewModel.points.map((point) => [point.logicalPointId, point.occupancy]),
  );
  const boardStart = BOARD_PADDING;
  const boardEnd = VIEW_BOX_SIZE - BOARD_PADDING;
  const outerLeft = boardStart - spacing;
  const outerRight = boardEnd + spacing;
  const outerTop = boardStart - spacing;
  const outerBottom = boardEnd + spacing;
  const points: DuplicateVisualPoint[] = [];

  const push = (
    logicalX: number,
    logicalY: number,
    x: number,
    y: number,
    side: DuplicateSide,
  ): void => {
    const logicalPointId = pointId(wrap(logicalX, size), wrap(logicalY, size));
    const occupancy = byId.get(logicalPointId);
    if (!occupancy) throw new Error(`GameViewModel is missing torus point: ${logicalPointId}`);
    points.push(Object.freeze({ logicalPointId, occupancy, x, y, side }));
  };

  for (let row = 0; row < size; row += 1) {
    const y = boardStart + row * spacing;
    const logicalY = row + viewState.offsetY;
    push(viewState.offsetX - 1, logicalY, outerLeft, y, 'left');
    push(viewState.offsetX + size, logicalY, outerRight, y, 'right');
  }

  for (let column = 0; column < size; column += 1) {
    const x = boardStart + column * spacing;
    const logicalX = column + viewState.offsetX;
    push(logicalX, viewState.offsetY - 1, x, outerTop, 'top');
    push(logicalX, viewState.offsetY + size, x, outerBottom, 'bottom');
  }

  return Object.freeze(points);
};

const duplicateSignature = (
  viewModel: GameViewModel,
  size: Torus2DSize,
  viewState: Torus2DViewState,
): string =>
  [
    size,
    viewState.offsetX,
    viewState.offsetY,
    viewModel.phase,
    viewModel.moveNumber,
    viewModel.captures.black,
    viewModel.captures.white,
  ].join(':');

/**
 * Draws the opt-in torus wrap preview as four non-interactive one-step strips.
 * The normal renderer remains the only owner of the playable board. The overlay
 * contains no hit targets and every visual stone keeps the same logical pointId.
 */
export const renderTorus2DEdgeDuplicates = (
  svg: SVGSVGElement,
  viewModel: GameViewModel,
  size: Torus2DSize,
  viewState: Torus2DViewState,
  visible: boolean,
): void => {
  const existing = directOverlay(svg);
  svg.setAttribute('data-duplicate-regions-visible', visible ? 'true' : 'false');

  if (!visible || svg.getAttribute('data-pan-animating') === 'true') {
    existing?.remove();
    return;
  }

  const signature = duplicateSignature(viewModel, size, viewState);
  if (existing?.getAttribute('data-duplicate-signature') === signature) return;
  existing?.remove();

  const spacing = (VIEW_BOX_SIZE - BOARD_PADDING * 2) / (size - 1);
  const boardStart = BOARD_PADDING;
  const boardEnd = VIEW_BOX_SIZE - BOARD_PADDING;
  const boardSpan = boardEnd - boardStart;
  const outerLeft = boardStart - spacing;
  const outerRight = boardEnd + spacing;
  const outerTop = boardStart - spacing;
  const outerBottom = boardEnd + spacing;
  const stoneRadius = spacing * 0.42;
  const duplicatePoints = buildDuplicatePoints(viewModel, size, viewState, spacing);
  const document = svg.ownerDocument;

  const overlay = document.createElementNS(SVG_NS, 'g');
  setAttributes(overlay, {
    class: 'torus-board__edge-duplicates',
    'pointer-events': 'none',
    'data-duplicate-signature': signature,
  });

  const gridMaskId = `torus-edge-duplicate-grid-mask-${++duplicateGridMaskSequence}`;
  const defs = document.createElementNS(SVG_NS, 'defs');
  const gridMask = document.createElementNS(SVG_NS, 'mask');
  setAttributes(gridMask, {
    id: gridMaskId,
    class: 'torus-board__edge-duplicate-grid-mask',
    maskUnits: 'userSpaceOnUse',
    maskContentUnits: 'userSpaceOnUse',
    x: '0',
    y: '0',
    width: String(VIEW_BOX_SIZE),
    height: String(VIEW_BOX_SIZE),
  });
  const gridMaskBackground = document.createElementNS(SVG_NS, 'rect');
  setAttributes(gridMaskBackground, {
    x: '0',
    y: '0',
    width: String(VIEW_BOX_SIZE),
    height: String(VIEW_BOX_SIZE),
    fill: '#ffffff',
  });
  gridMask.appendChild(gridMaskBackground);
  for (const point of duplicatePoints) {
    if (point.occupancy === 'empty') continue;
    const hole = document.createElementNS(SVG_NS, 'circle');
    setAttributes(hole, {
      cx: String(point.x),
      cy: String(point.y),
      r: String(stoneRadius + gridStrokeWidth(size) / 2),
      fill: '#000000',
      'data-logical-point-id': point.logicalPointId,
      'data-copy-role': 'duplicate',
    });
    gridMask.appendChild(hole);
  }
  defs.appendChild(gridMask);
  overlay.appendChild(defs);

  const bands = document.createElementNS(SVG_NS, 'g');
  bands.setAttribute('class', 'torus-board__edge-duplicate-bands');
  bands.setAttribute('pointer-events', 'none');
  const bandRects = [
    { side: 'left', x: outerLeft, y: boardStart, width: spacing, height: boardSpan },
    { side: 'right', x: boardEnd, y: boardStart, width: spacing, height: boardSpan },
    { side: 'top', x: boardStart, y: outerTop, width: boardSpan, height: spacing },
    { side: 'bottom', x: boardStart, y: boardEnd, width: boardSpan, height: spacing },
  ] as const;
  for (const band of bandRects) {
    const rect = document.createElementNS(SVG_NS, 'rect');
    setAttributes(rect, {
      x: String(band.x),
      y: String(band.y),
      width: String(band.width),
      height: String(band.height),
      fill: '#d8ad68',
      opacity: String(DUPLICATE_BAND_OPACITY),
      'pointer-events': 'none',
      'data-duplicate-side': band.side,
      class: 'torus-board__edge-duplicate-band',
    });
    bands.appendChild(rect);
  }
  overlay.appendChild(bands);

  const owners = finalTerritoryOwners(viewModel);
  if (owners.size > 0) {
    const territory = document.createElementNS(SVG_NS, 'g');
    territory.setAttribute('class', 'torus-board__edge-duplicate-territory');
    territory.setAttribute('pointer-events', 'none');
    for (const point of duplicatePoints) {
      const owner = owners.get(point.logicalPointId);
      if (!owner) continue;
      const rect = document.createElementNS(SVG_NS, 'rect');
      setAttributes(rect, {
        x: String(point.x - spacing / 2),
        y: String(point.y - spacing / 2),
        width: String(spacing),
        height: String(spacing),
        fill: owner === 'black' ? '#000000' : '#ffffff',
        opacity: '0.2',
        'pointer-events': 'none',
        'data-logical-point-id': point.logicalPointId,
        'data-territory-owner': owner,
        'data-copy-role': 'duplicate',
        'data-duplicate-side': point.side,
        class: `torus-board__final-territory-point torus-board__final-territory-point--${owner} torus-board__edge-duplicate-territory-point`,
      });
      territory.appendChild(rect);
    }
    overlay.appendChild(territory);
  }

  const grid = document.createElementNS(SVG_NS, 'g');
  setAttributes(grid, {
    class: 'torus-board__edge-duplicate-grid',
    'pointer-events': 'none',
    mask: `url(#${gridMaskId})`,
  });

  appendLine(grid, outerLeft, boardStart, outerLeft, boardEnd, size);
  appendLine(grid, outerRight, boardStart, outerRight, boardEnd, size);
  appendLine(grid, boardStart, outerTop, boardEnd, outerTop, size);
  appendLine(grid, boardStart, outerBottom, boardEnd, outerBottom, size);

  for (let index = 0; index < size; index += 1) {
    const position = boardStart + index * spacing;
    appendLine(grid, outerLeft, position, boardStart, position, size);
    appendLine(grid, boardEnd, position, outerRight, position, size);
    appendLine(grid, position, outerTop, position, boardStart, size);
    appendLine(grid, position, boardEnd, position, outerBottom, size);
  }
  overlay.appendChild(grid);

  const stones = document.createElementNS(SVG_NS, 'g');
  setAttributes(stones, {
    class: 'torus-board__stones torus-board__edge-duplicate-stones',
    opacity: String(DUPLICATE_STONE_OPACITY),
    'pointer-events': 'none',
  });
  for (const point of duplicatePoints) {
    if (point.occupancy === 'empty') continue;
    const stone = document.createElementNS(SVG_NS, 'circle');
    setAttributes(stone, {
      cx: String(point.x),
      cy: String(point.y),
      r: String(stoneRadius),
      fill: point.occupancy === 'black' ? '#111111' : '#f5f5f2',
      stroke: '#111111',
      'stroke-width': '2',
      'vector-effect': 'non-scaling-stroke',
      'pointer-events': 'none',
      'data-logical-point-id': point.logicalPointId,
      'data-occupancy': point.occupancy,
      'data-copy-role': 'duplicate',
      'data-duplicate-side': point.side,
      class: `torus-board__stone torus-board__stone--${point.occupancy} torus-board__stone--duplicate torus-board__edge-duplicate-stone`,
    });
    stones.appendChild(stone);
  }
  overlay.appendChild(stones);

  // Duplicate strips are decoration. Keep the whole overlay below the canonical
  // stone layer so translucent bands/dashed grid can never tint or cross a real
  // edge stone on the playable N×N board.
  const primaryStoneLayer = directPrimaryStoneLayer(svg);
  if (primaryStoneLayer) svg.insertBefore(overlay, primaryStoneLayer);
  else svg.appendChild(overlay);
};

/**
 * Duplicate strips remain non-interactive, but the canonical edge intersections
 * keep their normal circular hit area even where that circle extends visually into
 * a duplicate strip. The duplicate centers themselves remain outside this allowance.
 */
export const isTorus2DPrimaryBoardClientPosition = (
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): boolean => {
  const bounds = svg.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return false;

  const x = ((clientX - bounds.left) / bounds.width) * VIEW_BOX_SIZE;
  const y = ((clientY - bounds.top) / bounds.height) * VIEW_BOX_SIZE;
  const primaryHitTarget = svg.querySelector<SVGCircleElement>(
    '.torus-board__hit-target[data-copy-role="primary"]',
  );
  const hitRadius = Number(primaryHitTarget?.getAttribute('r') ?? 0);
  const edgeHitAllowance = Number.isFinite(hitRadius) && hitRadius > 0 ? hitRadius : 0;

  return x >= BOARD_PADDING - edgeHitAllowance &&
    x <= VIEW_BOX_SIZE - BOARD_PADDING + edgeHitAllowance &&
    y >= BOARD_PADDING - edgeHitAllowance &&
    y <= VIEW_BOX_SIZE - BOARD_PADDING + edgeHitAllowance;
};
