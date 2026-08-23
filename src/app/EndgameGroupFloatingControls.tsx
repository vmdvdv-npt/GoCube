import { useEffect, useRef } from 'react';
import type { PointId, Topology } from '../core/topology/Topology';
import { CubeTopology } from '../core/topology/CubeTopology';
import { TORUS_SIZES, TorusTopology, type TorusSize } from '../core/topology/TorusTopology';
import './endgame-group-floating-controls.css';

type SurfaceMode = 'torus' | 'cube';
type StoneColor = 'black' | 'white';

type GroupSelection = Readonly<{
  mode: SurfaceMode;
  pointIds: readonly PointId[];
}>;

type Bounds = Readonly<{
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}>;

type Placement = 'top' | 'bottom' | 'left' | 'right';

type PositionedControl = Readonly<{
  left: number;
  top: number;
  placement: Placement;
}>;

const CONTROL_GAP_PX = 10;
const VIEWPORT_INSET_PX = 8;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const surfaceMode = (): SurfaceMode =>
  document.querySelector('.cube-2d-game') ? 'cube' : 'torus';

const stoneSelector = (mode: SurfaceMode): string =>
  mode === 'cube'
    ? '.cube-2d-stone[data-logical-point-id][data-occupancy]'
    : '.torus-board__stone[data-logical-point-id][data-occupancy][data-copy-role="primary"]';

const occupancyForMode = (mode: SurfaceMode): ReadonlyMap<PointId, StoneColor> => {
  const occupancy = new Map<PointId, StoneColor>();
  for (const element of document.querySelectorAll<Element>(stoneSelector(mode))) {
    const pointId = element.getAttribute('data-logical-point-id');
    const color = element.getAttribute('data-occupancy');
    if (!pointId || (color !== 'black' && color !== 'white')) continue;
    occupancy.set(pointId, color);
  }
  return occupancy;
};

const cubeSize = (): number | null => {
  const value = Number(
    document.querySelector('.cube-2d-renderer')?.getAttribute('data-cube-size'),
  );
  return Number.isSafeInteger(value) && value >= 2 ? value : null;
};

const torusSize = (): TorusSize | null => {
  const primaryPointCount = document.querySelectorAll(
    '.torus-board__hit-target[data-copy-role="primary"]',
  ).length;
  const value = Math.round(Math.sqrt(primaryPointCount));
  return TORUS_SIZES.includes(value as TorusSize) ? (value as TorusSize) : null;
};

const topologyForMode = (mode: SurfaceMode): Topology | null => {
  if (mode === 'cube') {
    const size = cubeSize();
    return size === null ? null : new CubeTopology(size);
  }

  const size = torusSize();
  return size === null ? null : new TorusTopology(size);
};

const logicalGroupForPoint = (pointId: PointId): GroupSelection | null => {
  if (!document.querySelector('.endgame-panel')) return null;

  const mode = surfaceMode();
  const occupancy = occupancyForMode(mode);
  const color = occupancy.get(pointId);
  const topology = topologyForMode(mode);
  if (!color || !topology?.has(pointId)) return null;

  const points: PointId[] = [];
  const visited = new Set<PointId>();
  const queue: PointId[] = [pointId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    if (occupancy.get(current) !== color) continue;
    points.push(current);

    for (const neighbor of topology.neighbors(current)) {
      if (!visited.has(neighbor) && occupancy.get(neighbor) === color) queue.push(neighbor);
    }
  }

  return points.length > 0
    ? Object.freeze({ mode, pointIds: Object.freeze(points) })
    : null;
};

const pointIdFromClick = (target: EventTarget | null): PointId | null => {
  if (!(target instanceof Element)) return null;
  const element = target.closest(
    '[data-logical-point-id], .cube-2d-hit-area[data-point-id]',
  );
  return (
    element?.getAttribute('data-logical-point-id') ??
    element?.getAttribute('data-point-id') ??
    null
  );
};

