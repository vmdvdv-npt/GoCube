import type { PointOccupancy } from '../core/game/types';
import type { PointId } from '../core/topology/Topology';
import type { GameViewModel } from '../presentation/PresentationModel';
import type { Renderer2D } from './Renderer2D';

export type Torus2DSize = 9 | 13 | 19;
export type Torus2DPanDirection = 'left' | 'right' | 'up' | 'down';

export interface Torus2DViewState {
  readonly offsetX: number;
  readonly offsetY: number;
}

export interface Torus2DScenePoint {
  readonly logicalPointId: PointId;
  readonly occupancy: PointOccupancy;
  readonly x: number;
  readonly y: number;
  readonly visualColumn: number;
  readonly visualRow: number;
  readonly duplicate: boolean;
}

export interface Torus2DGridLine {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface Torus2DScene {
  readonly size: Torus2DSize;
  readonly viewState: Torus2DViewState;
  readonly viewBoxSize: number;
  readonly padding: number;
  readonly spacing: number;
  readonly hitRadius: number;
  readonly stoneRadius: number;
  /** One canonical visual position for every logical point in the current view. */
  readonly points: readonly Torus2DScenePoint[];
  /** Canonical points plus one wrapped duplicate row/column around every edge. */
  readonly visualPoints: readonly Torus2DScenePoint[];
  readonly gridLines: readonly Torus2DGridLine[];
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const VIEW_BOX_SIZE = 1000;
const BOARD_PADDING = 120;
const SUPPORTED_SIZES: readonly Torus2DSize[] = Object.freeze([9, 13, 19]);
const DEFAULT_VIEW_STATE: Torus2DViewState = Object.freeze({ offsetX: 0, offsetY: 0 });

const assertSupportedSize: (size: number) => asserts size is Torus2DSize = (size) => {
  if (!SUPPORTED_SIZES.includes(size as Torus2DSize)) {
    throw new Error(`Unsupported Torus2DRenderer size: ${size}`);
  }
};

const pointId = (x: number, y: number): PointId => `${x},${y}`;
const wrap = (value: number, size: number): number => ((value % size) + size) % size;

const normalizeViewState = (
  viewState: Torus2DViewState,
  size: Torus2DSize,
): Torus2DViewState => {
  if (!Number.isInteger(viewState.offsetX) || !Number.isInteger(viewState.offsetY)) {
    throw new Error('Torus2D view offsets must be integer logical steps');
  }

  return Object.freeze({
    offsetX: wrap(viewState.offsetX, size),
    offsetY: wrap(viewState.offsetY, size),
  });
};

export const shiftTorus2DViewState = (
  viewState: Torus2DViewState,
  direction: Torus2DPanDirection,
  size: Torus2DSize,
): Torus2DViewState => {
  const normalized = normalizeViewState(viewState, size);

  switch (direction) {
    case 'left':
      return normalizeViewState({ ...normalized, offsetX: normalized.offsetX - 1 }, size);
    case 'right':
      return normalizeViewState({ ...normalized, offsetX: normalized.offsetX + 1 }, size);
    case 'up':
      return normalizeViewState({ ...normalized, offsetY: normalized.offsetY - 1 }, size);
    case 'down':
      return normalizeViewState({ ...normalized, offsetY: normalized.offsetY + 1 }, size);
  }
};

const freezeLine = (line: Torus2DGridLine): Torus2DGridLine => Object.freeze(line);

export const buildTorus2DScene = (
  viewModel: GameViewModel,
  size: Torus2DSize,
  viewState: Torus2DViewState = DEFAULT_VIEW_STATE,
): Torus2DScene => {
  assertSupportedSize(size);
  const normalizedViewState = normalizeViewState(viewState, size);

  const expectedPointCount = size * size;
  if (viewModel.points.length !== expectedPointCount) {
    throw new Error(
      `Torus2DRenderer expected ${expectedPointCount} points for ${size}x${size}, got ${viewModel.points.length}`,
    );
  }

  const byId = new Map<PointId, PointOccupancy>();
  for (const point of viewModel.points) {
    if (byId.has(point.logicalPointId)) {
      throw new Error(`Duplicate logical point in GameViewModel: ${point.logicalPointId}`);
    }
    byId.set(point.logicalPointId, point.occupancy);
  }

  const spacing = (VIEW_BOX_SIZE - BOARD_PADDING * 2) / (size - 1);
  const coordinate = (index: number): number => BOARD_PADDING + index * spacing;

  const scenePoint = (visualColumn: number, visualRow: number): Torus2DScenePoint => {
    const logicalX = wrap(visualColumn + normalizedViewState.offsetX, size);
    const logicalY = wrap(visualRow + normalizedViewState.offsetY, size);
    const logicalPointId = pointId(logicalX, logicalY);
    const occupancy = byId.get(logicalPointId);
    if (!occupancy) {
      throw new Error(`GameViewModel is missing torus point: ${logicalPointId}`);
    }

    return Object.freeze({
      logicalPointId,
      occupancy,
      x: coordinate(visualColumn),
      y: coordinate(visualRow),
      visualColumn,
      visualRow,
      duplicate:
        visualColumn < 0 || visualColumn >= size || visualRow < 0 || visualRow >= size,
    });
  };

  const points: Torus2DScenePoint[] = [];
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      points.push(scenePoint(column, row));
    }
  }

