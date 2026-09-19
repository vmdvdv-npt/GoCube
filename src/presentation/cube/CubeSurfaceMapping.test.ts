import { describe, expect, it } from 'vitest';
import {
  CUBE_FACES,
  CubeTopology,
  cubeStepPoint,
  type CubeDirection,
} from '../../core/topology/CubeTopology';
import { CubeOrientation } from './CubeOrientation';
import {
  crossCubeAxisVectors,
  cubeFaceBasis,
  cubeFaceFromNormal,
  cubeFaceLocalToCartesian,
  cubePointToSurfaceLocation,
  cubeSurfaceEdgeInset,
  cubeSurfaceLocationToPoint,
  dotCubeAxisVectors,
  negateCubeAxisVector,
} from './CubeSurfaceMapping';

const directions: readonly CubeDirection[] = ['top', 'right', 'bottom', 'left'];
const lengthSquared = (vector: readonly number[]): number =>
  vector.reduce((sum, component) => sum + component * component, 0);
const squaredDistance = (a: readonly number[], b: readonly number[]): number =>
  a.reduce((sum, component, index) => sum + (component - b[index]) ** 2, 0);

describe('CubeSurfaceMapping', () => {
  it('round-trips every logical point without consulting Cube2DLayout', () => {
    for (const size of [2, 3, 4, 6]) {
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

  it('exposes orthogonal canonical bases consistent with CubeOrientation rotation zero', () => {
    for (const face of CUBE_FACES) {
      const basis = cubeFaceBasis(face);
      expect(lengthSquared(basis.normal)).toBe(1);
      expect(lengthSquared(basis.right)).toBe(1);
      expect(lengthSquared(basis.down)).toBe(1);
      expect(dotCubeAxisVectors(basis.normal, basis.right)).toBe(0);
      expect(dotCubeAxisVectors(basis.normal, basis.down)).toBe(0);
      expect(dotCubeAxisVectors(basis.right, basis.down)).toBe(0);
      expect(crossCubeAxisVectors(basis.down, basis.right)).toEqual(basis.normal);

      const canonicalUp = cubeFaceFromNormal(negateCubeAxisVector(basis.down));
      expect(new CubeOrientation({ centerFace: face, upFace: canonicalUp }).rotation).toBe(0);
    }
  });

  it('uses the same face-edge connectivity as CubeTopology', () => {
    for (const size of [2, 3, 5]) {
      const topology = new CubeTopology(size);
      for (const point of topology.points()) {
        expect(topology.neighbors(point)).toEqual(
          directions.map((direction) => cubeStepPoint(size, point, direction)),
        );
      }
    }
  });

  it('maps the two local descriptions of every shared sharp edge to one geometric seam', () => {
    const size = 5;
    for (const point of new CubeTopology(size).points()) {
      const from = cubePointToSurfaceLocation(size, point);
      for (const direction of directions) {
        const nextPoint = cubeStepPoint(size, point, direction);
        const to = cubePointToSurfaceLocation(size, nextPoint);
        if (from.face === to.face) continue;

        const fromLocal =
          direction === 'top'
            ? { u: from.u, v: 0 }
            : direction === 'right'
              ? { u: 1, v: from.v }
              : direction === 'bottom'
                ? { u: from.u, v: 1 }
                : { u: 0, v: from.v };
        const fromSeam = cubeFaceLocalToCartesian(from.face, fromLocal.u, fromLocal.v);
        const targetCandidates = [
          cubeFaceLocalToCartesian(to.face, 0, to.v),
          cubeFaceLocalToCartesian(to.face, 1, to.v),
          cubeFaceLocalToCartesian(to.face, to.u, 0),
          cubeFaceLocalToCartesian(to.face, to.u, 1),
        ];

        expect(Math.min(...targetCandidates.map((candidate) => squaredDistance(candidate, fromSeam)))).toBeLessThan(1e-20);
      }
    }
  });
});
