import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { PointId } from '../core/topology/Topology';
import type { TorusSize } from '../core/topology/TorusTopology';
import type { GamePointHoverStatus } from '../presentation/GamePointHoverStatus';
import type { GameViewModel } from '../presentation/PresentationModel';
import {
  createTorus3DViewState,
  TORUS_3D_ZOOM_MAX,
  TORUS_3D_ZOOM_MIN,
} from '../presentation/Torus3DViewState';
import {
  createShared3DHoverMarker,
  createShared3DStoneGeometry,
  createShared3DStoneMaterials,
  updateShared3DHoverMarker,
  type Shared3DHoverMarker,
} from './Shared3DGameplayVisuals';
import {
  applyShared3DViewTransform,
  attachShared3DPointerInput,
  createShared3DSceneCore,
  type Shared3DSceneCore,
  type Shared3DViewTransform,
} from './Shared3DSceneCore';
import { animateShared3DStonePlacement } from './Shared3DStonePlacementAnimation';
import { createShared3DWoodMaterial } from './Shared3DWoodMaterial';
import { createTorus3DFeatureLayer, type Torus3DFeatureLayer } from './Torus3DFeatureLayer';
import {
  torus3DGridPitch,
  torus3DMarkerMatrix,
  torus3DStoneMatrix,
} from './Torus3DGameplayGeometry';
import { createTorus3DGridGeometry } from './Torus3DGridGeometry';
import {
  createTorus3DPickTargets,
  disposeTorus3DPickTargets,
  pointFromTorus3DClientPosition,
  type Torus3DPickTargets,
} from './Torus3DPicking';
import { createTorus3DSurfaceGeometry } from './Torus3DSurfaceGeometry';
import './torus3d.css';

interface Torus3DSceneRuntime {
  readonly core: Shared3DSceneCore;
  readonly surface: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  readonly blackStones: THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material>;
  readonly whiteStones: THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material>;
  readonly hoverMarker: Shared3DHoverMarker;
  readonly featureLayer: Torus3DFeatureLayer;
  readonly pickTargets: Torus3DPickTargets;
}

export interface Torus3DSceneProps {
  readonly animationMode?: 'normal' | 'disabled';
  readonly size: TorusSize;
  readonly viewModel: GameViewModel;
  readonly showMoveNumbers: boolean;
  readonly hoveredPointId: PointId | null;
  readonly hoverStatus: GamePointHoverStatus;
  readonly inputDisabled: boolean;
  readonly onPointHover: (pointId: PointId | null) => void;
  readonly onPointActivate: (pointId: PointId) => void;
}

const updateStoneInstances = (
  size: TorusSize,
  viewModel: GameViewModel,
  blackStones: THREE.InstancedMesh,
  whiteStones: THREE.InstancedMesh,
): Readonly<{ black: number; white: number }> => {
  let blackIndex = 0;
  let whiteIndex = 0;
  for (const point of viewModel.points) {
    if (point.occupancy === 'black') {
      blackStones.setMatrixAt(blackIndex, torus3DStoneMatrix(size, point.logicalPointId));
      blackIndex += 1;
    } else if (point.occupancy === 'white') {
      whiteStones.setMatrixAt(whiteIndex, torus3DStoneMatrix(size, point.logicalPointId));
      whiteIndex += 1;
    }
  }
  blackStones.count = blackIndex;
  whiteStones.count = whiteIndex;
  blackStones.instanceMatrix.needsUpdate = true;
  whiteStones.instanceMatrix.needsUpdate = true;
  return Object.freeze({ black: blackIndex, white: whiteIndex });
};