  const visualPoints: Torus2DScenePoint[] = [];
  for (let row = -1; row <= size; row += 1) {
    for (let column = -1; column <= size; column += 1) {
      visualPoints.push(scenePoint(column, row));
    }
  }

  const gridLines: Torus2DGridLine[] = [];
  const start = coordinate(-1);
  const end = coordinate(size);
  for (let index = -1; index <= size; index += 1) {
    const position = coordinate(index);
    gridLines.push(freezeLine({ x1: position, y1: start, x2: position, y2: end }));
    gridLines.push(freezeLine({ x1: start, y1: position, x2: end, y2: position }));
  }

  return Object.freeze({
    size,
    viewState: normalizedViewState,
    viewBoxSize: VIEW_BOX_SIZE,
    padding: BOARD_PADDING,
    spacing,
    hitRadius: spacing * 0.38,
    stoneRadius: spacing * 0.42,
    points: Object.freeze(points),
    visualPoints: Object.freeze(visualPoints),
    gridLines: Object.freeze(gridLines),
  });
};

export const pointFromTorusViewBoxPosition = (
  scene: Torus2DScene,
  x: number,
  y: number,
): PointId | null => {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const column = Math.round((x - scene.padding) / scene.spacing);
  const row = Math.round((y - scene.padding) / scene.spacing);
  if (column < -1 || column > scene.size || row < -1 || row > scene.size) return null;

  const centerX = scene.padding + column * scene.spacing;
  const centerY = scene.padding + row * scene.spacing;
  const distanceSquared = (x - centerX) ** 2 + (y - centerY) ** 2;
  if (distanceSquared > scene.hitRadius ** 2) return null;

  return pointId(
    wrap(column + scene.viewState.offsetX, scene.size),
    wrap(row + scene.viewState.offsetY, scene.size),
  );
};

const setAttributes = (element: Element, attributes: Readonly<Record<string, string>>): void => {
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
};

export class Torus2DRenderer implements Renderer2D {
  private scene: Torus2DScene | null = null;
  private currentViewModel: GameViewModel | null = null;
  private currentViewState: Torus2DViewState = DEFAULT_VIEW_STATE;

  constructor(
    private readonly svg: SVGSVGElement,
    readonly size: Torus2DSize,
  ) {
    assertSupportedSize(size);
  }

  viewState(): Torus2DViewState {
    return this.currentViewState;
  }

  pan(direction: Torus2DPanDirection): Torus2DViewState {
    this.currentViewState = shiftTorus2DViewState(this.currentViewState, direction, this.size);
    if (this.currentViewModel) this.render(this.currentViewModel);
    return this.currentViewState;
  }

