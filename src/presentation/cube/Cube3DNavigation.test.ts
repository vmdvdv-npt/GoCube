import { describe, expect, it } from 'vitest';
import { CUBE_FACES } from '../../core/topology/CubeTopology';
import { CubeOrientation } from './CubeOrientation';
import {
  cubeFaceBasis,
  dotCubeAxisVectors,
} from './CubeSurfaceMapping';
import {
  createCube3DViewState,
  cubeOrientationAnchorToQuaternion,
} from './Cube3DViewState';
import {
  CUBE_3D_STANDARD_ORIENTATION,
  CUBE_3D_STANDARD_ZOOM,
  cube3DNavigationTarget,
  cube3DResetTarget,
  type Cube3DNavigationDirection,
} from './Cube3DNavigation';

const directions: readonly Cube3DNavigationDirection[] = ['up', 'down', 'left', 'right'];

const move = (orientation: CubeOrientation, direction: Cube3DNavigationDirection): CubeOrientation => {
  switch (direction) {
    case 'up':
      return orientation.moveUp();
    case 'down':
      return orientation.moveDown();
    case 'left':
      return orientation.moveLeft();
    case 'right':
      return orientation.moveRight();
  }
};

const expectCanonicalRotation = (
  actual: ReturnType<typeof createCube3DViewState>['rotation'],
  orientation: ReturnType<CubeOrientation['toState']>,
): void => {
  const expected = cubeOrientationAnchorToQuaternion(orientation);
  expect(actual.x).toBeCloseTo(expected.x, 15);
  expect(actual.y).toBeCloseTo(expected.y, 15);
  expect(actual.z).toBeCloseTo(expected.z, 15);
  expect(actual.w).toBeCloseTo(expected.w, 15);
};

describe('Cube3DNavigation', () => {
  it('selects the correct screen-neighbor for all 24 canonical orientation anchors', () => {
    let anchors = 0;
    for (const centerFace of CUBE_FACES) {
      for (const upFace of CUBE_FACES) {
        if (
          dotCubeAxisVectors(
            cubeFaceBasis(centerFace).normal,
            cubeFaceBasis(upFace).normal,
          ) !== 0
        ) {
          continue;
        }

        const initialOrientation = new CubeOrientation({ centerFace, upFace });
        const initial = createCube3DViewState({
          orientationAnchor: initialOrientation.toState(),
          zoom: 1.7,
        });
        for (const direction of directions) {
          const expectedOrientation = move(initialOrientation, direction).toState();
          const target = cube3DNavigationTarget(initial, direction);
          expect(target.orientationAnchor).toEqual(expectedOrientation);
          expect(target.zoom).toBe(1.7);
          expectCanonicalRotation(target.rotation, expectedOrientation);
        }
        anchors += 1;
      }
    }

    expect(anchors).toBe(24);
  });

  it('quantizes arbitrary poses before resolving visual screen directions', () => {
    const sin30 = 0.5;
    const cos30 = Math.sqrt(3) / 2;
    const cases = [
      {
        rotation: { x: 0, y: sin30, z: 0, w: cos30 },
        direction: 'right' as const,
        expected: { centerFace: 'front' as const, upFace: 'top' as const },
      },
      {
        rotation: { x: -sin30, y: 0, z: 0, w: cos30 },
        direction: 'up' as const,
        expected: { centerFace: 'front' as const, upFace: 'top' as const },
      },
      {
        rotation: { x: 0, y: 0, z: sin30, w: cos30 },
        direction: 'right' as const,
        expected: { centerFace: 'bottom' as const, upFace: 'right' as const },
      },
    ];

    for (const testCase of cases) {
      const state = createCube3DViewState({ rotation: testCase.rotation, zoom: 1.25 });
      const target = cube3DNavigationTarget(state, testCase.direction);
      expect(target.orientationAnchor).toEqual(testCase.expected);
      expect(target.zoom).toBe(1.25);
      expectCanonicalRotation(target.rotation, testCase.expected);
    }
  });

  it('does not accumulate drift over repeated canonical navigation cycles', () => {
    const initial = createCube3DViewState();
    let state = initial;

    for (let cycle = 0; cycle < 100; cycle += 1) {
      state = cube3DNavigationTarget(state, 'right');
      state = cube3DNavigationTarget(state, 'right');
      state = cube3DNavigationTarget(state, 'right');
      state = cube3DNavigationTarget(state, 'right');
      state = cube3DNavigationTarget(state, 'up');
      state = cube3DNavigationTarget(state, 'down');
      state = cube3DNavigationTarget(state, 'left');
      state = cube3DNavigationTarget(state, 'right');
    }

    expect(state.orientationAnchor).toEqual(CUBE_3D_STANDARD_ORIENTATION);
    expect(state.rotation).toEqual(initial.rotation);
    expect(state.zoom).toBe(initial.zoom);
  });

  it('Reset View returns exact standard orientation and zoom', () => {
    const reset = cube3DResetTarget();
    expect(reset.orientationAnchor).toEqual(CUBE_3D_STANDARD_ORIENTATION);
    expect(reset.zoom).toBe(CUBE_3D_STANDARD_ZOOM);
    expect(reset.rotation).toEqual(createCube3DViewState().rotation);
  });
});
