import { describe, expect, it } from 'vitest';
import {
  CUBE_FACES,
  CubeTopology,
  cubeEdgeTransition,
  cubePointId,
  cubeStepPoint,
  parseCubePointId,
  type CubeDirection,
  type CubeEdge,
  type CubeFace,
} from '../../core/topology/CubeTopology';
import { CubeOrientation } from './CubeOrientation';
import {
  crossCubeAxisVectors,
  cubeEdgeLocalCoordinates,
  cubeFaceBasis,
  cubeFaceFromNormal,
  cubeFaceLocalToCartesian,
  cubePointToSurfaceLocation,
  cubeSurfaceCoordinateAcrossEdge,
  cubeSurfaceEdgeInset,
  cubeSurfaceEdgeTransform,
  cubeSurfaceLocationToPoint,
  dotCubeAxisVectors,
  negateCubeAxisVector,
} from './CubeSurfaceMapping';

const directions: readonly CubeDirection[] = ['top', 'right', 'bottom', 'left'];
const lengthSquared = (vector: readonly number[]): number =>
  vector.reduce((sum, component) => sum + component * component, 0);
const expectVectorClose = (actual: readonly number[], expected: readonly number[]): void => {
  expect(actual).toHaveLength(expected.length);
  for (let index = 0; index < expected.length; index += 1) {
    expect(actual[index]).toBeCloseTo(expected[index], 12);
  }
};

const pointOnEdge = (
  size: number,
  face: CubeFace,
  edge: CubeEdge,
  index: number,
): string => {
  const last = size - 1;
  switch (edge) {
    case 'top':
      return cubePointId(face, 0, index);
    case 'right':
      return cubePointId(face, index, last);
    case 'bottom':
      return cubePointId(face, last, index);
    case 'left':
      return cubePointId(face, index, 0);
  }
};

describe('CubeSurfaceMapping', () => {
  it('round-trips every logical point for odd, even and non-UI technical sizes', () => {
    for (const size of [2, 3, 4, 8]) {
      const topology = new CubeTopology(size);
      const keys = new Set<string>();

      for (const point of topology.points()) {
        const surface = cubePointToSurfaceLocation(size, point);
        expect(cubeSurfaceLocationToPoint(size, surface.face, surface.u, surface.v)).toBe(point);
        expect(surface.u).toBeGreaterThanOrEqual(cubeSurfaceEdgeInset(size));
        expect(surface.u).toBeLessThanOrEqual(1 - cubeSurfaceEdgeInset(size));
        expect(surface.v).toBeGreaterThanOrEqual(cubeSurfaceEdgeInset(size));
        expect(surface.v).toBeLessThanOrEqual(1 - cubeSurfaceEdgeInset(size));
        keys.add(`${surface.face}:${surface.u}:${surface.v}`);
      }

      expect(keys.size).toBe(6 * size * size);
    }
  });

  it('rejects non-canonical PointIds even when Number() could parse them', () => {
    for (const point of ['front::0', 'front:01:0', 'front:1e0:0', 'front:+1:0', 'front:1.0:0']) {
      expect(() => parseCubePointId(3, point)).toThrow(`Unknown cube point: ${point}`);
      expect(() => cubePointToSurfaceLocation(3, point)).toThrow(`Unknown cube point: ${point}`);
    }

    expect(parseCubePointId(3, 'front:1:0')).toEqual({ face: 'front', row: 1, column: 0 });
  });

  it('exposes stable orthogonal canonical bases consistent with CubeOrientation rotation zero', () => {
    for (const face of CUBE_FACES) {
      const basis = cubeFaceBasis(face);
      expect(cubeFaceBasis(face)).toBe(basis);
      expect(lengthSquared(basis.normal)).toBe(1);
      expect(lengthSquared(basis.right)).toBe(1);
      expect(lengthSquared(basis.down)).toBe(1);
      expect(dotCubeAxisVectors(basis.normal, basis.right)).toBe(0);
      expect(dotCubeAxisVectors(basis.normal, basis.down)).toBe(0);
      expect(dotCubeAxisVectors(basis.right, basis.down)).toBe(0);
      expectVectorClose(crossCubeAxisVectors(basis.down, basis.right), basis.normal);

      const canonicalUp = cubeFaceFromNormal(negateCubeAxisVector(basis.down));
      expect(new CubeOrientation({ centerFace: face, upFace: canonicalUp }).rotation).toBe(0);
    }
  });

  it('derives every edge frame from the same transition source as CubeTopology', () => {
    const undirectedEdges = new Set<string>();

    for (const face of CUBE_FACES) {
      for (const edge of directions) {
        const topologyTransition = cubeEdgeTransition(face, edge);
        const transform = cubeSurfaceEdgeTransform(face, edge);
        expect(transform.targetFace).toBe(topologyTransition.face);
        expect(transform.targetEdge).toBe(topologyTransition.edge);
        expect(transform.reverse).toBe(topologyTransition.reverse);
        expect(transform.sourceBasis).toBe(cubeFaceBasis(face));
        expect(transform.targetBasis).toBe(cubeFaceBasis(topologyTransition.face));
        expectVectorClose(transform.sourceTangent, transform.targetTangent);
        expectVectorClose(transform.sourceOutward, transform.targetBasis.normal);
        expectVectorClose(transform.targetInward, negateCubeAxisVector(transform.sourceBasis.normal));

        const sourceKey = `${face}:${edge}`;
        const targetKey = `${transform.targetFace}:${transform.targetEdge}`;
        undirectedEdges.add([sourceKey, targetKey].sort().join('|'));
      }
    }

    expect(undirectedEdges.size).toBe(12);
  });

  it('maps continuous local coordinates to exactly the same sharp seam on all 12 edges', () => {
    for (const face of CUBE_FACES) {
      for (const edge of directions) {
        for (const t of [0, 0.125, 0.5, 0.875, 1]) {
          const sourceLocal = cubeEdgeLocalCoordinates(edge, t);
          const mapped = cubeSurfaceCoordinateAcrossEdge(face, edge, t);
          const sourceSeam = cubeFaceLocalToCartesian(face, sourceLocal.u, sourceLocal.v);
          const targetSeam = cubeFaceLocalToCartesian(mapped.face, mapped.u, mapped.v);
          expectVectorClose(sourceSeam, targetSeam);
        }
      }
    }
  });

  it('maps every logical edge point to the same neighbour as CubeTopology with correct direction', () => {
    for (const size of [2, 3, 5, 8]) {
      const inset = cubeSurfaceEdgeInset(size);
      for (const face of CUBE_FACES) {
        for (const edge of directions) {
          for (let index = 0; index < size; index += 1) {
            const sourcePoint = pointOnEdge(size, face, edge, index);
            const source = cubePointToSurfaceLocation(size, sourcePoint);
            const t = edge === 'top' || edge === 'bottom' ? source.u : source.v;
            const mapped = cubeSurfaceCoordinateAcrossEdge(face, edge, t, inset);
            const mappedPoint = cubeSurfaceLocationToPoint(size, mapped.face, mapped.u, mapped.v);

            expect(mappedPoint).toBe(cubeStepPoint(size, sourcePoint, edge));
          }
        }
      }
    }
  });

  it('uses the same complete neighbour ordering as CubeTopology', () => {
    for (const size of [2, 3, 5, 8]) {
      const topology = new CubeTopology(size);
      for (const point of topology.points()) {
        expect(topology.neighbors(point)).toEqual(
          directions.map((direction) => cubeStepPoint(size, point, direction)),
        );
      }
    }
  });
});
