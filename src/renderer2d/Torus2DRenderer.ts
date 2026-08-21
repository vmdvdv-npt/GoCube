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

export interface Torus2DVisualHit {
  readonly logicalPointId: PointId;
  readonly visualColumn: number;
  readonly visualRow: number;
  readonly pointerX: number;
  readonly pointerY: number;
}

export type Torus2DMovePreview =
  | Readonly<{
      kind: 'legal';
      logicalPointId: PointId;
      color: StoneColor;
    }>
  | Readonly<{
      kind: 'forbidden';
      logicalPointId: PointId;
      visualColumn: number;
      visualRow: number;
      pointerX: number;
      pointerY: number;
    }>;

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

export interface Torus2DCaptureEffect {
  readonly kind: 'flight' | 'fade';
  readonly logicalPointId: PointId;
  readonly color: StoneColor;
  readonly x: number;
  readonly y: number;
  readonly targetX: number;
  readonly targetY: number;
  readonly delayMs: number;
  readonly durationMs: number;
  readonly duplicate: boolean;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const VIEW_BOX_SIZE = 1000;
const BOARD_PADDING = 120;
const DUPLICATE_MARGIN = 4;
export const TORUS_PAN_ANIMATION_DURATION_MS = 240;
export const TORUS_CAPTURE_FLIGHT_STAGGER_MS = 150;
export const TORUS_CAPTURE_FLIGHT_DURATION_MS = 460;
export const TORUS_CAPTURE_DUPLICATE_FADE_DURATION_MS = 180;
export const TORUS_ENDGAME_LINE_WIDTH_PX = 2;
export const TORUS_FORBIDDEN_MARKER_SCALE = 1 / 2.25;
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

interface Torus2DPanTranslation {
  readonly x: number;
  readonly y: number;
}

const panInitialTranslation = (
  direction: Torus2DPanDirection,
  spacing: number,
): Torus2DPanTranslation => {
  switch (direction) {
    case 'left':
      return Object.freeze({ x: -spacing, y: 0 });
    case 'right':
      return Object.freeze({ x: spacing, y: 0 });
    case 'up':
      return Object.freeze({ x: 0, y: -spacing });
    case 'down':
      return Object.freeze({ x: 0, y: spacing });
  }
};

const easeInOutCubic = (progress: number): number =>
  progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2;

const easeOutCubic = (progress: number): number => 1 - Math.pow(1 - progress, 3);

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

const buildBufferedTorus2DPanScene = (
  viewModel: GameViewModel,
  baseScene: Torus2DScene,
): Torus2DScene => {
  const renderMargin = baseScene.duplicateMargin + 1;
  const byId = new Map<PointId, PointOccupancy>(
    viewModel.points.map((point) => [point.logicalPointId, point.occupancy]),
  );
  const coordinate = (index: number): number => baseScene.padding + index * baseScene.spacing;

  const scenePoint = (visualColumn: number, visualRow: number): Torus2DScenePoint => {
    const logicalPointId = pointId(
      wrap(visualColumn + baseScene.viewState.offsetX, baseScene.size),
      wrap(visualRow + baseScene.viewState.offsetY, baseScene.size),
    );
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
        visualColumn < 0 ||
        visualColumn >= baseScene.size ||
        visualRow < 0 ||
        visualRow >= baseScene.size,
    });
  };

  const visualPoints: Torus2DScenePoint[] = [];
  for (let row = -renderMargin; row < baseScene.size + renderMargin; row += 1) {
    for (let column = -renderMargin; column < baseScene.size + renderMargin; column += 1) {
      visualPoints.push(scenePoint(column, row));
    }
  }

  const gridLines: Torus2DGridLine[] = [];
  const start = coordinate(-renderMargin);
  const end = coordinate(baseScene.size - 1 + renderMargin);
  for (let index = -renderMargin; index < baseScene.size + renderMargin; index += 1) {
    const position = coordinate(index);
    gridLines.push(freezeLine({ x1: position, y1: start, x2: position, y2: end }));
    gridLines.push(freezeLine({ x1: start, y1: position, x2: end, y2: position }));
  }

  return Object.freeze({
    ...baseScene,
    duplicateMargin: renderMargin,
    visualPoints: Object.freeze(visualPoints),
    gridLines: Object.freeze(gridLines),
  });
};