  render(viewModel: GameViewModel): void {
    this.currentViewModel = viewModel;
    const scene = buildTorus2DScene(viewModel, this.size, this.currentViewState);
    this.scene = scene;

    this.svg.setAttribute('viewBox', `0 0 ${scene.viewBoxSize} ${scene.viewBoxSize}`);
    this.svg.setAttribute('preserveAspectRatio', 'none');
    this.svg.setAttribute('role', 'img');
    this.svg.setAttribute('aria-label', `${scene.size} by ${scene.size} repeating torus Go board`);
    this.svg.setAttribute('data-view-offset-x', String(scene.viewState.offsetX));
    this.svg.setAttribute('data-view-offset-y', String(scene.viewState.offsetY));

    const document = this.svg.ownerDocument;
    const background = document.createElementNS(SVG_NS, 'rect');
    setAttributes(background, {
      x: '0',
      y: '0',
      width: String(scene.viewBoxSize),
      height: String(scene.viewBoxSize),
      fill: '#d8ad68',
      class: 'torus-board__background',
    });

    const grid = document.createElementNS(SVG_NS, 'g');
    grid.setAttribute('class', 'torus-board__grid');
    for (const lineData of scene.gridLines) {
      const line = document.createElementNS(SVG_NS, 'line');
      setAttributes(line, {
        x1: String(lineData.x1),
        y1: String(lineData.y1),
        x2: String(lineData.x2),
        y2: String(lineData.y2),
        stroke: '#3f3325',
        'stroke-width': '2',
        'vector-effect': 'non-scaling-stroke',
      });
      grid.appendChild(line);
    }

    const hitTargets = document.createElementNS(SVG_NS, 'g');
    hitTargets.setAttribute('class', 'torus-board__hit-targets');
    for (const point of scene.visualPoints) {
      const target = document.createElementNS(SVG_NS, 'circle');
      setAttributes(target, {
        cx: String(point.x),
        cy: String(point.y),
        r: String(scene.hitRadius),
        fill: 'transparent',
        'pointer-events': 'all',
        'data-logical-point-id': point.logicalPointId,
        'data-copy-role': point.duplicate ? 'duplicate' : 'primary',
        class: `torus-board__hit-target${point.duplicate ? ' torus-board__hit-target--duplicate' : ''}`,
      });
      hitTargets.appendChild(target);
    }

    const stones = document.createElementNS(SVG_NS, 'g');
    stones.setAttribute('class', 'torus-board__stones');
    for (const point of scene.visualPoints) {
      if (point.occupancy === 'empty') continue;

      const stone = document.createElementNS(SVG_NS, 'circle');
      setAttributes(stone, {
        cx: String(point.x),
        cy: String(point.y),
        r: String(scene.stoneRadius),
        fill: point.occupancy === 'black' ? '#111111' : '#f5f5f2',
        stroke: '#111111',
        'stroke-width': '2',
        'vector-effect': 'non-scaling-stroke',
        'pointer-events': 'none',
        'data-logical-point-id': point.logicalPointId,
        'data-occupancy': point.occupancy,
        'data-copy-role': point.duplicate ? 'duplicate' : 'primary',
        class: `torus-board__stone torus-board__stone--${point.occupancy}${point.duplicate ? ' torus-board__stone--duplicate' : ''}`,
      });
      stones.appendChild(stone);
    }

    this.svg.replaceChildren(background, grid, hitTargets, stones);
  }

  pointFromClientPosition(x: number, y: number): PointId | null {
    if (!this.scene) return null;

    const bounds = this.svg.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return null;

    const localX = ((x - bounds.left) / bounds.width) * this.scene.viewBoxSize;
    const localY = ((y - bounds.top) / bounds.height) * this.scene.viewBoxSize;
    return pointFromTorusViewBoxPosition(this.scene, localX, localY);
  }
}
