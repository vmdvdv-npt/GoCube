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

export const CUBE_VIEW_TRANSITION_MS = 1550;
const smooth = (value: number): number => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

export function cubeViewTransitionMotion(progress: number, direction: '2d' | '3d' = '3d') {
  const p = Math.max(0, Math.min(1, progress));
  const turn = p;
  return {
    turn: smooth(turn),
    fold: Math.min(1, p / 0.32),
    travel: smooth(p / 0.55),
    approach: smooth((p - 0.12) / 0.88),
    // Roughly the first quarter-turn accompanies folding, leaving ~270 degrees
    // for the assembled cube. A full path still lands on the cross face. Unfolding
    // also runs clockwise in wall-clock time rather than reversing the spin.
    yaw: (direction === '3d' ? -1 : 1) * 2 * Math.PI * smooth(turn),
    pitch: -0.10 * Math.sin(Math.PI * turn) ** 2,
    blend: smooth((p - 0.40) / 0.30),
  };
}
