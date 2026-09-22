import type { CubeQuaternionState } from '../presentation/cube/Cube3DViewState';

/** Temporary presentation pose; never committed to ViewState or game history. */
export interface CubeViewTransitionFrame {
  readonly rotation: CubeQuaternionState;
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly opacity: number;
}
export interface CubeViewTransitionBridge {
  render(frame: CubeViewTransitionFrame): void;
  reset(): void;
}

export const CUBE_VIEW_TRANSITION_MS = 1400;
const smooth = (value: number): number => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

export function cubeViewTransitionMotion(progress: number) {
  const p = Math.max(0, Math.min(1, progress));
  const turn = Math.max(0, Math.min(1, (p - 0.12) / 0.88));
  return {
    fold: Math.min(1, p / 0.32),
    travel: smooth(p / 0.55),
    approach: smooth((p - 0.12) / 0.88),
    // A 200-degree excursion returns the cross face to the player. The same
    // screen-space arc is used for every logical face and every net column.
    yaw: -100 * Math.PI / 180 * Math.sin(Math.PI * turn) ** 2,
    pitch: -0.10 * Math.sin(Math.PI * turn) ** 2,
    blend: smooth((p - 0.60) / 0.30),
  };
}