/** Gameplay Torus adapter over the same shared 3D core used by Cube. */
export function Torus3DScene({
  animationMode = 'normal',
  size,
  viewModel,
  showMoveNumbers,
  hoveredPointId,
  hoverStatus,
  inputDisabled,
  onPointHover,
  onPointActivate,
}: Torus3DSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<Torus3DSceneRuntime | null>(null);
  const previousModelRef = useRef<GameViewModel | null>(null);
  const viewStateRef = useRef(createTorus3DViewState());
  const inputDisabledRef = useRef(inputDisabled);
  const onPointHoverRef = useRef(onPointHover);
  const onPointActivateRef = useRef(onPointActivate);
  inputDisabledRef.current = inputDisabled;
  onPointHoverRef.current = onPointHover;
  onPointActivateRef.current = onPointActivate;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.dataset.torus3dReady = 'false';
    let textureReady = false;
    const core = createShared3DSceneCore(host, {
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

    const pitch = torus3DGridPitch(size);
    const gridPathGeometry = createTorus3DGridGeometry(size, pitch * 0.01);
    const gridGeometry = new LineSegmentsGeometry().setPositions(
      gridPathGeometry.getAttribute('position').array as Float32Array,
    );
    gridPathGeometry.dispose();
    const gridMaterial = new LineMaterial({
      color: 0x21170f,
      linewidth: 2,
      alphaToCoverage: true,
      depthTest: true,
      depthWrite: true,
    });
    const grid = new LineSegments2(gridGeometry, gridMaterial);
    grid.renderOrder = 1;

    const stoneGeometry = createShared3DStoneGeometry();
    const stoneMaterials = createShared3DStoneMaterials();
    const capacity = size * size;
    const blackStones = new THREE.InstancedMesh(stoneGeometry, stoneMaterials.black, capacity);
    const whiteStones = new THREE.InstancedMesh(stoneGeometry, stoneMaterials.white, capacity);
    blackStones.castShadow = whiteStones.castShadow = true;
    blackStones.count = whiteStones.count = 0;
    blackStones.renderOrder = whiteStones.renderOrder = 2;

    const hoverMarker = createShared3DHoverMarker();
    const featureLayer = createTorus3DFeatureLayer(size);
    const pickTargets = createTorus3DPickTargets(size);
    pickTargets.mesh.renderOrder = 7;
    core.root.add(
      surface,
      grid,
      blackStones,
      whiteStones,
      hoverMarker.mesh,
      featureLayer.group,
      pickTargets.mesh,
    );

    const runtime: Torus3DSceneRuntime = {
      core,
      surface,
      blackStones,
      whiteStones,
      hoverMarker,
      featureLayer,
      pickTargets,
    };
    runtimeRef.current = runtime;

    const pointFromClientPosition = (x: number, y: number): PointId | null =>
      pointFromTorus3DClientPosition({
        camera: core.camera,
        surface,
        targets: pickTargets,
        viewport: core.renderer.domElement.getBoundingClientRect(),
      }, x, y);

    const syncViewData = (state: Shared3DViewTransform): void => {
      host.dataset.torus3dZoom = state.zoom.toFixed(4);
      host.dataset.torus3dRotation = [
        state.rotation.x,
        state.rotation.y,
        state.rotation.z,
        state.rotation.w,
      ].map((value) => value.toFixed(6)).join(',');
    };

    const commitViewTransform = (candidate: Shared3DViewTransform): Shared3DViewTransform => {
      const next = createTorus3DViewState(candidate);
      viewStateRef.current = next;
      syncViewData(next);
      return next;
    };

    const detachInput = attachShared3DPointerInput({
      core,
      getViewTransform: () => viewStateRef.current,
      commitViewTransform,
      pointFromClientPosition,
      onPointHover: (pointId) => onPointHoverRef.current(pointId),
      onPointActivate: (pointId) => onPointActivateRef.current(pointId),
      inputDisabled: () => inputDisabledRef.current,
      zoomMin: TORUS_3D_ZOOM_MIN,
      zoomMax: TORUS_3D_ZOOM_MAX,
    });

    host.dataset.torus3dSize = String(size);
    host.dataset.torus3dMappingCount = String(size * size);
    host.dataset.torus3dGridLinesFirst = String(size);
    host.dataset.torus3dGridLinesSecond = String(size);
    host.dataset.torus3dGridPitch = pitch.toFixed(6);
    commitViewTransform(viewStateRef.current);
    applyShared3DViewTransform(core, viewStateRef.current);
    core.renderNow();

    return () => {
      detachInput();
      featureLayer.dispose();
      disposeTorus3DPickTargets(pickTargets);
      hoverMarker.dispose();
      stoneGeometry.dispose();
      stoneMaterials.dispose();
      gridGeometry.dispose();
      gridMaterial.dispose();
      surfaceGeometry.dispose();
      surfaceMaterial.dispose();
      core.dispose();
      runtimeRef.current = null;
    };
  }, [size]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const counts = updateStoneInstances(size, viewModel, runtime.blackStones, runtime.whiteStones);
    updateShared3DHoverMarker(
      runtime.hoverMarker,
      hoveredPointId ? torus3DMarkerMatrix(size, hoveredPointId) : null,
      viewModel.currentPlayer,
      hoverStatus,
    );
    const features = runtime.featureLayer.update(viewModel, showMoveNumbers);
    const host = hostRef.current;
    if (host) {
      host.dataset.torus3dHoveredPoint = hoveredPointId ?? '';
      host.dataset.torus3dHoverStatus = hoverStatus ?? '';
      host.dataset.torus3dBlackStoneCount = String(counts.black);
      host.dataset.torus3dWhiteStoneCount = String(counts.white);
      host.dataset.torus3dMoveNumberCount = String(features.moveNumberCount);
      host.dataset.torus3dLastMovePoint = features.lastMovePointId ?? '';
      host.dataset.torus3dPhase = viewModel.phase;
    }
    runtime.core.render();
  }, [hoverStatus, hoveredPointId, showMoveNumbers, size, viewModel]);

  useEffect(() => {
    const previous = previousModelRef.current;
    previousModelRef.current = viewModel;
    const runtime = runtimeRef.current;
    if (
      !runtime ||
      !previous ||
      animationMode === 'disabled' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      viewModel.moveNumber !== previous.moveNumber + 1
    ) return;
    const point = viewModel.points.find(
      (candidate) => candidate.logicalPointId === viewModel.lastMovePointId,
    );
    if (
      !point ||
      point.occupancy === 'empty' ||
      previous.points.find((candidate) => candidate.logicalPointId === point.logicalPointId)
        ?.occupancy !== 'empty'
    ) return;
    const stones = point.occupancy === 'black' ? runtime.blackStones : runtime.whiteStones;
    const index = viewModel.points
      .filter((candidate) => candidate.occupancy === point.occupancy)
      .findIndex((candidate) => candidate.logicalPointId === point.logicalPointId);
    if (index < 0) return;
    return animateShared3DStonePlacement({
      stones,
      instanceIndex: index,
      finalMatrix: torus3DStoneMatrix(size, point.logicalPointId),
      pitch: torus3DGridPitch(size),
      requestRender: runtime.core.render,
    });
  }, [animationMode, size, viewModel]);

  useEffect(() => {
    if (inputDisabled) onPointHoverRef.current(null);
  }, [inputDisabled]);

  return (
    <div className="torus-3d-foundation-scene">
      <div
        ref={hostRef}
        className="torus-3d-scene"
        aria-label="Torus 3D foundation scene"
      />
      <div className="torus-3d-foundation-label" aria-hidden="true">
        Torus 3D · playable {size}×{size}
      </div>
    </div>
  );
}
