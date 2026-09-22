import { expect, it } from 'vitest';
import { cube3DMotionPixelRatio, CUBE_3D_PERFORMANCE_BUDGET } from './Cube3DPerformance';

it('bounds motion fill rate on high-DPI and large displays without upscaling smaller views', () => {
  for (const [width, height, idle] of [[1100, 968, 2], [3840, 2160, 2], [640, 480, 1], [640, 480, 0.75]]) {
    const ratio = cube3DMotionPixelRatio(idle, width, height);
    expect(ratio).toBeLessThanOrEqual(idle);
    expect(ratio).toBeLessThanOrEqual(1);
    expect(width * height * ratio ** 2).toBeLessThanOrEqual(CUBE_3D_PERFORMANCE_BUDGET.motionMaxPixels + 1e-6);
  }
  expect(cube3DMotionPixelRatio(2, 1100, 968)).toBe(1);
  expect(cube3DMotionPixelRatio(0.75, 640, 480)).toBe(0.75);
});
