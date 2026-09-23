import * as THREE from 'three';
import {
  TORUS_3D_BEVEL_SIZE,
  TORUS_3D_HALF_HEIGHT,
  TORUS_3D_INNER_HALF_EXTENT,
  TORUS_3D_OUTER_HALF_EXTENT,
} from './Torus3DSurfaceMapping';

export const createTorus3DSurfaceGeometry = (): THREE.ExtrudeGeometry => {
  const outer = TORUS_3D_OUTER_HALF_EXTENT;
  const inner = TORUS_3D_INNER_HALF_EXTENT;
  const shape = new THREE.Shape();
  shape.moveTo(-outer, -outer);
  shape.lineTo(outer, -outer);
  shape.lineTo(outer, outer);
  shape.lineTo(-outer, outer);
  shape.closePath();

  const hole = new THREE.Path();
  hole.moveTo(-inner, -inner);
  hole.lineTo(-inner, inner);
  hole.lineTo(inner, inner);
  hole.lineTo(inner, -inner);
  hole.closePath();
  shape.holes.push(hole);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: TORUS_3D_HALF_HEIGHT * 2,
    steps: 1,
    curveSegments: 1,
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: TORUS_3D_BEVEL_SIZE,
    bevelThickness: TORUS_3D_BEVEL_SIZE,
  });
  geometry.translate(0, 0, -TORUS_3D_HALF_HEIGHT);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
};
