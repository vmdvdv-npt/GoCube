import * as THREE from 'three';
import { CubeTopology, type CubeSize } from '../core/topology/CubeTopology';
import type { PointId } from '../core/topology/Topology';
import { cube3DGridPitch, cube3DSurfaceAlignedMatrix } from './Cube3DGameplayGeometry';
import {
  shared3DRaycasterFromClientPosition,
  type Shared3DViewportBounds,
} from './Shared3DRaycasting';

export type Cube3DViewportBounds = Shared3DViewportBounds;

export interface Cube3DPickTargets {
  readonly mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material>;
  readonly pointIds: readonly PointId[];
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.MeshBasicMaterial;
  readonly occlusionTolerance: number;
}

export interface Cube3DPickContext {
  readonly camera: THREE.Camera;
  readonly surface: THREE.Object3D;
  readonly targets: Cube3DPickTargets;
  readonly viewport: Cube3DViewportBounds;
}

const PICK_DIAMETER_PITCH_RATIO = 0.58;
const PICK_LIFT_PITCH_RATIO = 0.035;
const FRONT_FACING_EPSILON = 0.01;
const RENDER_LAYER = 0;
export const CUBE_3D_PICK_LAYER = 1;
const LOCAL_PICK_NORMAL = new THREE.Vector3(0, 1, 0);

export const createCube3DPickTargets = (size: CubeSize): Cube3DPickTargets => {
  const pointIds = Object.freeze([...new CubeTopology(size).points()]);
  const pitch = cube3DGridPitch(size);
  const radius = (pitch * PICK_DIAMETER_PITCH_RATIO) / 2;
  // A sphere makes the hit volume angle-independent at rounded edges/corners.
  // Logical orientation still comes from the PointId surface sample matrix.
  const geometry = new THREE.SphereGeometry(radius, 12, 8);
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  material.colorWrite = false;
  const mesh = new THREE.InstancedMesh(geometry, material, pointIds.length);
  mesh.count = pointIds.length;
  mesh.frustumCulled = false;
  // Pick proxies participate in scene transforms but live on a non-camera layer,
  // so they never enter the WebGL draw list. Raycasting opts into this layer below.
  mesh.layers.set(CUBE_3D_PICK_LAYER);

  pointIds.forEach((pointId, instanceId) => {
    mesh.setMatrixAt(
      instanceId,
      cube3DSurfaceAlignedMatrix(size, pointId, pitch * PICK_LIFT_PITCH_RATIO),
    );
  });
  mesh.instanceMatrix.needsUpdate = true;

  return Object.freeze({
    mesh,
    pointIds,
    geometry,
    material,
    occlusionTolerance: radius + pitch * PICK_LIFT_PITCH_RATIO,
  });
};

const pickInstanceFacesCamera = (
  targets: Cube3DPickTargets,
  instanceId: number,
  rayDirection: THREE.Vector3,
): boolean => {
  const instanceMatrix = new THREE.Matrix4();
  targets.mesh.getMatrixAt(instanceId, instanceMatrix);
  const worldMatrix = new THREE.Matrix4().multiplyMatrices(targets.mesh.matrixWorld, instanceMatrix);
  const worldNormal = LOCAL_PICK_NORMAL.clone().transformDirection(worldMatrix);
  return worldNormal.dot(rayDirection) < -FRONT_FACING_EPSILON;
};

const withinSurfaceBoundary = (
  hit: THREE.Intersection,
  surfaceHit: THREE.Intersection | null,
  tolerance: number,
): boolean => Boolean(surfaceHit && hit.distance <= surfaceHit.distance + tolerance);

export const pointFromCube3DClientPosition = (
  context: Cube3DPickContext,
  clientX: number,
  clientY: number,
): PointId | null => {
  const raycaster = shared3DRaycasterFromClientPosition(
    context.camera,
    context.viewport,
    clientX,
    clientY,
  );
  if (!raycaster) return null;

  const pickRoot = context.targets.mesh.parent ?? context.targets.mesh;
  context.surface.updateWorldMatrix(true, false);
  pickRoot.updateWorldMatrix(true, true);

  // The first closed-surface hit is the normal occlusion boundary. A logical
  // proxy in a rounded edge/corner zone can sit slightly behind a neighboring
  // surface triangle along the same ray even though its sampled surface normal
  // is camera-facing. Because the cube surface is convex, front-facing sampled
  // points are still on the visible hemisphere; hidden back-side points have an
  // away-facing normal and remain rejected.
  raycaster.layers.set(RENDER_LAYER);
  const surfaceHit = raycaster.intersectObject(context.surface, false)[0] ?? null;
  raycaster.layers.set(CUBE_3D_PICK_LAYER);

  // Endgame review adds filled group-interior meshes to the same non-rendered
  // picking layer. Prefer those targets so stones and empty space enclosed by a
  // review contour resolve to the same logical group representative point.
  const targetHits = raycaster.intersectObject(pickRoot, true);
  for (const hit of targetHits) {
    const reviewPoint = hit.object.userData.endgameRepresentativePointId;
    if (
      typeof reviewPoint === 'string' &&
      withinSurfaceBoundary(hit, surfaceHit, context.targets.occlusionTolerance)
    ) {
      return reviewPoint;
    }
  }

  for (const hit of targetHits) {
    if (hit.object !== context.targets.mesh || hit.instanceId === undefined) continue;

    const frontFacing = pickInstanceFacesCamera(
      context.targets,
      hit.instanceId,
      raycaster.ray.direction,
    );
    const visibleAtSurface = withinSurfaceBoundary(
      hit,
      surfaceHit,
      context.targets.occlusionTolerance,
    );
    if (!visibleAtSurface && !frontFacing) continue;

    const pointId = context.targets.pointIds[hit.instanceId];
    if (pointId) return pointId;
  }
  return null;
};

export const disposeCube3DPickTargets = (targets: Cube3DPickTargets): void => {
  targets.geometry.dispose();
  targets.material.dispose();
};
