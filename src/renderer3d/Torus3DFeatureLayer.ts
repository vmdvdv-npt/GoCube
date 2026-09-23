import * as THREE from 'three';
import type { PointId } from '../core/topology/Topology';
import type { TorusSize } from '../core/topology/TorusTopology';
import type { GameViewModel } from '../presentation/PresentationModel';
import {
  SHARED_3D_STONE_DIAMETER_PITCH_RATIO,
  SHARED_3D_STONE_LIFT_PITCH_RATIO,
} from './Shared3DGameplayVisuals';
import { torus3DGridPitch, torus3DSurfaceAlignedMatrix } from './Torus3DGameplayGeometry';

const DISC_THICKNESS = 0.08;
const MOVE_LABEL_TEXTURE_SIZE = 128;

export interface Torus3DFeatureLayerDiagnostics {
  readonly moveNumberCount: number;
  readonly lastMovePointId: PointId | null;
}

export interface Torus3DFeatureLayer {
  readonly group: THREE.Group;
  update(viewModel: GameViewModel, showMoveNumbers: boolean): Torus3DFeatureLayerDiagnostics;
  dispose(): void;
}

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
  if (!context) throw new Error('Torus 3D move-number canvas is unavailable');
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

export const createTorus3DFeatureLayer = (size: TorusSize): Torus3DFeatureLayer => {
  const pitch = torus3DGridPitch(size);
  const stoneRadius = (pitch * SHARED_3D_STONE_DIAMETER_PITCH_RATIO) / 2;
  const stoneCenterLift = pitch * SHARED_3D_STONE_LIFT_PITCH_RATIO + stoneRadius * 0.03;
  const stoneTopLift = stoneCenterLift + stoneRadius * 0.38;
  const group = new THREE.Group();
  group.name = 'torus3d-feature-layer';

  const discGeometry = new THREE.CylinderGeometry(1, 1, DISC_THICKNESS, 24);
  const lastMoveMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const lastMoveMarker = new THREE.Mesh(discGeometry, lastMoveMaterial);
  lastMoveMarker.visible = false;
  lastMoveMarker.matrixAutoUpdate = false;
  lastMoveMarker.renderOrder = 5;

  const moveLabels = new THREE.Group();
  moveLabels.name = 'torus3d-move-labels';
  moveLabels.renderOrder = 6;
  const textureCache = new Map<string, THREE.CanvasTexture>();
  group.add(lastMoveMarker, moveLabels);

  const clearMoveLabels = (): void => {
    for (const child of [...moveLabels.children]) {
      moveLabels.remove(child);
      if (child instanceof THREE.Sprite) child.material.dispose();
    }
  };

  const update = (
    viewModel: GameViewModel,
    showMoveNumbers: boolean,
  ): Torus3DFeatureLayerDiagnostics => {
    clearMoveLabels();
    let lastMovePointId: PointId | null = null;
    const lastMove = viewModel.lastMovePointId ?? null;

    for (const point of viewModel.points) {
      if (point.logicalPointId === lastMove && (point.occupancy === 'black' || point.occupancy === 'white')) {
        lastMovePointId = point.logicalPointId;
        lastMoveMarker.visible = true;
        lastMoveMarker.matrix.copy(
          torus3DSurfaceAlignedMatrix(
            size,
            point.logicalPointId,
            stoneTopLift + pitch * 0.02,
            stoneRadius * 0.17,
          ),
        );
        lastMoveMarker.matrixWorldNeedsUpdate = true;
        lastMoveMaterial.color.setHex(point.occupancy === 'black' ? 0xffffff : 0x111111);
      }

      if (
        showMoveNumbers &&
        point.moveNumber !== null &&
        point.moveNumber !== undefined &&
        (point.occupancy === 'black' || point.occupancy === 'white')
      ) {
        const material = new THREE.SpriteMaterial({
          map: numberTexture(textureCache, point.moveNumber, point.occupancy),
          transparent: true,
          depthTest: true,
          depthWrite: false,
        });
        const sprite = new THREE.Sprite(material);
        const matrix = torus3DSurfaceAlignedMatrix(
          size,
          point.logicalPointId,
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
    return Object.freeze({
      moveNumberCount: moveLabels.children.length,
      lastMovePointId,
    });
  };

  return Object.freeze({
    group,
    update,
    dispose: () => {
      clearMoveLabels();
      for (const texture of textureCache.values()) texture.dispose();
      textureCache.clear();
      discGeometry.dispose();
      lastMoveMaterial.dispose();
    },
  });
};
