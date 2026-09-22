import { describe, expect, it } from 'vitest';
import { CUBE_FACES } from '../core/topology/CubeTopology';
import { CubeOrientation } from '../presentation/cube/CubeOrientation';
import { createCube2DLayout } from '../presentation/cube/Cube2DLayout';
import { orientationAtVerticalAnchor, recenterOrientationFromVerticalAnchor } from '../presentation/cube/Cube2DNavigation';
import { cubeViewTransitionMotion } from './CubeViewTransition';

describe('cube switching motion and cross anchor', () => {
  it('uses the physical cross face and preserves net placement across a round trip in every orientation', () => {
    for (const face of CUBE_FACES) {
      for (const up of CUBE_FACES) {
        if (face === up) continue;
        let orientation: CubeOrientation;
        try { orientation = new CubeOrientation({ centerFace: face, upFace: up }); } catch { continue; }
        for (const column of [0, 1, 2, 3] as const) {
          const layout = createCube2DLayout(orientation, 3, column);
          const anchor = orientationAtVerticalAnchor(orientation, column);
          expect(anchor.centerFace).toBe(layout.rows[1][column]?.face);
          expect(anchor.rotation).toBe(layout.rows[1][column]?.rotation);
          expect(recenterOrientationFromVerticalAnchor(anchor, column).equals(orientation)).toBe(true);
        }
      }
    }
  });
  it('blends only after hinges close and while rotation is fast, then settles exactly', () => {
    const start = cubeViewTransitionMotion(0);
    const end = cubeViewTransitionMotion(1);
    expect(start.fold).toBe(0);
    expect(start.blend).toBe(0);
    expect(end.blend).toBe(1);
    expect(end.approach).toBe(1);
    expect(end.yaw).toBeCloseTo(0, 12);
    const middle = cubeViewTransitionMotion(0.75);
    expect(middle.fold).toBe(1);
    expect(middle.blend).toBeCloseTo(0.5);
    const speed = (p: number) => Math.abs(cubeViewTransitionMotion(p + 0.0001).yaw - cubeViewTransitionMotion(p).yaw) / 0.0001;
    expect(speed(0.75)).toBeGreaterThan(5);
    expect(speed(0)).toBeLessThan(0.01);
    expect(speed(0.9999)).toBeLessThan(0.01);
    expect(cubeViewTransitionMotion(0.56).yaw * 180 / Math.PI).toBeCloseTo(-100);
  });
});
