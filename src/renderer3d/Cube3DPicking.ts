import * as THREE from 'three';
import { CubeTopology, type CubeSize } from '../core/topology/CubeTopology';
import type { PointId } from '../core/topology/Topology';
import { cube3DGridPitch, cube3DSurfaceAlignedMatrix } from './Cube3DGameplayGeometry';

export interface Cube3DViewportBounds {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

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
const PICK_LAYER = 1;
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
  mesh.layers.set(PICK_LAYER);

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

export const pointFromCube3DClientPosition = (
  context: Cube3DPickContext,
  clientX: number,
  clientY: number,
): PointId | null => {
  const { viewport } = context;
  if (
    !Number.isFinite(clientX) ||
    !Number.isFinite(clientY) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return null;
  }

  const localX = clientX - viewport.left;
  const localY = clientY - viewport.top;
  if (localX < 0 || localY < 0 || localX > viewport.width || localY > viewport.height) {
    return null;
  }

  const pointer = new THREE.Vector2(
    (localX / viewport.width) * 2 - 1,
    -(localY / viewport.height) * 2 + 1,
  );
  const raycaster = new THREE.Raycaster();
  context.camera.updateMatrixWorld(true);
  context.surface.updateWorldMatrix(true, false);
  context.targets.mesh.updateWorldMatrix(true, false);
  raycaster.setFromCamera(pointer, context.camera);

  // The first closed-surface hit is the normal occlusion boundary. A logical
  // proxy in a rounded edge/corner zone can sit slightly behind a neighboring
  // surface triangle along the same ray even though its sampled surface normal
  // is camera-facing. Because the cube surface is convex, front-facing sampled
  // points are still on the visible hemisphere; hidden back-side points have an
  // away-facing normal and remain rejected.
  raycaster.layers.set(RENDER_LAYER);
  const surfaceHit = raycaster.intersectObject(context.surface, false)[0] ?? null;
  raycaster.layers.set(PICK_LAYER);
  const targetHits = raycaster.intersectObject(context.targets.mesh, false);
  for (const hit of targetHits) {
    if (hit.instanceId === undefined) continue;

    const frontFacing = pickInstanceFacesCamera(
      context.targets,
      hit.instanceId,
      raycaster.ray.direction,
    );
    const withinSurfaceBoundary = Boolean(
      surfaceHit && hit.distance <= surfaceHit.distance + context.targets.occlusionTolerance,
    );
    if (!withinSurfaceBoundary && !frontFacing) continue;

    const pointId = context.targets.pointIds[hit.instanceId];
    if (pointId) return pointId;
  }
  return null;
};

export const disposeCube3DPickTargets = (targets: Cube3DPickTargets): void => {
  targets.geometry.dispose();
  targets.material.dispose();
};