const rectToBounds = (rect: DOMRect): Bounds =>
  Object.freeze({
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  });

const intersectBounds = (left: Bounds, right: Bounds): Bounds | null => {
  const x1 = Math.max(left.left, right.left);
  const y1 = Math.max(left.top, right.top);
  const x2 = Math.min(left.right, right.right);
  const y2 = Math.min(left.bottom, right.bottom);
  if (x2 <= x1 || y2 <= y1) return null;
  return Object.freeze({
    left: x1,
    top: y1,
    right: x2,
    bottom: y2,
    width: x2 - x1,
    height: y2 - y1,
  });
};

const unionBounds = (rects: readonly Bounds[]): Bounds | null => {
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return Object.freeze({
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  });
};

const availableGameBounds = (): Bounds | null => {
  const game = document.querySelector<HTMLElement>('.torus-game');
  if (!game) return null;

  const gameRect = game.getBoundingClientRect();
  const sidebarRect = document.querySelector<HTMLElement>('.game-summary')?.getBoundingClientRect();
  const columnGap = Number.parseFloat(getComputedStyle(game).columnGap || '0') || 0;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const left = Math.max(
    VIEWPORT_INSET_PX,
    sidebarRect ? sidebarRect.right + columnGap : gameRect.left,
  );
  const top = Math.max(VIEWPORT_INSET_PX, gameRect.top);
  const right = Math.min(viewportWidth - VIEWPORT_INSET_PX, gameRect.right);
  const bottom = Math.min(viewportHeight - VIEWPORT_INSET_PX, gameRect.bottom);

  if (right <= left || bottom <= top) return null;
  return Object.freeze({
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  });
};

const groupBounds = (selection: GroupSelection, available: Bounds): Bounds | null => {
  const pointIds = new Set(selection.pointIds);
  const rawRects: Bounds[] = [];

  for (const element of document.querySelectorAll<Element>(stoneSelector(selection.mode))) {
    const pointId = element.getAttribute('data-logical-point-id');
    if (!pointId || !pointIds.has(pointId)) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    rawRects.push(rectToBounds(rect));
  }

  if (rawRects.length === 0) return null;
  const visibleRects = rawRects.flatMap((rect) => {
    const clipped = intersectBounds(rect, available);
    return clipped ? [clipped] : [];
  });
  return unionBounds(visibleRects.length > 0 ? visibleRects : rawRects);
};

const fits = (
  left: number,
  top: number,
  width: number,
  height: number,
  available: Bounds,
): boolean =>
  left >= available.left &&
  top >= available.top &&
  left + width <= available.right &&
  top + height <= available.bottom;

const overlapArea = (
  left: number,
  top: number,
  width: number,
  height: number,
  group: Bounds,
): number => {
  const overlapWidth = Math.max(0, Math.min(left + width, group.right) - Math.max(left, group.left));
  const overlapHeight = Math.max(0, Math.min(top + height, group.bottom) - Math.max(top, group.top));
  return overlapWidth * overlapHeight;
};

const positionControl = (
  group: Bounds,
  available: Bounds,
  width: number,
  height: number,
): PositionedControl => {
  const centerX = (group.left + group.right) / 2;
  const centerY = (group.top + group.bottom) / 2;
  const candidates: readonly PositionedControl[] = Object.freeze([
    Object.freeze({
      placement: 'top',
      left: centerX - width / 2,
      top: group.top - CONTROL_GAP_PX - height,
    }),
    Object.freeze({
      placement: 'bottom',
      left: centerX - width / 2,
      top: group.bottom + CONTROL_GAP_PX,
    }),
    Object.freeze({
      placement: 'left',
      left: group.left - CONTROL_GAP_PX - width,
      top: centerY - height / 2,
    }),
    Object.freeze({
      placement: 'right',
      left: group.right + CONTROL_GAP_PX,
      top: centerY - height / 2,
    }),
  ]);

  const fitting = candidates.find((candidate) =>
    fits(candidate.left, candidate.top, width, height, available),
  );
  if (fitting) return fitting;

  const maxLeft = Math.max(available.left, available.right - width);
  const maxTop = Math.max(available.top, available.bottom - height);
  const clamped = candidates.map((candidate) => {
    const left = clamp(candidate.left, available.left, maxLeft);
    const top = clamp(candidate.top, available.top, maxTop);
    return Object.freeze({
      placement: candidate.placement,
      left,
      top,
      overlap: overlapArea(left, top, width, height, group),
    });
  });
  const best = clamped.reduce((current, candidate) =>
    candidate.overlap < current.overlap ? candidate : current,
  );
  return Object.freeze({ placement: best.placement, left: best.left, top: best.top });
};

