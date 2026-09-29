import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { TORUS_SIZES, TorusTopology, type TorusSize } from '../core/topology/TorusTopology';
import { CUBE_3D_PERFORMANCE_BUDGET } from './Cube3DPerformance';
import { cube3DScreenSpaceDragRotation } from './Cube3DScreenRotation';
import { torus3DGridPitch, torus3DStoneMatrix } from './Torus3DGameplayGeometry';
import { createTorus3DGridPaths } from './Torus3DGridGeometry';
import {
  createTorus3DPickTargets,
  disposeTorus3DPickTargets,
  pointFromTorus3DClientPosition,
} from './Torus3DPicking';
import {
  shared3DScreenSpaceDragRotation,
  shared3DWheelZoom,
} from './Shared3DInput';
import { SHARED_3D_PERFORMANCE_BUDGET } from './Shared3DPerformance';
import {
  createTorus3DGridLayout,
  TORUS_3D_BEVEL_SIZE,
  torus3DSurfaceFromUv,
  torus3DSurfacePoint,
  type Torus3DSurfacePoint,
  type Torus3DSurfaceRegion,
} from './Torus3DSurfaceMapping';
import { createTorus3DSurfaceGeometry } from './Torus3DSurfaceGeometry';

const EXPECTED_CROSS_SECTION_INTERVALS: Record<
  TorusSize,
  readonly [number, number, number, number]
> = {
  9: [3, 2, 3, 1],
  13: [4, 3, 4, 2],
  19: [6, 5, 6, 2],
};

const surfaceRegion = (sample: Torus3DSurfacePoint): Torus3DSurfaceRegion => {
  if (sample.normal.z > 0.99) return 'top';
  if (sample.normal.z < -0.99) return 'bottom';
  const radialDot = sample.position.x * sample.normal.x + sample.position.y * sample.normal.y;
  return radialDot > 0 ? 'outer' : 'inner';
};

const pointDistance = (a: Torus3DSurfacePoint, b: Torus3DSurfacePoint): number => Math.hypot(
  a.position.x - b.position.x,
  a.position.y - b.position.y,
  a.position.z - b.position.z,
);

describe('shared 3D foundation', () => {
  it('keeps Cube screen rotation and performance on shared implementations', () => {
    expect(cube3DScreenSpaceDragRotation).toBe(shared3DScreenSpaceDragRotation);
    expect(CUBE_3D_PERFORMANCE_BUDGET).toBe(SHARED_3D_PERFORMANCE_BUDGET);
  });

  it('keeps shared wheel zoom bounded', () => {
    expect(shared3DWheelZoom(1, -10000, 0.001, 0.65, 2.5)).toBe(2.5);
    expect(shared3DWheelZoom(1, 10000, 0.001, 0.65, 2.5)).toBe(0.65);
  });
});

