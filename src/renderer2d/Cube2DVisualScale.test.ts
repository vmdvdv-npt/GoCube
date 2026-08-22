import { describe, expect, it } from 'vitest';
import {
  CUBE_2D_FORBIDDEN_MARKER_SCALE,
  cube2DContentScale,
} from './Cube2DRenderer';
import { TORUS_FORBIDDEN_MARKER_SCALE } from './Torus2DRenderer';

describe('Cube 2D visual scale contract', () => {
  it.each([
    [2, 0.88],
    [3, 0.88],
    [4, 0.88],
    [5, 0.86],
    [6, 0.86],
    [7, 0.86],
  ] as const)('uses the approved content scale for %dx%d', (size, expectedScale) => {
    expect(cube2DContentScale(size)).toBe(expectedScale);
  });

  it('keeps the Cube forbidden marker proportion aligned with Torus 2D', () => {
    expect(CUBE_2D_FORBIDDEN_MARKER_SCALE).toBe(TORUS_FORBIDDEN_MARKER_SCALE);
    expect(CUBE_2D_FORBIDDEN_MARKER_SCALE).toBeCloseTo(0.4444444444, 9);
  });
});
