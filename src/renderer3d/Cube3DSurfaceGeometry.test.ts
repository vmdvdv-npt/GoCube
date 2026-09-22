import { describe, expect, it } from 'vitest';
import {
  CUBE_FACES,
  CubeTopology,
  type CubeDirection,
  type CubeFace,
  type CubeSize,
} from '../core/topology/CubeTopology';
import type { PointId } from '../core/topology/Topology';
import {
  cubeEdgeLocalCoordinates,
  cubeSurfaceCoordinateAcrossEdge,
} from '../presentation/cube/CubeSurfaceMapping';
import {
  CUBE_3D_GRID_EDGE_MARGIN_PITCH_RATIO,
  createCube3DRoundedSurfaceGeometry,
  createCube3DDebugGridGeometry,
  cube3DDebugGridPaths,
  cube3DFaceSurfaceSpan,
  cube3DGridEdgeInset,
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
const point = (face: CubeFace, row: number, column: number): PointId =>
  `${face}:${row}:${column}` as PointId;
const distance = (a: readonly number[], b: readonly number[]): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const expectUniformIntervals = (
  size: CubeSize,
  pointIds: readonly PointId[],
): void => {
  const intervals = pointIds.slice(1).map((pointId, index) =>
    distance(cube3DPointPosition(size, pointIds[index]), cube3DPointPosition(size, pointId)),
  );
  const minimum = Math.min(...intervals);
  const maximum = Math.max(...intervals);
  const mean = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
  const expectedPitch = cube3DGridSurfacePitch(size);

  expect(maximum / minimum).toBeLessThan(1.000001);
  expect(Math.abs(mean - expectedPitch) / expectedPitch).toBeLessThan(1e-9);
};

describe('Cube3DSurfaceGeometry', () => {
  it('keeps all 6 × N × N logical points geometrically distinct for odd, even and technical sizes', () => {
    for (const size of [2, 3, 4, 5, 7, 8]) {
      const topology = new CubeTopology(size);
      const positions = topology.points().map((pointId) => key(cube3DPointPosition(size, pointId)));
      expect(new Set(positions).size).toBe(6 * size * size);
    }
  });

  it('returns a unit surface normal with every logical point sample', () => {
    for (const size of [2, 3, 8]) {
      for (const pointId of new CubeTopology(size).points()) {
        const sample = cube3DPointSample(size, pointId);
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

  it('derives the physical-edge margin from the same pitch as the full face lattice', () => {
    expect(CUBE_3D_GRID_EDGE_MARGIN_PITCH_RATIO).toBeGreaterThan(0.5);

    for (const rawSize of [4, 5, 7, 8]) {
      const size = rawSize as CubeSize;
      const expectedPitchUnits =
        1 / ((size - 1) + 2 * CUBE_3D_GRID_EDGE_MARGIN_PITCH_RATIO);
      const inset = cube3DGridEdgeInset(size);
      const surfacePitch = cube3DGridSurfacePitch(size);
      const surfaceMargin = cube3DFaceSurfaceSpan() * inset;

      expect(inset).toBeCloseTo(
        CUBE_3D_GRID_EDGE_MARGIN_PITCH_RATIO * expectedPitchUnits,
        12,
      );
      expect(surfaceMargin / surfacePitch).toBeCloseTo(
        CUBE_3D_GRID_EDGE_MARGIN_PITCH_RATIO,
        12,
      );
    }
  });

  it('uses one uniform horizontal and vertical pitch on every face for 4×4, 5×5, 7×7 and 8×8', () => {
    for (const rawSize of [4, 5, 7, 8]) {
      const size = rawSize as CubeSize;

      for (const face of CUBE_FACES) {
        for (let row = 0; row < size; row += 1) {
          expectUniformIntervals(
            size,
            Array.from({ length: size }, (_, column) => point(face, row, column)),
          );
        }

        for (let column = 0; column < size; column += 1) {
          expectUniformIntervals(
            size,
            Array.from({ length: size }, (_, row) => point(face, row, column)),
          );
        }
      }
    }
  });

  it.each([2, 4, 7, 8] as const)('keeps complete rendered grid segments outside the body at size %s', (size) => {
    const geometry = createCube3DDebugGridGeometry(size);
    const vertices = geometry.getAttribute('position');
    const { halfExtent, roundingRadius } = DEFAULT_CUBE_3D_SURFACE_PROFILE;
    const core = halfExtent - roundingRadius;
    let minimumClearance = Infinity;
    let maximumClearance = 0;
    for (let index = 0; index < vertices.count; index += 2) {
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const coords = [0, 1, 2].map((axis) =>
          vertices.getComponent(index, axis) * (1 - t) + vertices.getComponent(index + 1, axis) * t,
        );
        const clearance = Math.hypot(...coords.map((value) => Math.max(0, Math.abs(value) - core))) - roundingRadius;
        minimumClearance = Math.min(minimumClearance, clearance);
        maximumClearance = Math.max(maximumClearance, clearance);
      }
    }
    // Tests chord interiors too: surface endpoints alone missed the edge gaps.
    expect(minimumClearance).toBeGreaterThan(0);
    expect(maximumClearance).toBeLessThan(0.00101);
    geometry.dispose();
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