describe('Torus 3D square grid layout', () => {
  for (const size of TORUS_SIZES) {
    it(`uses the required ${size}x${size} cross-section interval distribution and margins`, () => {
      const layout = createTorus3DGridLayout(size);
      expect([
        layout.topIntervals,
        layout.outerIntervals,
        layout.bottomIntervals,
        layout.innerIntervals,
      ]).toEqual(EXPECTED_CROSS_SECTION_INTERVALS[size]);
      expect(layout.regions.map((region) => region.intervals)).toEqual(
        EXPECTED_CROSS_SECTION_INTERVALS[size],
      );
      expect(layout.regions.reduce((total, region) => total + region.intervals, 0)).toBe(size);
      expect(layout.perimeterIntervals.reduce((total, count) => total + count, 0)).toBe(size);
      expect(layout.gridStep).toBeGreaterThan(0);
      expect(layout.outerMargin).toBeGreaterThan(layout.gridStep);
      expect(layout.innerMargin).toBeGreaterThan(layout.gridStep);
      expect(layout.innerMargin).toBeGreaterThan(layout.outerMargin);
      expect(layout.transitionRadius).toBeGreaterThan(TORUS_3D_BEVEL_SIZE * 3);
    });

    it(`places ${size}x${size} logical intersections on the required flat surface regions`, () => {
      const counts: Record<Torus3DSurfaceRegion, number> = {
        top: 0,
        outer: 0,
        bottom: 0,
        inner: 0,
      };
      const topology = new TorusTopology(size);
      expect(topology.points()).toHaveLength(size * size);
      for (const pointId of topology.points()) {
        counts[surfaceRegion(torus3DSurfacePoint(size, pointId))] += 1;
      }
      const [top, outer, bottom, inner] = EXPECTED_CROSS_SECTION_INTERVALS[size];
      expect(counts).toEqual({
        top: top * size,
        outer: outer * size,
        bottom: bottom * size,
        inner: inner * size,
      });
      expect(topology.neighbors('0,0')).toContain(`${size - 1},0`);
      expect(topology.neighbors('0,0')).toContain(`0,${size - 1}`);
    });

    it(`keeps ${size}x${size} flat grid pitch square in both toroidal directions`, () => {
      const layout = createTorus3DGridLayout(size);
      const topology = new TorusTopology(size);
      let checkedPairs = 0;
      for (const pointId of topology.points()) {
        const [xText, yText] = pointId.split(',');
        const x = Number(xText);
        const y = Number(yText);
        const source = torus3DSurfacePoint(size, pointId);
        for (const neighborId of [`${(x + 1) % size},${y}`, `${x},${(y + 1) % size}`]) {
          const target = torus3DSurfacePoint(size, neighborId);
          const normalDot =
            source.normal.x * target.normal.x +
            source.normal.y * target.normal.y +
            source.normal.z * target.normal.z;
          const tangentDot =
            source.tangent.x * target.tangent.x +
            source.tangent.y * target.tangent.y +
            source.tangent.z * target.tangent.z;
          if (normalDot < 0.999999 || tangentDot < 0.999999) continue;
          expect(pointDistance(source, target)).toBeCloseTo(layout.gridStep, 6);
          checkedPairs += 1;
        }
      }
      expect(checkedPairs).toBeGreaterThan(size);
      expect(torus3DGridPitch(size)).toBeCloseTo(layout.gridStep, 6);
    });

    it(`uses one ${size}x${size} spatial model for grid intersections and gameplay points`, () => {
      const paths = createTorus3DGridPaths(size, size);
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const point = torus3DSurfacePoint(size, `${x},${y}`);
          const firstDirectionPoint = paths.firstDirection[y]![x]!;
          const secondDirectionPoint = paths.secondDirection[x]![y]!;
          expect(firstDirectionPoint.position).toEqual(point.position);
          expect(secondDirectionPoint.position).toEqual(point.position);
        }
      }
    });
  }
});

describe('Torus 3D unified surface mapping', () => {
  for (const size of TORUS_SIZES) {
    it(`maps every ${size}x${size} PointId deterministically onto a flat playable surface`, () => {
      const positions = new Set<string>();
      const surfaceKinds = new Set<string>();
      for (const pointId of new TorusTopology(size).points()) {
        const first = torus3DSurfacePoint(size, pointId);
        const second = torus3DSurfacePoint(size, pointId);
        expect(second).toEqual(first);
        const normalLength = Math.hypot(first.normal.x, first.normal.y, first.normal.z);
        const tangentLength = Math.hypot(first.tangent.x, first.tangent.y, first.tangent.z);
        expect(normalLength).toBeCloseTo(1, 6);
        expect(tangentLength).toBeCloseTo(1, 6);
        expect(
          first.normal.x * first.tangent.x +
          first.normal.y * first.tangent.y +
          first.normal.z * first.tangent.z,
        ).toBeCloseTo(0, 6);
        // Logical intersections remain on straight XY edge segments; rounded
        // transitions are connector geometry between gameplay intersections.
        expect(Math.min(Math.abs(first.tangent.x), Math.abs(first.tangent.y))).toBeCloseTo(0, 6);
        surfaceKinds.add(surfaceRegion(first));
        positions.add([
          first.position.x.toFixed(9),
          first.position.y.toFixed(9),
          first.position.z.toFixed(9),
        ].join(','));
      }
      expect(positions.size).toBe(size * size);
      expect(surfaceKinds).toEqual(new Set(['top', 'bottom', 'outer', 'inner']));
    });
  }

  it('keeps the physical wood mapping unchanged and continuous through its existing corner', () => {
    const curved = torus3DSurfaceFromUv(0.1225, 0.25);
    expect(Math.abs(curved.tangent.x)).toBeGreaterThan(0.1);
    expect(Math.abs(curved.tangent.y)).toBeGreaterThan(0.1);
    expect(Math.abs(curved.normal.x)).toBeGreaterThan(0.1);
    expect(Math.abs(curved.normal.y)).toBeGreaterThan(0.1);

    const arcStartBefore = torus3DSurfaceFromUv(0.119999, 0.25);
    const arcStartAfter = torus3DSurfaceFromUv(0.120001, 0.25);
    const edgeBefore = torus3DSurfaceFromUv(0.124999, 0.25);
    const edgeAfter = torus3DSurfaceFromUv(0.125001, 0.25);
    const distance = (a: typeof curved, b: typeof curved): number => pointDistance(a, b);

    expect(distance(arcStartBefore, arcStartAfter)).toBeLessThan(0.001);
    expect(distance(edgeBefore, edgeAfter)).toBeLessThan(0.001);
    expect(
      edgeBefore.tangent.x * edgeAfter.tangent.x +
      edgeBefore.tangent.y * edgeAfter.tangent.y +
      edgeBefore.tangent.z * edgeAfter.tangent.z,
    ).toBeGreaterThan(0.999);
  });
});

