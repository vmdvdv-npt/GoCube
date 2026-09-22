import * as THREE from 'three';
import type { CubeSize } from '../core/topology/CubeTopology';
import type { PointId } from '../core/topology/Topology';
import { cube3DReviewContourGridLoops } from './Cube3DEndgameContourGeometry';
import {
  CUBE_3D_GRID_EDGE_MARGIN_PITCH_RATIO,
  cube3DGridEdgeInset,
  cube3DSurfaceSample,
} from './Cube3DSurfaceGeometry';

const gridCoordinateToLocal = (size: CubeSize, coordinate: number): number => {
  const inset = cube3DGridEdgeInset(size);
  const pitchUnits = inset / CUBE_3D_GRID_EDGE_MARGIN_PITCH_RATIO;
  return inset + coordinate * pitchUnits;
};

/**
 * Filled, surface-hugging geometry for endgame group interaction.
 *
 * Every closed contour loop is filled independently. That intentionally keeps
 * enclosed empty space interactive as part of the logical group review target.
 */
export const createCube3DReviewHitGeometry = (
  size: CubeSize,
  pointIds: readonly PointId[],
  lift: number,
): THREE.BufferGeometry => {
  const positions: number[] = [];
  const indices: number[] = [];

  for (const loop of cube3DReviewContourGridLoops(size, pointIds)) {
    if (loop.points.length < 3) continue;

    const contour = loop.points.map((point) => new THREE.Vector2(point.x, point.y));
    const triangles = THREE.ShapeUtils.triangulateShape(contour, []);
    const baseIndex = positions.length / 3;

    for (const point of loop.points) {
      const sample = cube3DSurfaceSample(
        loop.face,
        gridCoordinateToLocal(size, point.x),
        gridCoordinateToLocal(size, point.y),
      );
      const normal = new THREE.Vector3(...sample.normal).normalize();
      const position = new THREE.Vector3(...sample.position).addScaledVector(normal, lift);
      positions.push(position.x, position.y, position.z);
    }

    for (const triangle of triangles) {
      indices.push(
        baseIndex + triangle[0]!,
        baseIndex + triangle[1]!,
        baseIndex + triangle[2]!,
      );
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  if (positions.length > 0) geometry.computeBoundingSphere();
  return geometry;
};