const clearFloatingState = (control: HTMLElement): void => {
  control.removeAttribute('data-floating-endgame-control');
  control.removeAttribute('data-placement');
  control.removeAttribute('data-group-point-count');
  control.removeAttribute('data-testid');
  control.style.removeProperty('left');
  control.style.removeProperty('top');
  control.style.removeProperty('visibility');
};

const hideAllFloatingControls = (): void => {
  for (const control of document.querySelectorAll<HTMLElement>(
    '.endgame-statuses[data-floating-endgame-control="true"]',
  )) {
    clearFloatingState(control);
  }
};

const syncFloatingControl = (selection: GroupSelection): boolean => {
  if (!document.querySelector('.endgame-panel')) return false;
  const control = document.querySelector<HTMLElement>(
    '.endgame-selection .endgame-statuses',
  );
  const available = availableGameBounds();
  if (!control || !available) return false;

  control.setAttribute('data-floating-endgame-control', 'true');
  control.setAttribute('data-testid', 'endgame-group-control');
  control.setAttribute('data-group-point-count', String(selection.pointIds.length));
  if (control.getAttribute('data-floating-wheel-guard') !== 'true') {
    control.setAttribute('data-floating-wheel-guard', 'true');
    control.addEventListener('wheel', (event) => event.stopPropagation());
  }

  control.style.visibility = 'hidden';
  const controlRect = control.getBoundingClientRect();
  const group = groupBounds(selection, available);
  if (!group || controlRect.width <= 0 || controlRect.height <= 0) {
    control.style.visibility = 'visible';
    return true;
  }

  const position = positionControl(
    group,
    available,
    controlRect.width,
    controlRect.height,
  );
  control.style.left = `${position.left.toFixed(1)}px`;
  control.style.top = `${position.top.toFixed(1)}px`;
  control.setAttribute('data-placement', position.placement);
  control.style.visibility = 'visible';
  return true;
};

/**
 * Presentation-only bridge that spatially attaches the existing Endgame Review
 * status controls to the logical group selected on the board. The real buttons
 * stay owned by TorusGameBase/Cube2DGame, so controller, autosave and manual
 * override semantics remain unchanged.
 */
export function EndgameGroupFloatingControls() {
  const selectionRef = useRef<GroupSelection | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const stopTracking = (): void => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      selectionRef.current = null;
      hideAllFloatingControls();
    };

    const track = (): void => {
      const selection = selectionRef.current;
      if (!selection || !syncFloatingControl(selection)) {
        stopTracking();
        return;
      }
      frameRef.current = requestAnimationFrame(track);
    };

    const startTracking = (): void => {
      if (frameRef.current !== null) return;
      frameRef.current = requestAnimationFrame(track);
    };

    const handleDocumentClick = (event: MouseEvent): void => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('.endgame-statuses[data-floating-endgame-control="true"]')
      ) {
        return;
      }

      const pointId = pointIdFromClick(target);
      if (!pointId) return;
      const selection = logicalGroupForPoint(pointId);
      if (!selection) return;
      selectionRef.current = selection;
      startTracking();
    };

    document.addEventListener('click', handleDocumentClick);
    return () => {
      document.removeEventListener('click', handleDocumentClick);
      stopTracking();
    };
  }, []);

  return null;
}
