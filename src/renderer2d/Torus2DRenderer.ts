import type { PointOccupancy, StoneColor } from '../core/game/types';
import type { PointId } from '../core/topology/Topology';
import type {
  EndgameGroupRenderState,
  EndgameVisualStatus,
} from '../presentation/EndgameGroupPresentation';
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
  readonly duplicateMargin: number;
  readonly hitRadius: number;
  readonly stoneRadius: number;
  /** One canonical visual position for every logical point in the current view. */
  readonly points: readonly Torus2DScenePoint[];
  /** Canonical points plus optional wrapped duplicate regions around every edge. */
  readonly visualPoints: readonly Torus2DScenePoint[];
  readonly gridLines: readonly Torus2DGridLine[];
}

export interface Torus2DEndgameOverlay {
  readonly groups: readonly EndgameGroupRenderState[];
  readonly hoveredGroupId: string | null;
  readonly selectedGroupId: string | null;
}

export interface Torus2DEndgameSegment {
  readonly groupId: string;
  readonly groupColor: StoneColor;
  readonly status: EndgameVisualStatus | null;
  readonly temporary: boolean;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface Torus2DEndgameLineStyle {
  readonly stroke: string;
  readonly strokeDasharray: string | null;
  readonly opacity: number;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const VIEW_BOX_SIZE = 1000;
const BOARD_PADDING = 120;
const DUPLICATE_MARGIN = 4;
export const TORUS_ENDGAME_LINE_WIDTH_PX = 2;
const ENDGAME_HIT_TOLERANCE_PX = 8;
const SUPPORTED_SIZES: readonly Torus2DSize[] = Object.freeze([9, 13, 19]);
const DEFAULT_VIEW_STATE: Torus2DViewState = Object.freeze({ offsetX: 0, offsetY: 0 });
const EMPTY_ENDGAME_OVERLAY: Torus2DEndgameOverlay = Object.freeze({
  groups: Object.freeze([]),
  hoveredGroupId: null,
  selectedGroupId: null,
});

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
  showDuplicateRegions = false,
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

  const duplicateMargin = showDuplicateRegions ? DUPLICATE_MARGIN : 0;
  const visibleSpan = size - 1 + duplicateMargin * 2;
  const spacing = (VIEW_BOX_SIZE - BOARD_PADDING * 2) / visibleSpan;
  const canonicalOrigin = BOARD_PADDING + duplicateMargin * spacing;
  const coordinate = (index: number): number => canonicalOrigin + index * spacing;

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
  for (let row = -duplicateMargin; row < size + duplicateMargin; row += 1) {
    for (let column = -duplicateMargin; column < size + duplicateMargin; column += 1) {
      visualPoints.push(scenePoint(column, row));
    }
  }

  const gridLines: Torus2DGridLine[] = [];
  const start = coordinate(-duplicateMargin);
  const end = coordinate(size - 1 + duplicateMargin);
  for (let index = -duplicateMargin; index < size + duplicateMargin; index += 1) {
    const position = coordinate(index);
    gridLines.push(freezeLine({ x1: position, y1: start, x2: position, y2: end }));
    gridLines.push(freezeLine({ x1: start, y1: position, x2: end, y2: position }));
  }

  return Object.freeze({
    size,
    viewState: normalizedViewState,
    viewBoxSize: VIEW_BOX_SIZE,
    padding: canonicalOrigin,
    spacing,
    duplicateMargin,
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
  if (
    column < -scene.duplicateMargin ||
    column >= scene.size + scene.duplicateMargin ||
    row < -scene.duplicateMargin ||
    row >= scene.size + scene.duplicateMargin
  ) {
    return null;
  }

  const centerX = scene.padding + column * scene.spacing;
  const centerY = scene.padding + row * scene.spacing;
  const distanceSquared = (x - centerX) ** 2 + (y - centerY) ** 2;
  if (distanceSquared > scene.hitRadius ** 2) return null;

  return pointId(
    wrap(column + scene.viewState.offsetX, scene.size),
    wrap(row + scene.viewState.offsetY, scene.size),
  );
};

const logicalPointAtVisualPosition = (
  scene: Torus2DScene,
  visualColumn: number,
  visualRow: number,
): PointId =>
  pointId(
    wrap(visualColumn + scene.viewState.offsetX, scene.size),
    wrap(visualRow + scene.viewState.offsetY, scene.size),
  );

const visualPositionKey = (column: number, row: number): string => `${column},${row}`;
const segmentKey = (x1: number, y1: number, x2: number, y2: number): string => {
  const left = `${x1},${y1}`;
  const right = `${x2},${y2}`;
  return left < right ? `${left}|${right}` : `${right}|${left}`;
};

const directionOffsets = Object.freeze([
  Object.freeze({ dx: -1, dy: 0 }),
  Object.freeze({ dx: 1, dy: 0 }),
  Object.freeze({ dx: 0, dy: -1 }),
  Object.freeze({ dx: 0, dy: 1 }),
]);

export const buildTorus2DEndgameSegments = (
  scene: Torus2DScene,
  overlay: Torus2DEndgameOverlay,
): readonly Torus2DEndgameSegment[] => {
  const pointByVisualPosition = new Map<string, Torus2DScenePoint>();
  for (const point of scene.visualPoints) {
    pointByVisualPosition.set(
      visualPositionKey(point.visualColumn, point.visualRow),
      point,
    );
  }

  const segments: Torus2DEndgameSegment[] = [];

  for (const group of overlay.groups) {
    const temporary =
      group.status === null &&
      (overlay.hoveredGroupId === group.id || overlay.selectedGroupId === group.id);
    if (group.status === null && !temporary) continue;

    const visualCopies = scene.visualPoints.filter((point) =>
      group.points.includes(point.logicalPointId),
    );

    if (group.points.length === 1) {
      for (const point of visualCopies) {
        segments.push(
          Object.freeze({
            groupId: group.id,
            groupColor: group.color,
            status: group.status,
            temporary,
            x1: point.x - scene.stoneRadius,
            y1: point.y,
            x2: point.x + scene.stoneRadius,
            y2: point.y,
          }),
        );
      }
      continue;
    }

    const neighborsByPoint = new Map<PointId, Set<PointId>>();
    for (const edge of group.edges) {
      const fromNeighbors = neighborsByPoint.get(edge.from) ?? new Set<PointId>();
      fromNeighbors.add(edge.to);
      neighborsByPoint.set(edge.from, fromNeighbors);

      const toNeighbors = neighborsByPoint.get(edge.to) ?? new Set<PointId>();
      toNeighbors.add(edge.from);
      neighborsByPoint.set(edge.to, toNeighbors);
    }

    const seenSegments = new Set<string>();
    for (const point of visualCopies) {
      const logicalNeighbors = neighborsByPoint.get(point.logicalPointId);
      if (!logicalNeighbors) continue;

      for (const { dx, dy } of directionOffsets) {
        const neighborColumn = point.visualColumn + dx;
        const neighborRow = point.visualRow + dy;
        const logicalNeighbor = logicalPointAtVisualPosition(
          scene,
          neighborColumn,
          neighborRow,
        );
        if (!logicalNeighbors.has(logicalNeighbor)) continue;

        const visibleNeighbor = pointByVisualPosition.get(
          visualPositionKey(neighborColumn, neighborRow),
        );
        const x2 = visibleNeighbor
          ? visibleNeighbor.x
          : point.x + (dx * scene.spacing) / 2;
        const y2 = visibleNeighbor
          ? visibleNeighbor.y
          : point.y + (dy * scene.spacing) / 2;
        const key = segmentKey(point.x, point.y, x2, y2);
        if (seenSegments.has(key)) continue;

        seenSegments.add(key);
        segments.push(
          Object.freeze({
            groupId: group.id,
            groupColor: group.color,
            status: group.status,
            temporary,
            x1: point.x,
            y1: point.y,
            x2,
            y2,
          }),
        );
      }
    }
  }

  return Object.freeze(segments);
};

export const endgameLineStyle = (
  status: EndgameVisualStatus | null,
  groupColor: StoneColor,
  temporary: boolean,
): Torus2DEndgameLineStyle => {
  const stroke =
    status === 'dead'
      ? '#d32f2f'
      : status === 'seki'
        ? '#7a7a7a'
        : groupColor === 'black'
          ? '#ffffff'
          : '#111111';

  return Object.freeze({
    stroke,
    strokeDasharray: status === 'unknown' ? '6 5' : null,
    opacity: temporary ? 0.42 : 1,
  });
};

const distanceSquaredToSegment = (
  x: number,
  y: number,
  segment: Torus2DEndgameSegment,
): number => {
  const dx = segment.x2 - segment.x1;
  const dy = segment.y2 - segment.y1;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return (x - segment.x1) ** 2 + (y - segment.y1) ** 2;

  const t = Math.max(
    0,
    Math.min(1, ((x - segment.x1) * dx + (y - segment.y1) * dy) / lengthSquared),
  );
  const closestX = segment.x1 + t * dx;
  const closestY = segment.y1 + t * dy;
  return (x - closestX) ** 2 + (y - closestY) ** 2;
};

export const endgameGroupFromTorusViewBoxPosition = (
  segments: readonly Torus2DEndgameSegment[],
  x: number,
  y: number,
  tolerance = ENDGAME_HIT_TOLERANCE_PX,
): string | null => {
  if (!Number.isFinite(x) || !Number.isFinite(y) || tolerance < 0) return null;

  const toleranceSquared = tolerance ** 2;
  for (const segment of segments) {
    if (distanceSquaredToSegment(x, y, segment) <= toleranceSquared) {
      return segment.groupId;
    }
  }
  return null;
};

const setAttributes = (element: Element, attributes: Readonly<Record<string, string>>): void => {
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
};

export class Torus2DRenderer implements Renderer2D {
  private scene: Torus2DScene | null = null;
  private currentViewModel: GameViewModel | null = null;
  private currentViewState: Torus2DViewState = DEFAULT_VIEW_STATE;
  private showDuplicateRegions = false;
  private endgameOverlay: Torus2DEndgameOverlay = EMPTY_ENDGAME_OVERLAY;
  private endgameSegments: readonly Torus2DEndgameSegment[] = Object.freeze([]);

  constructor(
    private readonly svg: SVGSVGElement,
    readonly size: Torus2DSize,
  ) {
    assertSupportedSize(size);
  }

  viewState(): Torus2DViewState {
    return this.currentViewState;
  }

  duplicateRegionsVisible(): boolean {
    return this.showDuplicateRegions;
  }

  setDuplicateRegionsVisible(visible: boolean): void {
    this.showDuplicateRegions = visible;
  }

  setEndgameOverlay(overlay: Torus2DEndgameOverlay | null): void {
    this.endgameOverlay = overlay ?? EMPTY_ENDGAME_OVERLAY;
  }

  pan(direction: Torus2DPanDirection): Torus2DViewState {
    this.currentViewState = shiftTorus2DViewState(this.currentViewState, direction, this.size);
    if (this.currentViewModel) this.render(this.currentViewModel);
    return this.currentViewState;
  }

  render(viewModel: GameViewModel): void {
    this.currentViewModel = viewModel;
    const scene = buildTorus2DScene(
      viewModel,
      this.size,
      this.currentViewState,
      this.showDuplicateRegions,
    );
    this.scene = scene;
    this.endgameSegments = buildTorus2DEndgameSegments(scene, this.endgameOverlay);

    this.svg.setAttribute('viewBox', `0 0 ${scene.viewBoxSize} ${scene.viewBoxSize}`);
    this.svg.setAttribute('preserveAspectRatio', 'none');
    this.svg.setAttribute('role', 'img');
    this.svg.setAttribute('aria-label', `${scene.size} by ${scene.size} repeating torus Go board`);
    this.svg.setAttribute('data-view-offset-x', String(scene.viewState.offsetX));
    this.svg.setAttribute('data-view-offset-y', String(scene.viewState.offsetY));
    this.svg.setAttribute(
      'data-duplicate-regions-visible',
      this.showDuplicateRegions ? 'true' : 'false',
    );

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

    const endgameLines = document.createElementNS(SVG_NS, 'g');
    endgameLines.setAttribute('class', 'torus-board__endgame-lines');
    for (const segment of this.endgameSegments) {
      const style = endgameLineStyle(
        segment.status,
        segment.groupColor,
        segment.temporary,
      );
      const line = document.createElementNS(SVG_NS, 'line');
      const attributes: Record<string, string> = {
        x1: String(segment.x1),
        y1: String(segment.y1),
        x2: String(segment.x2),
        y2: String(segment.y2),
        stroke: style.stroke,
        'stroke-width': String(TORUS_ENDGAME_LINE_WIDTH_PX),
        'stroke-linecap': 'butt',
        'vector-effect': 'non-scaling-stroke',
        'pointer-events': 'none',
        opacity: String(style.opacity),
        'data-endgame-group-id': segment.groupId,
        'data-endgame-status': segment.status ?? 'preview',
        'data-endgame-temporary': segment.temporary ? 'true' : 'false',
        class: 'torus-board__endgame-line',
      };
      if (style.strokeDasharray) attributes['stroke-dasharray'] = style.strokeDasharray;
      setAttributes(line, attributes);
      endgameLines.appendChild(line);
    }

    this.svg.replaceChildren(
      background,
      grid,
      hitTargets,
      stones,
      ...(this.endgameSegments.length > 0 ? [endgameLines] : []),
    );
  }

  pointFromClientPosition(x: number, y: number): PointId | null {
    if (!this.scene) return null;

    const local = this.clientToViewBox(x, y);
    if (!local) return null;
    return pointFromTorusViewBoxPosition(this.scene, local.x, local.y);
  }

  endgameGroupFromClientPosition(x: number, y: number): string | null {
    const local = this.clientToViewBox(x, y);
    if (!local) return null;
    return endgameGroupFromTorusViewBoxPosition(this.endgameSegments, local.x, local.y);
  }

  private clientToViewBox(x: number, y: number): Readonly<{ x: number; y: number }> | null {
    if (!this.scene) return null;

    const bounds = this.svg.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return null;

    return Object.freeze({
      x: ((x - bounds.left) / bounds.width) * this.scene.viewBoxSize,
      y: ((y - bounds.top) / bounds.height) * this.scene.viewBoxSize,
    });
  }
}
