import * as THREE from 'three';
import type { PointId } from '../core/topology/Topology';
import { TorusTopology, type TorusSize } from '../core/topology/TorusTopology';
import { shared3DRaycasterFromClientPosition, type Shared3DViewportBounds } from './Shared3DRaycasting';
import { torus3DGridPitch, torus3DSurfaceAlignedMatrix } from './Torus3DGameplayGeometry';

const RENDER_LAYER = 0;
export const TORUS_3D_PICK_LAYER = 1;
const PICK_DIAMETER_PITCH_RATIO = 0.58;
const PICK_LIFT_PITCH_RATIO = 0.035;

export interface Torus3DPickTargets {
  readonly mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material>;
  readonly pointIds: readonly PointId[];
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.MeshBasicMaterial;
  readonly occlusionTolerance: number;
}

export interface Torus3DPickContext {
  readonly camera: THREE.Camera;
  readonly surface: THREE.Object3D;
  readonly targets: Torus3DPickTargets;
  readonly viewport: Shared3DViewportBounds;
}

export const createTorus3DPickTargets = (size: TorusSize): Torus3DPickTargets => {
  const pointIds = Object.freeze([...new TorusTopology(size).points()]);
  const pitch = torus3DGridPitch(size);
  const radius = (pitch * PICK_DIAMETER_PITCH_RATIO) / 2;
  const lift = pitch * PICK_LIFT_PITCH_RATIO;
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
  mesh.layers.set(TORUS_3D_PICK_LAYER);
  pointIds.forEach((pointId, instanceId) => {
    mesh.setMatrixAt(instanceId, torus3DSurfaceAlignedMatrix(size, pointId, lift));
  });
  mesh.instanceMatrix.needsUpdate = true;
  return Object.freeze({
    mesh,
    pointIds,
    geometry,
    material,
    occlusionTolerance: radius + lift + pitch * 0.02,
  });
};

/**
 * Raycasts prebuilt logical proxies and accepts only hits at the nearest visible
 * Torus surface. Concavity therefore cannot select a hidden back-side point.
 */
export const pointFromTorus3DClientPosition = (
  context: Torus3DPickContext,
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

  context.surface.updateWorldMatrix(true, false);
  context.targets.mesh.updateWorldMatrix(true, false);
  raycaster.layers.set(RENDER_LAYER);
  const surfaceHit = raycaster.intersectObject(context.surface, false)[0] ?? null;
  if (!surfaceHit) return null;

  raycaster.layers.set(TORUS_3D_PICK_LAYER);
  const hits = raycaster.intersectObject(context.targets.mesh, false);
  for (const hit of hits) {
    if (hit.instanceId === undefined) continue;
    if (hit.distance > surfaceHit.distance + context.targets.occlusionTolerance) continue;
    const pointId = context.targets.pointIds[hit.instanceId];
    if (pointId) return pointId;
  }
  return null;
};

export const disposeTorus3DPickTargets = (targets: Torus3DPickTargets): void => {
  targets.geometry.dispose();
  targets.material.dispose();
};