export const visualPointFromTorusViewBoxPosition = (
  scene: Torus2DScene,
  x: number,
  y: number,
): Torus2DScenePoint | null => {
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

  const span = scene.size + scene.duplicateMargin * 2;
  const index = (row + scene.duplicateMargin) * span + column + scene.duplicateMargin;
  return scene.visualPoints[index] ?? null;
};

export const pointFromTorusViewBoxPosition = (
  scene: Torus2DScene,
  x: number,
  y: number,
): PointId | null =>
  visualPointFromTorusViewBoxPosition(scene, x, y)?.logicalPointId ?? null;

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

export const buildTorus2DCaptureEffects = (
  previousViewModel: GameViewModel | null,
  nextViewModel: GameViewModel,
  previousScene: Torus2DScene | null,
): readonly Torus2DCaptureEffect[] => {
  if (!previousViewModel || !previousScene) return Object.freeze([]);
  if (nextViewModel.moveNumber !== previousViewModel.moveNumber + 1) {
    return Object.freeze([]);
  }

  const blackCaptureDelta = nextViewModel.captures.black - previousViewModel.captures.black;
  const whiteCaptureDelta = nextViewModel.captures.white - previousViewModel.captures.white;
  if (blackCaptureDelta < 0 || whiteCaptureDelta < 0) return Object.freeze([]);

  const totalCaptureDelta = blackCaptureDelta + whiteCaptureDelta;
  if (totalCaptureDelta <= 0) return Object.freeze([]);

  const nextOccupancy = new Map(
    nextViewModel.points.map((point) => [point.logicalPointId, point.occupancy]),
  );
  const removed = previousViewModel.points
    .filter(
      (point) =>
        point.occupancy !== 'empty' && nextOccupancy.get(point.logicalPointId) === 'empty',
    )
    .map((point) => ({ logicalPointId: point.logicalPointId, color: point.occupancy as StoneColor }))
    .sort((left, right) => left.logicalPointId.localeCompare(right.logicalPointId));

  if (removed.length !== totalCaptureDelta) return Object.freeze([]);
  if (
    removed.some((stone) =>
      stone.color === 'white' ? blackCaptureDelta <= 0 : whiteCaptureDelta <= 0,
    )
  ) {
    return Object.freeze([]);
  }
  if (
    removed.filter((stone) => stone.color === 'white').length !== blackCaptureDelta ||
    removed.filter((stone) => stone.color === 'black').length !== whiteCaptureDelta
  ) {
    return Object.freeze([]);
  }

  const sequence = new Map<PointId, number>(
    removed.map((stone, index) => [stone.logicalPointId, index]),
  );
  const removedColor = new Map<PointId, StoneColor>(
    removed.map((stone) => [stone.logicalPointId, stone.color]),
  );
  const effects: Torus2DCaptureEffect[] = [];

  for (const point of previousScene.visualPoints) {
    const color = removedColor.get(point.logicalPointId);
    const sequenceIndex = sequence.get(point.logicalPointId);
    if (!color || sequenceIndex === undefined) continue;

    const targetX =
      color === 'white'
        ? -previousScene.stoneRadius * 1.5
        : previousScene.viewBoxSize + previousScene.stoneRadius * 1.5;
    const horizontalDistance = Math.abs(targetX - point.x);
    const upwardDistance = Math.min(
      previousScene.spacing * 1.1,
      Math.max(previousScene.spacing * 0.3, horizontalDistance * 0.16),
    );

    effects.push(
      Object.freeze({
        kind: point.duplicate ? 'fade' : 'flight',
        logicalPointId: point.logicalPointId,
        color,
        x: point.x,
        y: point.y,
        targetX,
        targetY: point.y - upwardDistance,
        delayMs: sequenceIndex * TORUS_CAPTURE_FLIGHT_STAGGER_MS,
        durationMs: point.duplicate
          ? TORUS_CAPTURE_DUPLICATE_FADE_DURATION_MS
          : TORUS_CAPTURE_FLIGHT_DURATION_MS,
        duplicate: point.duplicate,
      }),
    );
  }

  return Object.freeze(effects);
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

let torusRendererInstanceCounter = 0;

export class Torus2DRenderer implements Renderer2D {
  private scene: Torus2DScene | null = null;
  private currentViewModel: GameViewModel | null = null;
  private renderedViewModel: GameViewModel | null = null;
  private currentViewState: Torus2DViewState = DEFAULT_VIEW_STATE;
  private showDuplicateRegions = false;
  private movePreview: Torus2DMovePreview | null = null;
  private movePreviewLayer: Element | null = null;
  private endgameOverlay: Torus2DEndgameOverlay = EMPTY_ENDGAME_OVERLAY;
  private endgameSegments: readonly Torus2DEndgameSegment[] = Object.freeze([]);
  private panAnimating = false;
  private captureAnimationGeneration = 0;
  private readonly panClipPrefix: string;

  constructor(
    private readonly svg: SVGSVGElement,
    readonly size: Torus2DSize,
  ) {
    assertSupportedSize(size);
    this.panClipPrefix = `torus-pan-${torusRendererInstanceCounter}`;
    torusRendererInstanceCounter += 1;
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

  setMovePreview(preview: Torus2DMovePreview | null): void {
    this.movePreview = this.panAnimating ? null : preview;
    if (!this.panAnimating) this.renderMovePreview();
  }

  pan(direction: Torus2DPanDirection): Torus2DViewState {
    if (this.panAnimating) return this.currentViewState;

    const nextViewState = shiftTorus2DViewState(
      this.currentViewState,
      direction,
      this.size,
    );
    const viewModel = this.currentViewModel;
    const animationWindow = this.svg.ownerDocument.defaultView;

    if (!viewModel || !animationWindow || typeof animationWindow.requestAnimationFrame !== 'function') {
      this.currentViewState = nextViewState;
      if (viewModel) this.render(viewModel);
      return this.currentViewState;
    }

    const finalScene = buildTorus2DScene(
      viewModel,
      this.size,
      nextViewState,
      this.showDuplicateRegions,
    );
    this.startPanAnimation(direction, nextViewState, finalScene, animationWindow);
    return nextViewState;
  }

  render(viewModel: GameViewModel): void {
    this.currentViewModel = viewModel;
    if (this.panAnimating) return;

    const previousScene = this.scene;
    const previousRenderedViewModel = this.renderedViewModel;
    const scene = buildTorus2DScene(
      viewModel,
      this.size,
      this.currentViewState,
      this.showDuplicateRegions,
    );
    const captureEffects = buildTorus2DCaptureEffects(
      previousRenderedViewModel,
      viewModel,
      previousScene,
    );
    this.scene = scene;
    this.renderedViewModel = viewModel;
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
    this.svg.setAttribute('data-pan-animating', 'false');
    this.svg.setAttribute('aria-busy', 'false');

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

    this.movePreviewLayer = null;
    this.svg.replaceChildren(
      background,
      grid,
      hitTargets,
      stones,
      ...(this.endgameSegments.length > 0 ? [endgameLines] : []),
    );
    this.renderMovePreview();
    this.startCaptureAnimation(captureEffects);
  }

  visualPointFromClientPosition(x: number, y: number): Torus2DVisualHit | null {
    if (!this.scene) return null;

    const local = this.clientToViewBox(x, y);
    if (!local) return null;
    const point = visualPointFromTorusViewBoxPosition(this.scene, local.x, local.y);
    if (!point) return null;

    return Object.freeze({
      logicalPointId: point.logicalPointId,
      visualColumn: point.visualColumn,
      visualRow: point.visualRow,
      pointerX: local.x,
      pointerY: local.y,
    });
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

  private startCaptureAnimation(effects: readonly Torus2DCaptureEffect[]): void {
    if (effects.length === 0 || !this.scene) {
      this.svg.setAttribute('data-capture-animating', 'false');
      return;
    }

    const animationWindow = this.svg.ownerDocument.defaultView;
    if (!animationWindow || typeof animationWindow.requestAnimationFrame !== 'function') {
      this.svg.setAttribute('data-capture-animating', 'false');
      return;
    }

    const generation = this.captureAnimationGeneration + 1;
    this.captureAnimationGeneration = generation;
    const document = this.svg.ownerDocument;
    const layer = document.createElementNS(SVG_NS, 'g');
    layer.setAttribute('class', 'torus-board__capture-effects');
    layer.setAttribute('pointer-events', 'none');
    const animated = effects.map((effect) => {
      const stone = document.createElementNS(SVG_NS, 'circle');
      setAttributes(stone, {
        cx: String(effect.x),
        cy: String(effect.y),
        r: String(this.scene!.stoneRadius),
        fill: effect.color === 'black' ? '#111111' : '#f5f5f2',
        stroke: '#111111',
        'stroke-width': '2',
        'vector-effect': 'non-scaling-stroke',
        'pointer-events': 'none',
        opacity: '1',
        'data-logical-point-id': effect.logicalPointId,
        'data-occupancy': effect.color,
        'data-copy-role': effect.duplicate ? 'duplicate' : 'primary',
        'data-capture-effect': effect.kind,
        'data-capture-direction': effect.color === 'white' ? 'left' : 'right',
        'data-capture-delay-ms': String(effect.delayMs),
        class: `torus-board__captured-stone torus-board__captured-stone--${effect.kind} torus-board__captured-stone--${effect.color}`,
      });
      layer.appendChild(stone);
      return Object.freeze({ effect, stone });
    });

    this.svg.appendChild(layer);
    this.svg.setAttribute('data-capture-animating', 'true');
    this.svg.setAttribute(
      'data-capture-count',
      String(new Set(effects.map((effect) => effect.logicalPointId)).size),
    );

    const animationEnd = Math.max(
      ...effects.map((effect) => effect.delayMs + effect.durationMs),
    );
    let startedAt: number | null = null;

    const frame = (timestamp: number): void => {
      if (generation !== this.captureAnimationGeneration) {
        layer.remove();
        return;
      }
      if (startedAt === null) startedAt = timestamp;
      const elapsed = timestamp - startedAt;

      for (const { effect, stone } of animated) {
        const localElapsed = elapsed - effect.delayMs;
        const progress = Math.max(0, Math.min(1, localElapsed / effect.durationMs));
        if (effect.kind === 'fade') {
          stone.setAttribute('opacity', String(1 - easeInOutCubic(progress)));
          continue;
        }

        const eased = easeOutCubic(progress);
        const dx = (effect.targetX - effect.x) * eased;
        const dy = (effect.targetY - effect.y) * eased;
        stone.setAttribute('transform', `translate(${dx} ${dy})`);
        const fadeProgress = progress <= 0.78 ? 0 : (progress - 0.78) / 0.22;
        stone.setAttribute('opacity', String(1 - Math.min(1, fadeProgress)));
      }

      if (elapsed < animationEnd) {
        animationWindow.requestAnimationFrame(frame);
        return;
      }

      layer.remove();
      if (generation === this.captureAnimationGeneration) {
        this.svg.setAttribute('data-capture-animating', 'false');
      }
    };

    animationWindow.requestAnimationFrame(frame);
  }

  private startPanAnimation(
    direction: Torus2DPanDirection,
    nextViewState: Torus2DViewState,
    finalScene: Torus2DScene,
    animationWindow: Window,
  ): void {
    const viewModel = this.currentViewModel;
    if (!viewModel) return;

    const transitionScene = buildBufferedTorus2DPanScene(viewModel, finalScene);
    const transitionSegments = buildTorus2DEndgameSegments(
      transitionScene,
      this.endgameOverlay,
    );
    const animatedLayers = this.renderPanTransition(
      transitionScene,
      finalScene,
      transitionSegments,
    );
    const initialTranslation = panInitialTranslation(direction, finalScene.spacing);
    const previousPointerEvents = this.svg.style.pointerEvents;

    this.panAnimating = true;
    this.movePreview = null;
    this.movePreviewLayer = null;
    this.svg.style.pointerEvents = 'none';
    this.svg.setAttribute('data-pan-animating', 'true');
    this.svg.setAttribute('data-pan-direction', direction);
    this.svg.setAttribute('aria-busy', 'true');

    const applyTranslation = (x: number, y: number): void => {
      const transform = `translate(${x} ${y})`;
      for (const layer of animatedLayers) layer.setAttribute('transform', transform);
    };
    applyTranslation(initialTranslation.x, initialTranslation.y);

    let startedAt: number | null = null;
    const frame = (timestamp: number): void => {
      if (startedAt === null) startedAt = timestamp;
      const progress = Math.min(
        1,
        (timestamp - startedAt) / TORUS_PAN_ANIMATION_DURATION_MS,
      );
      const remaining = 1 - easeInOutCubic(progress);
      applyTranslation(
        initialTranslation.x * remaining,
        initialTranslation.y * remaining,
      );

      if (progress < 1) {
        animationWindow.requestAnimationFrame(frame);
        return;
      }

      this.currentViewState = nextViewState;
      this.panAnimating = false;
      this.svg.style.pointerEvents = previousPointerEvents;
      this.svg.setAttribute('data-pan-animating', 'false');
      this.svg.setAttribute('aria-busy', 'false');

      const latestViewModel = this.currentViewModel;
      if (latestViewModel) this.render(latestViewModel);
    };

    animationWindow.requestAnimationFrame(frame);
  }

  private renderPanTransition(
    transitionScene: Torus2DScene,
    visibleScene: Torus2DScene,
    endgameSegments: readonly Torus2DEndgameSegment[],
  ): readonly SVGGElement[] {
    const document = this.svg.ownerDocument;
    const background = document.createElementNS(SVG_NS, 'rect');
    setAttributes(background, {
      x: '0',
      y: '0',
      width: String(visibleScene.viewBoxSize),
      height: String(visibleScene.viewBoxSize),
      fill: '#d8ad68',
      class: 'torus-board__background',
    });

    const visibleStart =
      visibleScene.padding - visibleScene.duplicateMargin * visibleScene.spacing;
    const visibleEnd =
      visibleScene.padding +
      (visibleScene.size - 1 + visibleScene.duplicateMargin) * visibleScene.spacing;
    const visibleSpan = visibleEnd - visibleStart;

    const defs = document.createElementNS(SVG_NS, 'defs');
    const gridClipId = `${this.panClipPrefix}-grid`;
    const piecesClipId = `${this.panClipPrefix}-pieces`;

    const gridClip = document.createElementNS(SVG_NS, 'clipPath');
    gridClip.setAttribute('id', gridClipId);
    gridClip.setAttribute('clipPathUnits', 'userSpaceOnUse');
    const gridClipRect = document.createElementNS(SVG_NS, 'rect');
    setAttributes(gridClipRect, {
      x: String(visibleStart),
      y: String(visibleStart),
      width: String(visibleSpan),
      height: String(visibleSpan),
    });
    gridClip.appendChild(gridClipRect);
    defs.appendChild(gridClip);

    const piecesClip = document.createElementNS(SVG_NS, 'clipPath');
    piecesClip.setAttribute('id', piecesClipId);
    piecesClip.setAttribute('clipPathUnits', 'userSpaceOnUse');
    const piecesClipRect = document.createElementNS(SVG_NS, 'rect');
    const pieceOverflow = visibleScene.stoneRadius + 2;
    setAttributes(piecesClipRect, {
      x: String(visibleStart - pieceOverflow),
      y: String(visibleStart - pieceOverflow),
      width: String(visibleSpan + pieceOverflow * 2),
      height: String(visibleSpan + pieceOverflow * 2),
    });
    piecesClip.appendChild(piecesClipRect);
    defs.appendChild(piecesClip);

    const gridViewport = document.createElementNS(SVG_NS, 'g');
    gridViewport.setAttribute('class', 'torus-board__pan-viewport torus-board__pan-viewport--grid');
    gridViewport.setAttribute('clip-path', `url(#${gridClipId})`);
    gridViewport.setAttribute('pointer-events', 'none');
    const gridContent = document.createElementNS(SVG_NS, 'g');
    gridContent.setAttribute('class', 'torus-board__pan-content torus-board__pan-content--grid');
    const grid = document.createElementNS(SVG_NS, 'g');
    grid.setAttribute('class', 'torus-board__grid');
    for (const lineData of transitionScene.gridLines) {
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
    gridContent.appendChild(grid);
    gridViewport.appendChild(gridContent);

    const piecesViewport = document.createElementNS(SVG_NS, 'g');
    piecesViewport.setAttribute(
      'class',
      'torus-board__pan-viewport torus-board__pan-viewport--pieces',
    );
    piecesViewport.setAttribute('clip-path', `url(#${piecesClipId})`);
    piecesViewport.setAttribute('pointer-events', 'none');
    const piecesContent = document.createElementNS(SVG_NS, 'g');
    piecesContent.setAttribute(
      'class',
      'torus-board__pan-content torus-board__pan-content--pieces',
    );

    const stones = document.createElementNS(SVG_NS, 'g');
    stones.setAttribute('class', 'torus-board__stones');
    for (const point of transitionScene.visualPoints) {
      if (point.occupancy === 'empty') continue;

      const stone = document.createElementNS(SVG_NS, 'circle');
      setAttributes(stone, {
        cx: String(point.x),
        cy: String(point.y),
        r: String(transitionScene.stoneRadius),
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
    piecesContent.appendChild(stones);

    if (endgameSegments.length > 0) {
      const endgameLines = document.createElementNS(SVG_NS, 'g');
      endgameLines.setAttribute('class', 'torus-board__endgame-lines');
      for (const segment of endgameSegments) {
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
      piecesContent.appendChild(endgameLines);
    }

    piecesViewport.appendChild(piecesContent);
    this.svg.replaceChildren(background, defs, gridViewport, piecesViewport);
    return Object.freeze([gridContent, piecesContent]);
  }

  private renderMovePreview(): void {
    if (this.movePreviewLayer) {
      this.movePreviewLayer.replaceChildren();
    }

    const scene = this.scene;
    const preview = this.movePreview;
    if (!scene || !preview) return;

    const document = this.svg.ownerDocument;
    const layer =
      this.movePreviewLayer ?? document.createElementNS(SVG_NS, 'g');
    if (!this.movePreviewLayer) {
      layer.setAttribute('class', 'torus-board__move-preview');
      layer.setAttribute('pointer-events', 'none');
      this.svg.appendChild(layer);
      this.movePreviewLayer = layer;
    }

    if (preview.kind === 'legal') {
      for (const point of scene.visualPoints) {
        if (point.logicalPointId !== preview.logicalPointId || point.occupancy !== 'empty') {
          continue;
        }

        const stone = document.createElementNS(SVG_NS, 'circle');
        setAttributes(stone, {
          cx: String(point.x),
          cy: String(point.y),
          r: String(scene.stoneRadius),
          fill: preview.color === 'black' ? '#111111' : '#f5f5f2',
          stroke: '#111111',
          'stroke-width': '2',
          'vector-effect': 'non-scaling-stroke',
          'pointer-events': 'none',
          opacity: '0.5',
          'data-logical-point-id': point.logicalPointId,
          'data-copy-role': point.duplicate ? 'duplicate' : 'primary',
          class: `torus-board__preview-stone torus-board__preview-stone--${preview.color}`,
        });
        layer.appendChild(stone);
      }
      return;
    }

    const hoveredCopy = scene.visualPoints.find(
      (point) =>
        point.logicalPointId === preview.logicalPointId &&
        point.visualColumn === preview.visualColumn &&
        point.visualRow === preview.visualRow,
    );
    if (!hoveredCopy || hoveredCopy.occupancy !== 'empty') return;

    const marker = document.createElementNS(SVG_NS, 'circle');
    setAttributes(marker, {
      cx: String(preview.pointerX),
      cy: String(preview.pointerY),
      r: String(scene.stoneRadius * TORUS_FORBIDDEN_MARKER_SCALE),
      fill: '#ff0000',
      stroke: 'none',
      opacity: '1',
      'pointer-events': 'none',
      'data-logical-point-id': preview.logicalPointId,
      'data-copy-role': hoveredCopy.duplicate ? 'duplicate' : 'primary',
      class: 'torus-board__forbidden-marker',
    });
    layer.appendChild(marker);
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
