export const POINTER_DRAG_THRESHOLD_PX = 6;

export const pointerMovementExceedsDragThreshold = (
  deltaX: number,
  deltaY: number,
): boolean => Math.hypot(deltaX, deltaY) >= POINTER_DRAG_THRESHOLD_PX;
