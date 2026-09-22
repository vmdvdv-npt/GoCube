import * as THREE from 'three';
import type { CubeSize } from '../core/topology/CubeTopology';
import type { PointId } from '../core/topology/Topology';
import {
  ENDGAME_PRESENTATION_STYLES,
  ENDGAME_TERRITORY_MARKER_RADIUS_FRACTION,
  type EndgamePresentationModel,
} from '../presentation/EndgamePresentation';
import type { GameViewModel } from '../presentation/PresentationModel';
import {
  CUBE_3D_STONE_DIAMETER_PITCH_RATIO,
  CUBE_3D_STONE_LIFT_PITCH_RATIO,
  cube3DGridPitch,
  cube3DSurfaceAlignedMatrix,
} from './Cube3DGameplayGeometry';
import { createCube3DFeaturePresentation } from './Cube3DFeaturePresentation';

const DISC_THICKNESS = 0.08;
const REVIEW_DISC_SEGMENTS = 48;
const MOVE_LABEL_TEXTURE_SIZE = 128;
export const CUBE_3D_REVIEW_SURFACE_LIFT_PITCH_RATIO = 0.006;
export const CUBE_3D_REVIEW_DISC_SCALE = 1.24;
export const CUBE_3D_REVIEW_DISC_HOVER_SCALE = 1.28;
export const CUBE_3D_REVIEW_DISC_SELECTED_SCALE = 1.32;

export interface Cube3DFeatureLayerDiagnostics {
  readonly blackTerritoryCount: number;
  readonly whiteTerritoryCount: number;
  readonly deadReviewCount: number;
  readonly unresolvedReviewCount: number;
  readonly sekiReviewCount: number;
  readonly moveNumberCount: number;
  readonly lastMovePointId: PointId | null;
}

export interface Cube3DFeatureLayer {
  readonly group: THREE.Group;
  update(
    viewModel: GameViewModel,
    endgamePresentation: EndgamePresentationModel | null,
    showMoveNumbers: boolean,
  ): Cube3DFeatureLayerDiagnostics;
  dispose(): void;
}

const setInstance = (
  mesh: THREE.InstancedMesh,
  index: number,
  matrix: THREE.Matrix4,
): number => {
  mesh.setMatrixAt(index, matrix);
  return index + 1;
};

const finishInstances = (mesh: THREE.InstancedMesh, count: number): void => {
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
};

export const cube3DReviewSurfaceMatrix = (
  size: CubeSize,
  pointId: PointId,
  scale: number,
): THREE.Matrix4 =>
  cube3DSurfaceAlignedMatrix(
    size,
    pointId,
    cube3DGridPitch(size) * CUBE_3D_REVIEW_SURFACE_LIFT_PITCH_RATIO,
    scale,
  );

