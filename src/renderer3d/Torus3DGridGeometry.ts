import * as THREE from 'three';
import type { TorusSize } from '../core/topology/TorusTopology';
import { torus3DSurfaceFromUv, type Torus3DSurfacePoint } from './Torus3DSurfaceMapping';

export interface Torus3DGridPaths {
  /** Cycles around the square central hole. */
  readonly firstDirection: readonly (readonly Torus3DSurfacePoint[])[];
  /** Cycles top -> outer wall -> bottom -> inner wall -> top. */
  readonly secondDirection: readonly (readonly Torus3DSurfacePoint[])[];
}

const lifted = (sample: Torus3DSurfacePoint, lift: number): Torus3DSurfacePoint =>
  Object.freeze({
    ...sample,
    position: Object.freeze({
      x: sample.position.x + sample.normal.x * lift,
      y: sample.position.y + sample.normal.y * lift,
      z: sample.position.z + sample.normal.z * lift,
    }),
  });

/** Exactly N closed paths in each toroidal direction, sampled through the shared surface map. */
export const createTorus3DGridPaths = (
  size: TorusSize,
  samplesPerCycle = 256,
  lift = 0,
): Torus3DGridPaths => {
  const firstDirection = Array.from({ length: size }, (_, y) =>
    Object.freeze(
      Array.from({ length: samplesPerCycle + 1 }, (_, sampleIndex) =>
        lifted(torus3DSurfaceFromUv(sampleIndex / samplesPerCycle, y / size), lift),
      ),
    ),
  );
  const secondDirection = Array.from({ length: size }, (_, x) =>
    Object.freeze(
      Array.from({ length: samplesPerCycle + 1 }, (_, sampleIndex) =>
        lifted(torus3DSurfaceFromUv(x / size, sampleIndex / samplesPerCycle), lift),
      ),
    ),
  );
  return Object.freeze({
    firstDirection: Object.freeze(firstDirection),
    secondDirection: Object.freeze(secondDirection),
  });
};

export const createTorus3DGridGeometry = (
  size: TorusSize,
  lift: number,
): THREE.BufferGeometry => {
  const paths = createTorus3DGridPaths(size, 256, lift);
  const positions: number[] = [];
  for (const direction of [paths.firstDirection, paths.secondDirection]) {
    for (const path of direction) {
      for (let index = 1; index < path.length; index += 1) {
        const previous = path[index - 1]!.position;
        const current = path[index]!.position;
        positions.push(
          previous.x, previous.y, previous.z,
          current.x, current.y, current.z,
        );
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
};
