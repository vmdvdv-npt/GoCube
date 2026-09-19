import { describe, expect, it } from 'vitest';
import {
  CubeTopology,
  cubeStepPoint,
  type CubeDirection,
} from '../core/topology/CubeTopology';
import {
  cube3DGridPath,
  cube3DPointPosition,
  DEFAULT_CUBE_3D_SURFACE_PROFILE,
} from './Cube3DSurfaceGeometry';

const directions: readonly CubeDirection[] = ['top', 'right', 'bottom', 'left'];
const key = (position: readonly number[]): string => position.map((value) => value.toFixed(9)).join(':');

describe('Cube3DSurfaceGeometry', () => {
  it('keeps all 6 × N × N logical points geometrically distinct near edges and corners', () => {
    for (const size of [2, 3, 4, 6]) {
      const topology = new CubeTopology(size);
      const positions = topology.points().map((point) => key(cube3DPointPosition(size, point)));
      expect(new Set(positions).size).toBe(6 * size * size);
    }
  });

  it('builds continuous rounded paths through shared seams for cross-face neighbours', () => {
    const size = 4;
    const topology = new CubeTopology(size);
    let crossedEdges = 0;

    for (const point of topology.points()) {
      for (const direction of directions) {
        const next = cubeStepPoint(size, point, direction);
        const path = cube3DGridPath(size, point, direction);
        expect(path.toPointId).toBe(next);
        expect(path.positions[0]).toEqual(cube3DPointPosition(size, point));
        expect(path.positions.at(-1)).toEqual(cube3DPointPosition(size, next));
        if (path.crossesFaceBoundary) {
          crossedEdges += 1;
          expect(path.positions.length).toBeGreaterThan(2);
        }
      }
    }

    expect(crossedEdges).toBeGreaterThan(0);
  });

  it('keeps rounded positions inside the sharp cube extent', () => {
    const size = 6;
    for (const point of new CubeTopology(size).points()) {
      const position = cube3DPointPosition(size, point, DEFAULT_CUBE_3D_SURFACE_PROFILE);
      for (const component of position) {
        expect(Math.abs(component)).toBeLessThanOrEqual(DEFAULT_CUBE_3D_SURFACE_PROFILE.halfExtent);
      }
    }
  });
});