describe('Torus 3D cyclic grid', () => {
  for (const size of TORUS_SIZES) {
    it(`creates exactly ${size}+${size} closed finite surface paths`, () => {
      const paths = createTorus3DGridPaths(size, 64);
      expect(paths.firstDirection).toHaveLength(size);
      expect(paths.secondDirection).toHaveLength(size);
      for (const path of [...paths.firstDirection, ...paths.secondDirection]) {
        expect(path.length).toBe(65);
        const first = path[0]!.position;
        const last = path[path.length - 1]!.position;
        expect(last.x).toBeCloseTo(first.x, 8);
        expect(last.y).toBeCloseTo(first.y, 8);
        expect(last.z).toBeCloseTo(first.z, 8);
        for (const sample of path) {
          expect([
            sample.position.x, sample.position.y, sample.position.z,
            sample.normal.x, sample.normal.y, sample.normal.z,
          ].every(Number.isFinite)).toBe(true);
        }
      }
    });
  }
});

describe('Torus 3D gameplay transforms', () => {
  for (const size of TORUS_SIZES) {
    it(`keeps ${size}x${size} stone matrices finite, deterministic and unique per logical point`, () => {
      expect(torus3DGridPitch(size)).toBeGreaterThan(0);
      for (const pointId of new TorusTopology(size).points()) {
        const first = torus3DStoneMatrix(size, pointId);
        const second = torus3DStoneMatrix(size, pointId);
        expect(second.elements).toEqual(first.elements);
        expect(first.elements.every(Number.isFinite)).toBe(true);
      }
    });
  }
});

describe('Torus 3D production picking', () => {
  const representativePoint = (size: TorusSize, kind: Torus3DSurfaceRegion): string => {
    for (const pointId of new TorusTopology(size).points()) {
      if (surfaceRegion(torus3DSurfacePoint(size, pointId)) === kind) return pointId;
    }
    throw new Error(`Missing representative ${kind} point`);
  };

  for (const kind of ['top', 'bottom', 'outer', 'inner'] as const) {
    it(`round-trips a visible ${kind} point through raycast proxies`, () => {
      const size: TorusSize = 9;
      const pointId = representativePoint(size, kind);
      const sample = torus3DSurfacePoint(size, pointId);
      const target = new THREE.Vector3(sample.position.x, sample.position.y, sample.position.z);
      const normal = new THREE.Vector3(sample.normal.x, sample.normal.y, sample.normal.z);
      const tangent = new THREE.Vector3(sample.tangent.x, sample.tangent.y, sample.tangent.z);
      const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 20);
      camera.up.copy(tangent);
      camera.position.copy(target).addScaledVector(normal, kind === 'inner' ? 0.45 : 3);
      camera.lookAt(target);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);

      const geometry = createTorus3DSurfaceGeometry();
      const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
      const surface = new THREE.Mesh(geometry, material);
      const targets = createTorus3DPickTargets(size);
      const result = pointFromTorus3DClientPosition({
        camera,
        surface,
        targets,
        viewport: { left: 0, top: 0, width: 1000, height: 1000 },
      }, 500, 500);
      expect(result).toBe(pointId);

      disposeTorus3DPickTargets(targets);
      geometry.dispose();
      material.dispose();
    });
  }
});

describe('Torus 3D square-frame geometry', () => {
  it('is finite, closed around a real central hole and disposable', () => {
    const geometry = createTorus3DSurfaceGeometry();
    const bounds = geometry.boundingBox;
    expect(bounds).not.toBeNull();
    expect([
      bounds!.min.x,
      bounds!.min.y,
      bounds!.min.z,
      bounds!.max.x,
      bounds!.max.y,
      bounds!.max.z,
    ].every(Number.isFinite)).toBe(true);

    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.updateMatrixWorld(true);
    const raycaster = new THREE.Raycaster();
    raycaster.set(new THREE.Vector3(0, 0, 3), new THREE.Vector3(0, 0, -1));
    expect(raycaster.intersectObject(mesh, false)).toHaveLength(0);
    raycaster.set(new THREE.Vector3(1.1, 0, 3), new THREE.Vector3(0, 0, -1));
    expect(raycaster.intersectObject(mesh, false).length).toBeGreaterThan(0);

    const dispose = vi.spyOn(geometry, 'dispose');
    geometry.dispose();
    material.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
