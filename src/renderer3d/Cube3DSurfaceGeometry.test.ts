import { describe, expect, it } from 'vitest';
import {
  CUBE_FACES,
  CubeTopology,
  parseCubePointId,
  type CubeDirection,
  type CubeSize,
} from '../core/topology/CubeTopology';
import {
  cubeEdgeLocalCoordinates,
  cubeSurfaceCoordinateAcrossEdge,
} from '../presentation/cube/CubeSurfaceMapping';
import {
  CUBE_3D_GRID_EDGE_INSET_PITCH_RATIO,
  createCube3DRoundedSurfaceGeometry,
  cube3DDebugGridPaths,
  cube3DGridEdgeInset,
  cube3DGridPathLength,
  cube3DGridSurfacePitch,
  cube3DPointPosition,
  cube3DPointSample,
  cube3DSurfaceSample,
  DEFAULT_CUBE_3D_SURFACE_PROFILE,
} from './Cube3DSurfaceGeometry';

const directions: readonly CubeDirection[] = ['top', 'right', 'bottom', 'left'];
const key = (position: readonly number[]): string => position.map((value) => value.toFixed(9)).join(':');
const vectorLength = (vector: readonly number[]): number => Math.hypot(...vector);
const expectVectorClose = (actual: readonly number[], expected: readonly number[]): void => {
  expect(actual).toHaveLength(expected.length);
  for (let index = 0; index < expected.length; index += 1) {
    expect(actual[index]).toBeCloseTo(expected[index], 10);
  }
};

const isBoundaryPoint = (size: CubeSize, pointId: string): boolean => {
  const { row, column } = parseCubePointId(size, pointId);
  return row === 0 || column === 0 || row === size - 1 || column === size - 1;
};

