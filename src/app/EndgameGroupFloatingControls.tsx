import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { GroupStatus } from '../core/endgame/EndgameClassifier';
import type { PointId } from '../core/topology/Topology';
import type { EndgameGroupPresentation } from '../presentation/EndgameGroupPresentation';
import type { SharedEndgameDecisions } from './GameSessionControllerFacade';
import './endgame-group-floating-controls.css';

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

const ENDGAME_STATUSES: readonly GroupStatus[] = Object.freeze(['alive', 'dead', 'seki']);
const CONTROL_GAP_PX = 10;
const VIEWPORT_INSET_PX = 8;
const RENDERED_STONE_SELECTOR = [
  '.cube-2d-stone[data-logical-point-id][data-occupancy]',
  '.torus-board__stone[data-logical-point-id][data-occupancy][data-copy-role="primary"]',
].join(', ');

const statusLabel = (status: GroupStatus): string =>
  status === 'alive' ? 'Alive' : status === 'dead' ? 'Dead' : 'Seki';

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

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
  const left = Math.max(
    VIEWPORT_INSET_PX,
    sidebarRect ? sidebarRect.right + columnGap : gameRect.left,
  );
  const top = Math.max(VIEWPORT_INSET_PX, gameRect.top);
  const right = Math.min(window.innerWidth - VIEWPORT_INSET_PX, gameRect.right);
  const bottom = Math.min(window.innerHeight - VIEWPORT_INSET_PX, gameRect.bottom);

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

const visibleStoneBounds = (
  available: Bounds,
  excludedPointIds: ReadonlySet<PointId>,
): readonly Bounds[] =>
  Object.freeze(
    [...document.querySelectorAll<Element>(RENDERED_STONE_SELECTOR)].flatMap((element) => {
      const pointId = element.getAttribute('data-logical-point-id');
      if (!pointId || excludedPointIds.has(pointId)) return [];
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return [];
      const visible = intersectBounds(rectToBounds(rect), available);
      return visible ? [visible] : [];
    }),
  );

const cube3DSelectionAnchorBounds = (available: Bounds): Bounds | null => {
  const canvas = document.querySelector<HTMLElement>('[data-testid="cube-3d-canvas"]');
  if (!canvas) return null;

  const visibleCanvas = intersectBounds(rectToBounds(canvas.getBoundingClientRect()), available);
  if (!visibleCanvas) return null;

  const centerX = (visibleCanvas.left + visibleCanvas.right) / 2;
  const centerY = (visibleCanvas.top + visibleCanvas.bottom) / 2;
  return Object.freeze({
    left: centerX - 0.5,
    top: centerY - 0.5,
    right: centerX + 0.5,
    bottom: centerY + 0.5,
    width: 1,
    height: 1,
  });
};

const groupBounds = (
  pointIds: ReadonlySet<PointId>,
  available: Bounds,
): Bounds | null => {
  const rawRects: Bounds[] = [];

  for (const element of document.querySelectorAll<Element>(RENDERED_STONE_SELECTOR)) {
    const pointId = element.getAttribute('data-logical-point-id');
    if (!pointId || !pointIds.has(pointId)) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    rawRects.push(rectToBounds(rect));
  }

  // WebGL stones intentionally do not have a per-stone DOM projection. The
  // selected group is already highlighted inside ThreeScene, so keep the shared
  // status control usable by anchoring it to the active 3D viewport rather than
  // introducing a second point-to-screen projection model just for this control.
  if (rawRects.length === 0) return cube3DSelectionAnchorBounds(available);
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
  obstacle: Bounds,
): number => {
  const overlapWidth = Math.max(
    0,
    Math.min(left + width, obstacle.right) - Math.max(left, obstacle.left),
  );
  const overlapHeight = Math.max(
    0,
    Math.min(top + height, obstacle.bottom) - Math.max(top, obstacle.top),
  );
  return overlapWidth * overlapHeight;
};

const obstacleOverlap = (
  left: number,
  top: number,
  width: number,
  height: number,
  obstacles: readonly Bounds[],
): number =>
  obstacles.reduce(
    (total, obstacle) => total + overlapArea(left, top, width, height, obstacle),
    0,
  );

