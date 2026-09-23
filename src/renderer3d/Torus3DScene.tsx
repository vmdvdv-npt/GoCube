import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { PointId } from '../core/topology/Topology';
import type { TorusSize } from '../core/topology/TorusTopology';
import {
  createTorus3DViewState,
  TORUS_3D_ZOOM_MAX,
  TORUS_3D_ZOOM_MIN,
} from '../presentation/Torus3DViewState';
import { shared3DRaycasterFromClientPosition } from './Shared3DRaycasting';
import {
  applyShared3DViewTransform,
  attachShared3DPointerInput,
  createShared3DSceneCore,
  type Shared3DSceneCore,
  type Shared3DViewTransform,
} from './Shared3DSceneCore';
import { createShared3DWoodMaterial } from './Shared3DWoodMaterial';
import {
  nearestTorus3DPointId,
  torus3DSurfacePoint,
} from './Torus3DSurfaceMapping';
import { createTorus3DSurfaceGeometry } from './Torus3DSurfaceGeometry';
import './torus3d.css';

export interface Torus3DSceneProps {
  readonly size: TorusSize;
}

const createMappingMarkers = (
  size: TorusSize,
): Readonly<{
  mesh: THREE.InstancedMesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  geometry: THREE.CylinderGeometry;
  material: THREE.MeshBasicMaterial;
}> => {
  const geometry = new THREE.CylinderGeometry(0.035, 0.035, 0.012, 12);
  const material = new THREE.MeshBasicMaterial({ color: 0x2a170c });
  const mesh = new THREE.InstancedMesh(geometry, material, size * size);
  const up = new THREE.Vector3(0, 1, 0);
  const normal = new THREE.Vector3();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const matrix = new THREE.Matrix4();
  let index = 0;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const mapped = torus3DSurfacePoint(size, `${x},${y}`);
      normal.set(mapped.normal.x, mapped.normal.y, mapped.normal.z).normalize();
      position
        .set(mapped.position.x, mapped.position.y, mapped.position.z)
        .addScaledVector(normal, 0.008);
      rotation.setFromUnitVectors(up, normal);
      matrix.compose(position, rotation, scale);
      mesh.setMatrixAt(index, matrix);
      index += 1;
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.renderOrder = 2;
  return Object.freeze({ mesh, geometry, material });
};

const pointFromClientPosition = (
  core: Shared3DSceneCore,
  surface: THREE.Mesh,
  size: TorusSize,
  x: number,
  y: number,
): PointId | null => {
  const raycaster = shared3DRaycasterFromClientPosition(
    core.camera,
    core.renderer.domElement.getBoundingClientRect(),
    x,
    y,
  );
  if (!raycaster) return null;
  surface.updateWorldMatrix(true, false);
  const hit = raycaster.intersectObject(surface, false)[0];
  if (!hit) return null;
  const local = surface.worldToLocal(hit.point.clone());
  return nearestTorus3DPointId(size, { x: local.x, y: local.y, z: local.z });
};

/** Stage-1 Torus 3D prototype. Gameplay authority deliberately remains disconnected. */
export function Torus3DScene({ size }: Torus3DSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewStateRef = useRef(createTorus3DViewState());
  const [hoveredPoint, setHoveredPoint] = useState<PointId | null>(null);
  const [pickedPoint, setPickedPoint] = useState<PointId | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let textureReady = false;
    let core!: Shared3DSceneCore;
    core = createShared3DSceneCore(host, {
      canvasTestId: 'torus-3d-canvas',
      onAfterRender: () => {
        host.dataset.torus3dReady = String(textureReady);
      },
    });

    const surfaceGeometry = createTorus3DSurfaceGeometry();
    const surfaceMaterial = createShared3DWoodMaterial(
      () => {
        textureReady = true;
        core.render();
      },
      core.renderer.capabilities.getMaxAnisotropy(),
    );
    surfaceMaterial.shadowSide = THREE.BackSide;
    const surface = new THREE.Mesh(surfaceGeometry, surfaceMaterial);
    surface.castShadow = true;
    surface.receiveShadow = true;

    const markers = createMappingMarkers(size);
    core.root.add(surface, markers.mesh);
    host.dataset.torus3dSize = String(size);
    host.dataset.torus3dMappingCount = String(size * size);
    host.dataset.torus3dReady = 'false';

    const commitViewTransform = (candidate: Shared3DViewTransform): Shared3DViewTransform => {
      const next = createTorus3DViewState(candidate);
      viewStateRef.current = next;
      host.dataset.torus3dZoom = next.zoom.toFixed(4);
      host.dataset.torus3dRotation = [
        next.rotation.x,
        next.rotation.y,
        next.rotation.z,
        next.rotation.w,
      ].map((value) => value.toFixed(6)).join(',');
      return next;
    };

    const detachInput = attachShared3DPointerInput({
      core,
      getViewTransform: () => viewStateRef.current,
      commitViewTransform,
      pointFromClientPosition: (x, y) => pointFromClientPosition(core, surface, size, x, y),
      onPointHover: setHoveredPoint,
      onPointActivate: setPickedPoint,
      inputDisabled: () => false,
      zoomMin: TORUS_3D_ZOOM_MIN,
      zoomMax: TORUS_3D_ZOOM_MAX,
    });

    commitViewTransform(viewStateRef.current);
    applyShared3DViewTransform(core, viewStateRef.current);
    core.renderNow();

    return () => {
      detachInput();
      markers.geometry.dispose();
      markers.material.dispose();
      surfaceGeometry.dispose();
      surfaceMaterial.dispose();
      core.dispose();
    };
  }, [size]);

  return (
    <div className="torus-3d-foundation-scene">
      <div
        ref={hostRef}
        className="torus-3d-scene"
        aria-label="Torus 3D foundation scene"
        data-torus3d-hovered-point={hoveredPoint ?? ''}
        data-torus3d-picked-point={pickedPoint ?? ''}
      />
      <div className="torus-3d-foundation-label" aria-hidden="true">
        Torus 3D foundation · mapping {size}×{size}
      </div>
    </div>
  );
}
