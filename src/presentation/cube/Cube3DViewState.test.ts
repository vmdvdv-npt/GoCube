import { describe, expect, it } from 'vitest';
import {
  CUBE_3D_ZOOM_MAX,
  CUBE_3D_ZOOM_MIN,
  createCube3DViewState,
  withCube3DOrientationAnchor,
  withCube3DRotation,
  withCube3DZoom,
} from './Cube3DViewState';

describe('Cube3DViewState', () => {
  it('keeps rotation, zoom and discrete orientation anchor outside GameState', () => {
    const initial = createCube3DViewState();
    const rotated = withCube3DRotation(initial, { x: 0, y: 2, z: 0, w: 2 });
    const zoomed = withCube3DZoom(rotated, 1.7);
    const anchored = withCube3DOrientationAnchor(zoomed, {
      centerFace: 'right',
      upFace: 'top',
    });

    expect(anchored.rotation.x).toBe(0);
    expect(anchored.rotation.z).toBe(0);
    expect(anchored.rotation.y).toBeCloseTo(Math.SQRT1_2, 15);
    expect(anchored.rotation.w).toBeCloseTo(Math.SQRT1_2, 15);
    expect(anchored.zoom).toBe(1.7);
    expect(anchored.orientationAnchor).toEqual({ centerFace: 'right', upFace: 'top' });
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
