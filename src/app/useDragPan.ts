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
  readonly ignored: boolean;
  dragging: boolean;
}

export interface DragPanOptions {
  readonly constrain?: (offset: DragPanOffset) => DragPanOffset;
  readonly onDragStart?: () => void;
  readonly startOnPointerDown?: boolean;
  readonly allowInteractiveDrag?: boolean;
}

const DRAG_PAN_INTERACTIVE_SELECTOR = 'button, input, select, textarea, a';
const DRAG_PAN_ALWAYS_IGNORE_SELECTOR = '[data-drag-pan-ignore="true"]';

const sameOffset = (left: DragPanOffset, right: DragPanOffset): boolean =>
  left.x === right.x && left.y === right.y;

const frozenOffset = (x: number, y: number): DragPanOffset => Object.freeze({ x, y });

export function useDragPan(options: DragPanOptions = {}) {
  const {
    constrain,
    onDragStart,
    startOnPointerDown = false,
    allowInteractiveDrag = false,
  } = options;
  const [offset, setOffsetState] = useState<DragPanOffset>(() => frozenOffset(0, 0));
  const [dragging, setDragging] = useState(false);
  const sessionRef = useRef<DragPanSession | null>(null);
  const captureElementRef = useRef<HTMLDivElement | null>(null);
  const suppressClickRef = useRef(false);
  const suppressResetTimerRef = useRef<number | null>(null);

  const shouldIgnoreTarget = useCallback(
    (target: Element | null): boolean => {
      if (target?.closest(DRAG_PAN_ALWAYS_IGNORE_SELECTOR)) return true;
      return !allowInteractiveDrag && Boolean(target?.closest(DRAG_PAN_INTERACTIVE_SELECTOR));
    },
    [allowInteractiveDrag],
  );

  const finishPointer = useCallback((pointerId: number): void => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== pointerId) return;

    const captureElement = captureElementRef.current;
    if (captureElement?.hasPointerCapture(pointerId)) {
      captureElement.releasePointerCapture(pointerId);
    }
    captureElementRef.current = null;
    sessionRef.current = null;
    setDragging(false);

    if (session.dragging) {
      suppressResetTimerRef.current = window.setTimeout(() => {
        suppressClickRef.current = false;
        suppressResetTimerRef.current = null;
      }, 0);
    } else {
      suppressClickRef.current = false;
    }
  }, []);

  useEffect(() => {
    const handlePointerUp = (event: PointerEvent): void => finishPointer(event.pointerId);
    const handlePointerCancel = (event: PointerEvent): void => finishPointer(event.pointerId);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);

    return () => {
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      if (suppressResetTimerRef.current !== null) {
        window.clearTimeout(suppressResetTimerRef.current);
      }
    };
  }, [finishPointer]);

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
    const session = sessionRef.current;
    const captureElement = captureElementRef.current;
    if (session && captureElement?.hasPointerCapture(session.pointerId)) {
      captureElement.releasePointerCapture(session.pointerId);
    }
    captureElementRef.current = null;
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
      if (!startOnPointerDown || event.button !== 0 || (event.buttons & 1) !== 1) return;

      const previousSession = sessionRef.current;
      const captureElement = captureElementRef.current;
      if (
        previousSession &&
        captureElement?.hasPointerCapture(previousSession.pointerId)
      ) {
        captureElement.releasePointerCapture(previousSession.pointerId);
      }

      const target = event.target as Element | null;
      captureElementRef.current = null;
      sessionRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        origin: offset,
        ignored: shouldIgnoreTarget(target),
        dragging: false,
      };
      setDragging(false);
    },
    [offset, shouldIgnoreTarget, startOnPointerDown],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      if ((event.buttons & 1) !== 1) return;

      let session = sessionRef.current;
      if (!session) {
        if (startOnPointerDown) return;

        const target = event.target as Element | null;
        const movementX = Number.isFinite(event.movementX) ? event.movementX : 0;
        const movementY = Number.isFinite(event.movementY) ? event.movementY : 0;
        session = {
          pointerId: event.pointerId,
          startX: event.clientX - movementX,
          startY: event.clientY - movementY,
          origin: offset,
          ignored: shouldIgnoreTarget(target),
          dragging: false,
        };
        sessionRef.current = session;
      }

      if (session.pointerId !== event.pointerId || session.ignored) return;

      const deltaX = event.clientX - session.startX;
      const deltaY = event.clientY - session.startY;

      if (!session.dragging) {
        if (Math.hypot(deltaX, deltaY) < DRAG_PAN_THRESHOLD_PX) return;
        session.dragging = true;
        suppressClickRef.current = true;
        captureElementRef.current = event.currentTarget;
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        onDragStart?.();
      }

      event.preventDefault();
      applyOffset(frozenOffset(session.origin.x + deltaX, session.origin.y + deltaY));
    },
    [applyOffset, offset, onDragStart, shouldIgnoreTarget, startOnPointerDown],
  );

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
    // Cube can opt into an explicit pointer-down session and allow drags to begin
    // on its own buttons: a short press remains a click, while crossing the movement
    // threshold becomes pan and suppresses that click. Torus deliberately keeps the
    // move-start fallback and interactive-target ignore to protect endgame SVG clicks.
    onPointerDown: startOnPointerDown ? handlePointerDown : undefined,
    onPointerMove: handlePointerMove,
    onPointerUp: undefined,
    onPointerCancel: undefined,
    onPointerLeave: undefined,
    onClickCapture: handleClickCapture,
  } as const;
}