const positionControl = (
  group: Bounds,
  available: Bounds,
  width: number,
  height: number,
  obstacles: readonly Bounds[],
): PositionedControl => {
  const centerX = (group.left + group.right) / 2;
  const centerY = (group.top + group.bottom) / 2;
  const centered: readonly PositionedControl[] = Object.freeze([
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
  const nudgeFactors = [-0.75, 0.75, -1.5, 1.5] as const;
  const nudged: PositionedControl[] = [];
  for (const factor of nudgeFactors) {
    nudged.push(
      Object.freeze({
        placement: 'top',
        left: centered[0].left + width * factor,
        top: centered[0].top,
      }),
      Object.freeze({
        placement: 'bottom',
        left: centered[1].left + width * factor,
        top: centered[1].top,
      }),
      Object.freeze({
        placement: 'left',
        left: centered[2].left,
        top: centered[2].top + height * factor,
      }),
      Object.freeze({
        placement: 'right',
        left: centered[3].left,
        top: centered[3].top + height * factor,
      }),
    );
  }
  const candidates = Object.freeze([...centered, ...nudged]);

  const fitting = candidates.find(
    (candidate) =>
      fits(candidate.left, candidate.top, width, height, available) &&
      obstacleOverlap(candidate.left, candidate.top, width, height, obstacles) === 0,
  );
  if (fitting) return fitting;

  const maxLeft = Math.max(available.left, available.right - width);
  const maxTop = Math.max(available.top, available.bottom - height);
  const clamped = candidates.map((candidate, preference) => {
    const left = clamp(candidate.left, available.left, maxLeft);
    const top = clamp(candidate.top, available.top, maxTop);
    return Object.freeze({
      placement: candidate.placement,
      left,
      top,
      overlap: obstacleOverlap(left, top, width, height, obstacles),
      selectedGroupOverlap: overlapArea(left, top, width, height, group),
      preference,
    });
  });
  const best = clamped.reduce((current, candidate) => {
    if (candidate.overlap !== current.overlap) {
      return candidate.overlap < current.overlap ? candidate : current;
    }
    if (candidate.selectedGroupOverlap !== current.selectedGroupOverlap) {
      return candidate.selectedGroupOverlap < current.selectedGroupOverlap ? candidate : current;
    }
    return candidate.preference < current.preference ? candidate : current;
  });
  return Object.freeze({ placement: best.placement, left: best.left, top: best.top });
};

export interface EndgameGroupFloatingControlsProps {
  readonly selectedGroup: EndgameGroupPresentation | null;
  readonly decisions: SharedEndgameDecisions;
  readonly onDecision: (groupId: string, status: GroupStatus) => void | Promise<void>;
}

/**
 * Screen-space endgame controls for the currently selected logical group.
 *
 * Logical identity comes exclusively from the shared review state. DOM is used
 * only for renderer presentation: 2D/Torus measure the selected stone elements,
 * while Cube 3D uses its active WebGL viewport as the minimal control anchor.
 */
export function EndgameGroupFloatingControls({
  selectedGroup,
  decisions,
  onDecision,
}: EndgameGroupFloatingControlsProps) {
  const controlRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!selectedGroup) return undefined;

    const selectedPointIds = new Set<PointId>(selectedGroup.points);
    let frame: number | null = null;

    const syncPosition = (): void => {
      const control = controlRef.current;
      const available = availableGameBounds();
      if (!control || !available) {
        frame = requestAnimationFrame(syncPosition);
        return;
      }

      const group = groupBounds(selectedPointIds, available);
      const controlRect = control.getBoundingClientRect();
      if (!group || controlRect.width <= 0 || controlRect.height <= 0) {
        control.style.visibility = 'hidden';
        frame = requestAnimationFrame(syncPosition);
        return;
      }

      const position = positionControl(
        group,
        available,
        controlRect.width,
        controlRect.height,
        visibleStoneBounds(available, selectedPointIds),
      );
      control.style.left = `${position.left.toFixed(1)}px`;
      control.style.top = `${position.top.toFixed(1)}px`;
      control.style.visibility = 'visible';
      control.dataset.placement = position.placement;
      frame = requestAnimationFrame(syncPosition);
    };

    frame = requestAnimationFrame(syncPosition);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [selectedGroup]);

  if (!selectedGroup || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={controlRef}
      className="endgame-statuses"
      role="group"
      aria-label="Selected group status"
      data-testid="endgame-group-control"
      data-floating-endgame-control="true"
      data-group-point-count={selectedGroup.points.length}
      style={{ visibility: 'hidden' }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      {ENDGAME_STATUSES.map((status) => (
        <button
          type="button"
          key={status}
          className={decisions[selectedGroup.id] === status ? 'is-selected' : undefined}
          aria-pressed={decisions[selectedGroup.id] === status}
          onClick={() => void onDecision(selectedGroup.id, status)}
        >
          {statusLabel(status)}
        </button>
      ))}
    </div>,
    document.body,
  );
}
