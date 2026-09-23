import * as THREE from 'three';
import { torus3DSurfaceFromUv } from './Torus3DSurfaceMapping';

// The XY corner phase is intentionally very narrow so logical PointIds stay on
// flat surfaces. Use enough U sampling to render that authoritative curve rather
// than collapsing it back into a single sharp chord.
const U_SEGMENTS = 256;
const V_SEGMENTS = 256;

/** Mesh and gameplay mapping are sampled from the same authoritative Torus surface. */
export const createTorus3DSurfaceGeometry = (): THREE.BufferGeometry => {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const row = V_SEGMENTS + 1;

  for (let uIndex = 0; uIndex <= U_SEGMENTS; uIndex += 1) {
    const u = uIndex / U_SEGMENTS;
    for (let vIndex = 0; vIndex <= V_SEGMENTS; vIndex += 1) {
      const v = vIndex / V_SEGMENTS;
      const sample = torus3DSurfaceFromUv(u, v);
      positions.push(sample.position.x, sample.position.y, sample.position.z);
      normals.push(sample.normal.x, sample.normal.y, sample.normal.z);
    }
  }

  for (let uIndex = 0; uIndex < U_SEGMENTS; uIndex += 1) {
    for (let vIndex = 0; vIndex < V_SEGMENTS; vIndex += 1) {
      const a = uIndex * row + vIndex;
      const b = a + 1;
      const c = (uIndex + 1) * row + vIndex;
      const d = c + 1;
      indices.push(a, c, d, a, d, b);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
};