const numberTexture = (
  cache: Map<string, THREE.CanvasTexture>,
  moveNumber: number,
  occupancy: 'black' | 'white',
): THREE.CanvasTexture => {
  const key = `${occupancy}:${String(moveNumber)}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = MOVE_LABEL_TEXTURE_SIZE;
  canvas.height = MOVE_LABEL_TEXTURE_SIZE;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Cube 3D move-number canvas is unavailable');

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = occupancy === 'black' ? '#f2f0e9' : '#15181b';
  const digits = String(moveNumber).length;
  const fontSize = digits <= 2 ? 74 : digits === 3 ? 60 : 48;
  context.font = `700 ${String(fontSize)}px system-ui, sans-serif`;
  context.fillText(String(moveNumber), canvas.width / 2, canvas.height / 2 + 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  cache.set(key, texture);
  return texture;
};

export const createCube3DFeatureLayer = (size: CubeSize): Cube3DFeatureLayer => {
  const capacity = 6 * size * size;
  const pitch = cube3DGridPitch(size);
  const stoneRadius = (pitch * CUBE_3D_STONE_DIAMETER_PITCH_RATIO) / 2;
  const stoneCenterLift = pitch * CUBE_3D_STONE_LIFT_PITCH_RATIO + stoneRadius * 0.03;
  const stoneTopLift = stoneCenterLift + stoneRadius * 0.38;
  const group = new THREE.Group();
  group.name = 'cube3d-feature-layer';

  const discGeometry = new THREE.CylinderGeometry(1, 1, DISC_THICKNESS, 24);
  const reviewDiscGeometry = new THREE.CircleGeometry(1, REVIEW_DISC_SEGMENTS);
  reviewDiscGeometry.rotateX(-Math.PI / 2);
  const blackTerritoryMaterial = new THREE.MeshBasicMaterial({ color: 0x111111 });
  const whiteTerritoryMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const blackTerritory = new THREE.InstancedMesh(discGeometry, blackTerritoryMaterial, capacity);
  const whiteTerritory = new THREE.InstancedMesh(discGeometry, whiteTerritoryMaterial, capacity);

  const deadColor = ENDGAME_PRESENTATION_STYLES.dead.contourColor ?? '#e52b2b';
  const unresolvedColor = ENDGAME_PRESENTATION_STYLES.unresolved.contourColor ?? '#f8cf4d';
  const deadMaterial = new THREE.MeshBasicMaterial({ color: deadColor, side: THREE.DoubleSide });
  const unresolvedMaterial = new THREE.MeshBasicMaterial({
    color: unresolvedColor,
    side: THREE.DoubleSide,
  });
  const deadDiscs = new THREE.InstancedMesh(reviewDiscGeometry, deadMaterial, capacity);
  const unresolvedDiscs = new THREE.InstancedMesh(reviewDiscGeometry, unresolvedMaterial, capacity);
  deadDiscs.name = 'cube3d-endgame-dead-discs';
  unresolvedDiscs.name = 'cube3d-endgame-unresolved-discs';

  const sekiContourColor =
    ENDGAME_PRESENTATION_STYLES.seki.contourColor ??
    ENDGAME_PRESENTATION_STYLES.seki.maskColor ??
    '#80878f';
  const sekiMaskColor = ENDGAME_PRESENTATION_STYLES.seki.maskColor ?? sekiContourColor;
  const sekiOpacity = ENDGAME_PRESENTATION_STYLES.seki.maskOpacity;
  const sekiStoneMaterial = new THREE.MeshBasicMaterial({
    color: sekiContourColor,
    side: THREE.DoubleSide,
  });
  const sekiPointMaterial = new THREE.MeshBasicMaterial({
    color: sekiMaskColor,
    transparent: true,
    opacity: sekiOpacity,
    depthWrite: false,
  });
  const sekiStoneDiscs = new THREE.InstancedMesh(reviewDiscGeometry, sekiStoneMaterial, capacity);
  const sekiPointMasks = new THREE.InstancedMesh(discGeometry, sekiPointMaterial, capacity);
  sekiStoneDiscs.name = 'cube3d-endgame-seki-stone-discs';
  sekiPointMasks.name = 'cube3d-endgame-seki-point-masks';

  const lastMoveMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const lastMoveMarker = new THREE.Mesh(discGeometry, lastMoveMaterial);
  lastMoveMarker.visible = false;
  lastMoveMarker.matrixAutoUpdate = false;

  const moveLabels = new THREE.Group();
  moveLabels.name = 'cube3d-move-labels';
  const textureCache = new Map<string, THREE.CanvasTexture>();

  for (const mesh of [
    blackTerritory,
    whiteTerritory,
    deadDiscs,
    unresolvedDiscs,
    sekiStoneDiscs,
    sekiPointMasks,
  ]) {
    mesh.count = 0;
    mesh.renderOrder = 3;
    mesh.frustumCulled = false;
  }
  deadDiscs.renderOrder = 4;
  unresolvedDiscs.renderOrder = 4;
  sekiStoneDiscs.renderOrder = 4;
  sekiPointMasks.renderOrder = 4;
  lastMoveMarker.renderOrder = 5;
  moveLabels.renderOrder = 6;

  group.add(
    blackTerritory,
    whiteTerritory,
    deadDiscs,
    unresolvedDiscs,
    sekiStoneDiscs,
    sekiPointMasks,
    lastMoveMarker,
    moveLabels,
  );

  const clearMoveLabels = (): void => {
    for (const child of [...moveLabels.children]) {
      moveLabels.remove(child);
      if (child instanceof THREE.Sprite) child.material.dispose();
    }
  };

  const update = (
    viewModel: GameViewModel,
    endgamePresentation: EndgamePresentationModel | null,
    showMoveNumbers: boolean,
  ): Cube3DFeatureLayerDiagnostics => {
    const projection = createCube3DFeaturePresentation({
      viewModel,
      endgamePresentation,
      showMoveNumbers,
    });
    let blackTerritoryCount = 0;
    let whiteTerritoryCount = 0;
    let deadReviewCount = 0;
    let unresolvedReviewCount = 0;
    let sekiStoneCount = 0;
    let sekiPointCount = 0;
    let lastMovePointId: PointId | null = null;

    clearMoveLabels();

    for (const point of projection.points) {
      if (point.territoryOwner) {
        const matrix = cube3DSurfaceAlignedMatrix(
          size,
          point.pointId,
          pitch * 0.075,
          pitch * ENDGAME_TERRITORY_MARKER_RADIUS_FRACTION,
        );
        if (point.territoryOwner === 'black') {
          blackTerritoryCount = setInstance(blackTerritory, blackTerritoryCount, matrix);
        } else {
          whiteTerritoryCount = setInstance(whiteTerritory, whiteTerritoryCount, matrix);
        }
      }

      const reviewScale = point.reviewSelected
        ? CUBE_3D_REVIEW_DISC_SELECTED_SCALE
        : point.reviewHovered
          ? CUBE_3D_REVIEW_DISC_HOVER_SCALE
          : CUBE_3D_REVIEW_DISC_SCALE;
      if (point.reviewStatus === 'dead' || point.reviewStatus === 'unresolved') {
        const matrix = cube3DReviewSurfaceMatrix(
          size,
          point.pointId,
          stoneRadius * reviewScale,
        );
        if (point.reviewStatus === 'dead') {
          deadReviewCount = setInstance(deadDiscs, deadReviewCount, matrix);
        } else {
          unresolvedReviewCount = setInstance(unresolvedDiscs, unresolvedReviewCount, matrix);
        }
      }

      if (point.sekiRegion) {
        if (point.occupancy === 'black' || point.occupancy === 'white') {
          const matrix = cube3DReviewSurfaceMatrix(
            size,
            point.pointId,
            stoneRadius * reviewScale,
          );
          sekiStoneCount = setInstance(sekiStoneDiscs, sekiStoneCount, matrix);
        } else {
          const matrix = cube3DReviewSurfaceMatrix(
            size,
            point.pointId,
            stoneRadius * 0.92,
          );
          sekiPointCount = setInstance(sekiPointMasks, sekiPointCount, matrix);
        }
      }

      if (point.lastMove && (point.occupancy === 'black' || point.occupancy === 'white')) {
        lastMovePointId = point.pointId;
        lastMoveMarker.visible = true;
        lastMoveMarker.matrix.copy(
          cube3DSurfaceAlignedMatrix(
            size,
            point.pointId,
            stoneTopLift + pitch * 0.02,
            stoneRadius * 0.17,
          ),
        );
        lastMoveMarker.matrixWorldNeedsUpdate = true;
        lastMoveMaterial.color.setHex(point.occupancy === 'black' ? 0xffffff : 0x111111);
      }

      if (
        point.moveNumber !== null &&
        (point.occupancy === 'black' || point.occupancy === 'white')
      ) {
        const texture = numberTexture(textureCache, point.moveNumber, point.occupancy);
        const material = new THREE.SpriteMaterial({
          map: texture,
          transparent: true,
          depthTest: true,
          depthWrite: false,
        });
        const sprite = new THREE.Sprite(material);
        const matrix = cube3DSurfaceAlignedMatrix(
          size,
          point.pointId,
          stoneTopLift + pitch * 0.025,
        );
        sprite.position.setFromMatrixPosition(matrix);
        const labelSize = pitch * 0.33;
        sprite.scale.set(labelSize, labelSize, 1);
        sprite.renderOrder = 6;
        moveLabels.add(sprite);
      }
    }

    if (!lastMovePointId) lastMoveMarker.visible = false;

    finishInstances(blackTerritory, blackTerritoryCount);
    finishInstances(whiteTerritory, whiteTerritoryCount);
    finishInstances(deadDiscs, deadReviewCount);
    finishInstances(unresolvedDiscs, unresolvedReviewCount);
    finishInstances(sekiStoneDiscs, sekiStoneCount);
    finishInstances(sekiPointMasks, sekiPointCount);

    return Object.freeze({
      blackTerritoryCount,
      whiteTerritoryCount,
      deadReviewCount,
      unresolvedReviewCount,
      sekiReviewCount: sekiStoneCount + sekiPointCount,
      moveNumberCount: moveLabels.children.length,
      lastMovePointId,
    });
  };

  const dispose = (): void => {
    clearMoveLabels();
    for (const texture of textureCache.values()) texture.dispose();
    textureCache.clear();
    discGeometry.dispose();
    reviewDiscGeometry.dispose();
    blackTerritoryMaterial.dispose();
    whiteTerritoryMaterial.dispose();
    deadMaterial.dispose();
    unresolvedMaterial.dispose();
    sekiStoneMaterial.dispose();
    sekiPointMaterial.dispose();
    lastMoveMaterial.dispose();
    group.clear();
  };

  return Object.freeze({ group, update, dispose });
};
