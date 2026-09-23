import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { TORUS_SIZES, TorusTopology } from '../core/topology/TorusTopology';
import { CUBE_3D_PERFORMANCE_BUDGET } from './Cube3DPerformance';
import { cube3DScreenSpaceDragRotation } from './Cube3DScreenRotation';
import {
  shared3DScreenSpaceDragRotation,
  shared3DWheelZoom,
} from './Shared3DInput';
import { SHARED_3D_PERFORMANCE_BUDGET } from './Shared3DPerformance';
import {
  nearestTorus3DPointId,
  torus3DSurfacePoint,
} from './Torus3DSurfaceMapping';
import { createTorus3DSurfaceGeometry } from './Torus3DSurfaceGeometry';

describe('shared 3D foundation', () => {
  it('keeps Cube screen rotation on the shared implementation', () => {
    expect(cube3DScreenSpaceDragRotation).toBe(shared3DScreenSpaceDragRotation);
    expect(CUBE_3D_PERFORMANCE_BUDGET).toBe(SHARED_3D_PERFORMANCE_BUDGET);
  });

  it('keeps shared wheel zoom bounded', () => {
    expect(shared3DWheelZoom(1, -10000, 0.001, 0.65, 2.5)).toBe(2.5);
    expect(shared3DWheelZoom(1, 10000, 0.001, 0.65, 2.5)).toBe(0.65);
  });
});

describe('Torus 3D renderer-neutral mapping', () => {
  for (const size of TORUS_SIZES) {
    it(`maps every ${size}x${size} PointId deterministically without seam duplicates`, () => {
      const topology = new TorusTopology(size);
      const positions = new Set<string>();
      for (const pointId of topology.points()) {
        const first = torus3DSurfacePoint(size, pointId);
        const second = torus3DSurfacePoint(size, pointId);
        expect(second).toEqual(first);
        for (const vector of [first.position, first.normal, first.tangent]) {
          expect([vector.x, vector.y, vector.z].every(Number.isFinite)).toBe(true);
        }
        expect(Math.hypot(first.normal.x, first.normal.y, first.normal.z)).toBeGreaterThan(0.99);
        expect(Math.hypot(first.tangent.x, first.tangent.y, first.tangent.z)).toBeGreaterThan(0.99);
        expect(nearestTorus3DPointId(size, first.position)).toBe(pointId);
        positions.add([
          first.position.x.toFixed(9),
          first.position.y.toFixed(9),
          first.position.z.toFixed(9),
        ].join(','));
      }
      expect(positions.size).toBe(size * size);
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
