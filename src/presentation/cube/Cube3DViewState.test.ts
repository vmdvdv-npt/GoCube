import { describe, expect, it } from 'vitest';
import { CUBE_FACES } from '../../core/topology/CubeTopology';
import {
  cubeFaceBasis,
  dotCubeAxisVectors,
} from './CubeSurfaceMapping';
import {
  CUBE_3D_ZOOM_MAX,
  CUBE_3D_ZOOM_MIN,
  createCube3DViewState,
  cubeOrientationAnchorToQuaternion,
  cubeQuaternionToOrientationAnchor,
  withCube3DOrientationAnchor,
  withCube3DRotation,
  withCube3DZoom,
} from './Cube3DViewState';

describe('Cube3DViewState', () => {
  it('keeps free rotation, zoom and a synchronized discrete orientation anchor outside GameState', () => {
    const initial = createCube3DViewState();
    const rotated = withCube3DRotation(initial, { x: 0, y: 2, z: 0, w: 2 });
    const zoomed = withCube3DZoom(rotated, 1.7);

    expect(zoomed.rotation.y).toBeCloseTo(Math.SQRT1_2, 15);
    expect(zoomed.rotation.w).toBeCloseTo(Math.SQRT1_2, 15);
    expect(zoomed.zoom).toBe(1.7);
    expect(zoomed.orientationAnchor).toEqual(
      cubeQuaternionToOrientationAnchor(zoomed.rotation),
    );

    const anchored = withCube3DOrientationAnchor(zoomed, {
      centerFace: 'right',
      upFace: 'top',
    });
    expect(anchored.zoom).toBe(1.7);
    expect(anchored.orientationAnchor).toEqual({ centerFace: 'right', upFace: 'top' });
    expect(cubeQuaternionToOrientationAnchor(anchored.rotation)).toEqual(
      anchored.orientationAnchor,
    );
  });

  it('round-trips all 24 discrete Cube orientations through the renderer-neutral quaternion form', () => {
    let orientations = 0;
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

        const anchor = { centerFace, upFace } as const;
        const rotation = cubeOrientationAnchorToQuaternion(anchor);
        expect(cubeQuaternionToOrientationAnchor(rotation)).toEqual(anchor);
        orientations += 1;
      }
    }

    expect(orientations).toBe(24);
  });

  it('clamps zoom to the renderer view range', () => {
    expect(createCube3DViewState({ zoom: -100 }).zoom).toBe(CUBE_3D_ZOOM_MIN);
    expect(createCube3DViewState({ zoom: 100 }).zoom).toBe(CUBE_3D_ZOOM_MAX);
  });

  it('rejects invalid quaternion and orientation states', () => {
    expect(() => createCube3DViewState({ rotation: { x: 0, y: 0, z: 0, w: 0 } })).toThrow();
    expect(() =>
      createCube3DViewState({ orientationAnchor: { centerFace: 'front', upFace: 'back' } }),
    ).toThrow();
  });
});
