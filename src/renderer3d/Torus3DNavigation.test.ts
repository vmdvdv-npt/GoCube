import { describe, expect, it } from 'vitest';
import { TORUS_SIZES, type TorusSize } from '../core/topology/TorusTopology';
import {
  createTorusSpatialAnchor,
  moveTorusSpatialAnchor,
  torus2DOffsetForSpatialAnchor,
  torusSpatialAnchorFrom2DOffset,
} from '../presentation/TorusSpatialAnchor';
import { createTorus3DViewState } from '../presentation/Torus3DViewState';
import {
  TORUS_3D_STANDARD_ZOOM,
  torus3DCanonicalRotationForAnchor,
  torus3DFrontFacingAnchor,
  torus3DNavigationTarget,
  torus3DResetTarget,
  torus3DViewTargetForAnchor,
  type Torus3DNavigationDirection,
} from './Torus3DNavigation';

const expectSameAnchor = (
  actual: Readonly<{ row: number; column: number }>,
  expected: Readonly<{ row: number; column: number }>,
): void => {
  expect(actual.row).toBe(expected.row);
  expect(actual.column).toBe(expected.column);
};

describe('renderer-neutral Torus spatial anchor', () => {
  for (const size of TORUS_SIZES) {
    it(`round-trips logical 2D offsets for ${size}x${size}`, () => {
      for (const row of [0, 1, size - 1]) {
        for (const column of [0, 1, size - 1]) {
          const anchor = createTorusSpatialAnchor(size, row, column);
          expectSameAnchor(
            torusSpatialAnchorFrom2DOffset(size, torus2DOffsetForSpatialAnchor(size, anchor)),
            anchor,
          );
        }
      }
    });
  }
});

describe('Torus 3D spatial mapping', () => {
  for (const size of TORUS_SIZES) {
    it(`maps canonical ${size}x${size} anchors back to the same front-facing region`, () => {
      const samples = [
        createTorusSpatialAnchor(size, 0, 0),
        createTorusSpatialAnchor(size, 0, size - 1),
        createTorusSpatialAnchor(size, size - 1, 0),
        createTorusSpatialAnchor(size, size - 1, size - 1),
        createTorusSpatialAnchor(size, Math.floor(size / 2), Math.floor(size / 2)),
      ];
      for (const anchor of samples) {
        const rotation = torus3DCanonicalRotationForAnchor(size, anchor);
        expectSameAnchor(torus3DFrontFacingAnchor(size, rotation), anchor);
      }
    });
  }

  it('preserves manual zoom when targeting a 2D logical region', () => {
    const state = createTorus3DViewState({ zoom: 1.73 });
    const anchor = createTorusSpatialAnchor(9, 7, 3);
    const target = torus3DViewTargetForAnchor(9, state, anchor);
    expect(target.zoom).toBeCloseTo(1.73, 8);
    expectSameAnchor(torus3DFrontFacingAnchor(9, target.rotation), anchor);
  });
});

describe('Torus 3D navigation', () => {
  const directions: readonly Torus3DNavigationDirection[] = ['left', 'right', 'up', 'down'];

  for (const size of TORUS_SIZES) {
    for (const direction of directions) {
      it(`${direction} moves exactly one logical coordinate on ${size}x${size}`, () => {
        const startAnchor = createTorusSpatialAnchor(size, 0, 0);
        const start = torus3DViewTargetForAnchor(
          size,
          createTorus3DViewState({ zoom: 1.4 }),
          startAnchor,
        );
        const target = torus3DNavigationTarget(size, start, direction);
        expectSameAnchor(
          torus3DFrontFacingAnchor(size, target.rotation),
          moveTorusSpatialAnchor(size, startAnchor, direction),
        );
        expect(target.zoom).toBeCloseTo(start.zoom, 8);
      });

      it(`${size} x ${direction} returns to the equivalent starting anchor`, () => {
        const startAnchor = createTorusSpatialAnchor(size, size - 1, 0);
        let state = torus3DViewTargetForAnchor(size, createTorus3DViewState(), startAnchor);
        for (let index = 0; index < size; index += 1) {
          state = torus3DNavigationTarget(size, state, direction);
        }
        expectSameAnchor(torus3DFrontFacingAnchor(size, state.rotation), startAnchor);
      });
    }
  }

  it('resolves the next target from the actual arbitrary quaternion, not a stale anchor', () => {
    const size: TorusSize = 13;
    const arbitrary = createTorus3DViewState({
      rotation: { x: 0.41, y: -0.23, z: 0.36, w: 0.79 },
      zoom: 1.22,
    });
    const current = torus3DFrontFacingAnchor(size, arbitrary.rotation);
    const target = torus3DNavigationTarget(size, arbitrary, 'right');
    expectSameAnchor(
      torus3DFrontFacingAnchor(size, target.rotation),
      moveTorusSpatialAnchor(size, current, 'right'),
    );
  });
});

describe('Torus 3D Reset View', () => {
  it('returns a finite normalized standard quaternion and standard zoom', () => {
    const reset = torus3DResetTarget();
    expect(reset.zoom).toBe(TORUS_3D_STANDARD_ZOOM);
    expect([
      reset.rotation.x,
      reset.rotation.y,
      reset.rotation.z,
      reset.rotation.w,
    ].every(Number.isFinite)).toBe(true);
    expect(Math.hypot(
      reset.rotation.x,
      reset.rotation.y,
      reset.rotation.z,
      reset.rotation.w,
    )).toBeCloseTo(1, 8);
  });
});
