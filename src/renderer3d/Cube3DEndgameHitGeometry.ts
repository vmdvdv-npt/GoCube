import * as THREE from 'three';
import type { CubeFace, CubeSize } from '../core/topology/CubeTopology';
import type { PointId } from '../core/topology/Topology';
import {
  cube3DReviewContourGridLoops,
  type Cube3DReviewContourGridLoop,
} from './Cube3DEndgameContourGeometry';
import {
  CUBE_3D_GRID_EDGE_MARGIN_PITCH_RATIO,
  cube3DGridEdgeInset,
  cube3DSurfaceSample,
} from './Cube3DSurfaceGeometry';

type GridPoint = Cube3DReviewContourGridLoop['points'][number];

const gridCoordinateToLocal = (size: CubeSize, coordinate: number): number => {
  const inset = cube3DGridEdgeInset(size);
  const pitchUnits = inset / CUBE_3D_GRID_EDGE_MARGIN_PITCH_RATIO;
  return inset + coordinate * pitchUnits;
};

const signedArea = (points: readonly GridPoint[]): number => {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
};

const pointInsideLoop = (point: GridPoint, loop: readonly GridPoint[]): boolean => {
  let inside = false;
  for (let index = 0, previous = loop.length - 1; index < loop.length; previous = index, index += 1) {
    const currentPoint = loop[index]!;
    const previousPoint = loop[previous]!;
    const crosses =
      (currentPoint.y > point.y) !== (previousPoint.y > point.y) &&
      point.x <
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y) +
          currentPoint.x;
    if (crosses) inside = !inside;
  }
  return inside;
};

const appendSurfaceLoop = (
  positions: number[],
  size: CubeSize,
  face: CubeFace,
  points: readonly GridPoint[],
  lift: number,
): void => {
  for (const point of points) {
    const sample = cube3DSurfaceSample(
      face,
      gridCoordinateToLocal(size, point.x),
      gridCoordinateToLocal(size, point.y),
    );
    const normal = new THREE.Vector3(...sample.normal).normalize();
    const position = new THREE.Vector3(...sample.position).addScaledVector(normal, lift);
    positions.push(position.x, position.y, position.z);
  }
};

/**
 * Filled, surface-hugging geometry for endgame group interaction.
 *
 * The filled target follows the same compound contour as the visible annotation:
 * gaps between adjacent round stones stay interactive, while genuine enclosed
 * holes remain holes instead of stealing input from another group inside them.
 */
export const createCube3DReviewHitGeometry = (
  size: CubeSize,
  pointIds: readonly PointId[],
  lift: number,
): THREE.BufferGeometry => {
  const positions: number[] = [];
  const indices: number[] = [];
  const loopsByFace = new Map<CubeFace, Cube3DReviewContourGridLoop[]>();

  for (const loop of cube3DReviewContourGridLoops(size, pointIds)) {
    if (loop.points.length < 3) continue;
    const loops = loopsByFace.get(loop.face) ?? [];
    loops.push(loop);
    loopsByFace.set(loop.face, loops);
  }

  for (const [face, loops] of loopsByFace) {
    const largestLoop = [...loops].sort(
      (left, right) => Math.abs(signedArea(right.points)) - Math.abs(signedArea(left.points)),
    )[0];
    if (!largestLoop) continue;
    const outerSign = Math.sign(signedArea(largestLoop.points)) || 1;
    const outerLoops = loops.filter(
      (loop) => (Math.sign(signedArea(loop.points)) || outerSign) === outerSign,
    );
    const holeLoops = loops.filter(
      (loop) => (Math.sign(signedArea(loop.points)) || outerSign) !== outerSign,
    );

    for (const outer of outerLoops) {
      const holes = holeLoops.filter((hole) => {
        const sample = hole.points[0];
        return Boolean(sample && pointInsideLoop(sample, outer.points));
      });
      const contour = outer.points.map((point) => new THREE.Vector2(point.x, point.y));
      const holeContours = holes.map((hole) =>
        hole.points.map((point) => new THREE.Vector2(point.x, point.y)),
      );
      const triangles = THREE.ShapeUtils.triangulateShape(contour, holeContours);
      const baseIndex = positions.length / 3;

      appendSurfaceLoop(positions, size, face, outer.points, lift);
      for (const hole of holes) appendSurfaceLoop(positions, size, face, hole.points, lift);

      for (const triangle of triangles) {
        indices.push(
          baseIndex + triangle[0]!,
          baseIndex + triangle[1]!,
          baseIndex + triangle[2]!,
        );
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  if (positions.length > 0) geometry.computeBoundingSphere();
  return geometry;
};