describe('Cube3DSurfaceGeometry', () => {
  it('keeps all 6 × N × N logical points geometrically distinct for odd, even and technical sizes', () => {
    for (const size of [2, 3, 4, 8]) {
      const topology = new CubeTopology(size);
      const positions = topology.points().map((point) => key(cube3DPointPosition(size, point)));
      expect(new Set(positions).size).toBe(6 * size * size);
    }
  });

  it('returns a unit surface normal with every logical point sample', () => {
    for (const size of [2, 3, 8]) {
      for (const point of new CubeTopology(size).points()) {
        const sample = cube3DPointSample(size, point);
        expect(vectorLength(sample.normal)).toBeCloseTo(1, 10);
        for (const component of sample.position) {
          expect(Math.abs(component)).toBeLessThanOrEqual(DEFAULT_CUBE_3D_SURFACE_PROFILE.halfExtent);
        }
      }
    }
  });

  it('keeps all 12 rounded edges continuous in both position and normal', () => {
    const undirectedEdges = new Set<string>();

    for (const face of CUBE_FACES) {
      for (const edge of directions) {
        for (const t of [0, 0.125, 0.5, 0.875, 1]) {
          const sourceLocal = cubeEdgeLocalCoordinates(edge, t);
          const targetLocal = cubeSurfaceCoordinateAcrossEdge(face, edge, t);
          const source = cube3DSurfaceSample(face, sourceLocal.u, sourceLocal.v);
          const target = cube3DSurfaceSample(targetLocal.face, targetLocal.u, targetLocal.v);
          expectVectorClose(source.position, target.position);
          expectVectorClose(source.normal, target.normal);

          const sourceKey = `${face}:${edge}`;
          const targetKey = `${targetLocal.face}:${targetLocal.edge}`;
          undirectedEdges.add([sourceKey, targetKey].sort().join('|'));
        }
      }
    }

    expect(undirectedEdges.size).toBe(12);
  });

  it('joins the three face descriptions of every physical corner into exactly 8 rounded corners', () => {
    const corners = new Map<string, readonly (readonly number[])[]>();

    for (const face of CUBE_FACES) {
      for (const u of [0, 1]) {
        for (const v of [0, 1]) {
          const sample = cube3DSurfaceSample(face, u, v);
          const cornerKey = key(sample.position);
          const previous = corners.get(cornerKey) ?? [];
          corners.set(cornerKey, [...previous, sample.normal]);
        }
      }
    }

    expect(corners.size).toBe(8);
    for (const normals of corners.values()) {
      expect(normals).toHaveLength(3);
      expectVectorClose(normals[1], normals[0]);
      expectVectorClose(normals[2], normals[0]);
    }
  });

  it('builds one unique debug path per logical adjacency without double lines', () => {
    for (const size of [2, 3, 5, 8]) {
      const paths = cube3DDebugGridPaths(size);
      expect(paths).toHaveLength(12 * size * size);
      expect(paths.filter((path) => path.crossesFaceBoundary)).toHaveLength(12 * size);

      const keys = paths.map((path) => [path.fromPointId, path.toPointId].sort().join('|'));
      expect(new Set(keys).size).toBe(paths.length);
      for (const path of paths) {
        expectVectorClose(path.positions[0], cube3DPointPosition(size, path.fromPointId));
        expectVectorClose(path.positions.at(-1) ?? [], cube3DPointPosition(size, path.toPointId));
      }
    }
  });

  it('insets outer 3D intersections substantially beyond the canonical half-pitch', () => {
    expect(CUBE_3D_GRID_EDGE_INSET_PITCH_RATIO).toBeGreaterThanOrEqual(0.65);
    for (const size of [2, 3, 4, 8]) {
      const inset = cube3DGridEdgeInset(size);
      expect(inset * size).toBeCloseTo(CUBE_3D_GRID_EDGE_INSET_PITCH_RATIO, 10);
      expect(inset).toBeGreaterThan(0.5 / size);
    }
  });

  it('preserves interior grid pitch while moving only the outer row and column inward', () => {
    for (const rawSize of [4, 5, 7, 8]) {
      const size = rawSize as CubeSize;
      const paths = cube3DDebugGridPaths(size, DEFAULT_CUBE_3D_SURFACE_PROFILE, 24);
      const localLengths = paths
        .filter((path) => !path.crossesFaceBoundary)
        .map(cube3DGridPathLength);
      const interiorLengths = paths
        .filter(
          (path) =>
            !path.crossesFaceBoundary &&
            !isBoundaryPoint(size, path.fromPointId) &&
            !isBoundaryPoint(size, path.toPointId),
        )
        .map(cube3DGridPathLength);
      const seamLengths = paths
        .filter((path) => path.crossesFaceBoundary)
        .map(cube3DGridPathLength);
      const expectedPitch = cube3DGridSurfacePitch(size);
      const interiorMinimum = Math.min(...interiorLengths);
      const interiorMaximum = Math.max(...interiorLengths);
      const interiorMean =
        interiorLengths.reduce((sum, value) => sum + value, 0) / interiorLengths.length;
      const localMinimum = Math.min(...localLengths);
      const seamMinimum = Math.min(...seamLengths);

      expect(interiorMaximum / interiorMinimum).toBeLessThan(1.01);
      expect(Math.abs(interiorMean - expectedPitch) / expectedPitch).toBeLessThan(0.01);
      expect(localMinimum).toBeLessThan(expectedPitch * 0.9);
      expect(seamMinimum).toBeGreaterThan(expectedPitch * 1.25);
    }
  });

  it('creates one closed rounded-cube BufferGeometry with normalized vertex normals', () => {
    const geometry = createCube3DRoundedSurfaceGeometry(DEFAULT_CUBE_3D_SURFACE_PROFILE, 8);
    const positions = geometry.getAttribute('position');
    const normals = geometry.getAttribute('normal');

    expect(positions.count).toBeGreaterThan(0);
    expect(normals.count).toBe(positions.count);
    expect(geometry.groups).toHaveLength(0);
    expect(geometry.boundingBox).not.toBeNull();
    expect(geometry.boundingSphere).not.toBeNull();

    for (let index = 0; index < normals.count; index += 1) {
      const normal = [normals.getX(index), normals.getY(index), normals.getZ(index)];
      expect(vectorLength(normal)).toBeCloseTo(1, 6);
    }

    geometry.dispose();
  });
});
