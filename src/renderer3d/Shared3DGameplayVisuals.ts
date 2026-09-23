import * as THREE from 'three';
import type { StoneColor } from '../core/game/types';
import type { GamePointHoverStatus } from '../presentation/GamePointHoverStatus';

export const SHARED_3D_STONE_DIAMETER_PITCH_RATIO = 0.82;
export const SHARED_3D_STONE_LIFT_PITCH_RATIO = 0.055;
export const SHARED_3D_MARKER_DIAMETER_PITCH_RATIO = 0.28;
export const SHARED_3D_MARKER_LIFT_PITCH_RATIO = 0.07;
export const SHARED_3D_MARKER_THICKNESS = 0.08;

/** Topology-independent low-poly oblate Go stone used by every 3D board. */
export const createShared3DStoneGeometry = (): THREE.BufferGeometry => {
  const geometry = new THREE.SphereGeometry(1, 40, 24);
  geometry.scale(1, 0.34, 1);
  return geometry;
};

export interface Shared3DStoneMaterials {
  readonly black: THREE.MeshPhysicalMaterial;
  readonly white: THREE.MeshPhysicalMaterial;
  dispose(): void;
}

/** Shared Cube/Torus stone material language. */
export const createShared3DStoneMaterials = (): Shared3DStoneMaterials => {
  const black = new THREE.MeshPhysicalMaterial({
    color: 0x17191c,
    roughness: 0.29,
    clearcoat: 0.3,
    clearcoatRoughness: 0.35,
  });
  const white = new THREE.MeshPhysicalMaterial({
    color: 0xf4efdf,
    roughness: 0.25,
    clearcoat: 0.35,
    clearcoatRoughness: 0.3,
  });
  black.shadowSide = white.shadowSide = THREE.FrontSide;
  return Object.freeze({
    black,
    white,
    dispose: () => {
      black.dispose();
      white.dispose();
    },
  });
};

export interface Shared3DHoverMarker {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  dispose(): void;
}

/** Shared compact allowed/forbidden marker. Topology adapters provide only its transform. */
export const createShared3DHoverMarker = (): Shared3DHoverMarker => {
  const markerGeometry = new THREE.CylinderGeometry(1, 1, SHARED_3D_MARKER_THICKNESS, 20);
  const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xe04c4c });
  const mesh = new THREE.Mesh(markerGeometry, markerMaterial);

  const haloGeometry = new THREE.RingGeometry(1.35, 1.65, 48);
  haloGeometry.rotateX(-Math.PI / 2);
  const haloMaterial = new THREE.MeshBasicMaterial({
    color: 0xffde8b,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.9,
  });
  const halo = new THREE.Mesh(haloGeometry, haloMaterial);
  halo.position.y = 0.06;
  mesh.add(halo);
  mesh.visible = false;
  mesh.renderOrder = 3;

  return Object.freeze({
    mesh,
    dispose: () => {
      markerGeometry.dispose();
      markerMaterial.dispose();
      haloGeometry.dispose();
      haloMaterial.dispose();
    },
  });
};

export const updateShared3DHoverMarker = (
  marker: Shared3DHoverMarker,
  matrix: THREE.Matrix4 | null,
  currentPlayer: StoneColor,
  status: GamePointHoverStatus,
): void => {
  const visible = Boolean(matrix && (status === 'allowed' || status === 'forbidden'));
  marker.mesh.visible = visible;
  if (!visible || !matrix) return;
  marker.mesh.matrixAutoUpdate = false;
  marker.mesh.matrix.copy(matrix);
  marker.mesh.matrixWorldNeedsUpdate = true;
  marker.mesh.material.color.setHex(
    status === 'forbidden'
      ? 0xe04c4c
      : currentPlayer === 'black'
        ? 0x101214
        : 0xf2f0e9,
  );
};
