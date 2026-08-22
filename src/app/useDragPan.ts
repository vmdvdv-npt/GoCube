import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

export interface DragPanOffset {
  readonly x: number;
  readonly y: number;
}

interface DragPanSession {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly origin: DragPanOffset;
  dragging: boolean;
}

export interface DragPanOptions {
  readonly constrain?: (offset: DragPanOffset) => DragPanOffset;
  readonly onDragStart?: () => void;
}

const DRAG_PAN_THRESHOLD_PX = 6;
const DRAG_PAN_INTERACTIVE_SELECTOR =
  'button, input, select, textarea, a, [data-drag-pan-ignore="true"]';

const sameOffset = (left: DragPanOffset, right: DragPanOffset): boolean =>
  left.x === right.x && left.y === right.y;

const frozenOffset = (x: number, y: number): DragPanOffset => Object.freeze({ x, y });

export function useDragPan(options: DragPanOptions = {}) {
  const { constrain, onDragStart } = options;
  const [offset, setOffsetState] = useState<DragPanOffset>(() => frozenOffset(0, 0));
  const [dragging, setDragging] = useState(false);
  const sessionRef = useRef<DragPanSession | null>(null);
  const suppressClickRef = useRef(false);
  const suppressResetTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (suppressResetTimerRef.current !== null) {
        window.clearTimeout(suppressResetTimerRef.current);
      }
    },
    [],
  );

  const constrainOffset = useCallback(
    (candidate: DragPanOffset): DragPanOffset => constrain?.(candidate) ?? candidate,
    [constrain],
  );

  const applyOffset = useCallback(
    (candidate: DragPanOffset): void => {
      const next = constrainOffset(candidate);
      setOffsetState((current) =>
        sameOffset(current, next) ? current : frozenOffset(next.x, next.y),
      );
    },
    [constrainOffset],
  );

  const reset = useCallback((): void => {
    sessionRef.current = null;
    suppressClickRef.current = false;
    setDragging(false);
    setOffsetState(frozenOffset(0, 0));
  }, []);

  const reconstrain = useCallback((): void => {
    setOffsetState((current) => {
      const next = constrainOffset(current);
      return sameOffset(current, next) ? current : frozenOffset(next.x, next.y);
    });
  }, [constrainOffset]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0) return;

      const target = event.target as Element | null;
      if (target?.closest(DRAG_PAN_INTERACTIVE_SELECTOR)) return;

      if (suppressResetTimerRef.current !== null) {
        window.clearTimeout(suppressResetTimerRef.current);
        suppressResetTimerRef.current = null;
      }
      suppressClickRef.current = false;
      sessionRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        origin: offset,
        dragging: false,
      };
    },
    [offset],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      const session = sessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;

      const deltaX = event.clientX - session.startX;
      const deltaY = event.clientY - session.startY;

      if (!session.dragging) {
        if (Math.hypot(deltaX, deltaY) < DRAG_PAN_THRESHOLD_PX) return;
        session.dragging = true;
        suppressClickRef.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        onDragStart?.();
      }

      event.preventDefault();
      applyOffset(frozenOffset(session.origin.x + deltaX, session.origin.y + deltaY));
    },
    [applyOffset, onDragStart],
  );

  const finishPointer = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    sessionRef.current = null;
    setDragging(false);

    if (session.dragging) {
      suppressResetTimerRef.current = window.setTimeout(() => {
        suppressClickRef.current = false;
        suppressResetTimerRef.current = null;
      }, 0);
    }
  }, []);

  const handleClickCapture = useCallback((event: ReactMouseEvent<HTMLDivElement>): void => {
    if (!suppressClickRef.current) return;

    suppressClickRef.current = false;
    if (suppressResetTimerRef.current !== null) {
      window.clearTimeout(suppressResetTimerRef.current);
      suppressResetTimerRef.current = null;
    }
    event.preventDefault();
    event.stopPropagation();
  }, []);

  return {
    offset,
    dragging,
    reset,
    reconstrain,
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: finishPointer,
    onPointerCancel: finishPointer,
    onClickCapture: handleClickCapture,
  } as const;
}
