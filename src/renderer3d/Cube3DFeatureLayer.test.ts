import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { EndgamePresentationModel } from '../presentation/EndgamePresentation';
import type { GameViewModel } from '../presentation/PresentationModel';
import {
  CUBE_3D_REVIEW_SURFACE_LIFT_PITCH_RATIO,
  createCube3DFeatureLayer,
} from './Cube3DFeatureLayer';
import { cube3DGridPitch, cube3DStoneMatrix } from './Cube3DGameplayGeometry';
import { cube3DPointSample } from './Cube3DSurfaceGeometry';

const size = 7 as const;

const viewModel: GameViewModel = Object.freeze({
  points: Object.freeze([
    Object.freeze({ logicalPointId: 'front:3:3', occupancy: 'black' as const, moveNumber: 1 }),
    Object.freeze({ logicalPointId: 'front:3:4', occupancy: 'white' as const, moveNumber: 2 }),
    Object.freeze({ logicalPointId: 'front:4:3', occupancy: 'black' as const, moveNumber: 3 }),
    Object.freeze({ logicalPointId: 'front:4:4', occupancy: 'empty' as const, moveNumber: null }),
  ]),
  currentPlayer: 'black',
  moveNumber: 4,
  consecutivePasses: 2,
  phase: 'endgame',
  captures: Object.freeze({ black: 0, white: 0 }),
  ruleSet: 'chinese',
  komi: 0.5,
  finalScore: null,
  lastMovePointId: null,
});

const endgamePresentation: EndgamePresentationModel = Object.freeze({
  groups: Object.freeze([
    Object.freeze({
      id: 'dead-group',
      color: 'black' as const,
      points: Object.freeze(['front:3:3']),
      edges: Object.freeze([]),
      status: 'dead' as const,
      selected: false,
      hovered: false,
    }),
    Object.freeze({
      id: 'unresolved-group',
      color: 'white' as const,
      points: Object.freeze(['front:3:4']),
      edges: Object.freeze([]),
      status: 'unresolved' as const,
      selected: false,
      hovered: false,
    }),
    Object.freeze({
      id: 'seki-group',
      color: 'black' as const,
      points: Object.freeze(['front:4:3']),
      edges: Object.freeze([]),
      status: 'seki' as const,
      selected: false,
      hovered: false,
    }),
  ]),
  contours: Object.freeze([]),
  sekiRegions: Object.freeze([
    Object.freeze({
      id: 'seki:group',
      status: 'seki' as const,
      groupIds: Object.freeze(['seki-group']),
      points: Object.freeze(['front:4:3', 'front:4:4']),
      edges: Object.freeze([]),
      contourColor: '#80878f',
      maskColor: '#80878f',
      maskOpacity: 0.6,
      selected: false,
      hovered: false,
    }),
  ]),
  territory: new Map(),
});

const instanceLift = (
  layer: ReturnType<typeof createCube3DFeatureLayer>,
  meshName: string,
  pointId: string,
): number => {
  const mesh = layer.group.getObjectByName(meshName);
  if (!(mesh instanceof THREE.InstancedMesh)) {
    throw new Error(`Missing Cube 3D feature mesh: ${meshName}`);
  }
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(0, matrix);
  const position = new THREE.Vector3().setFromMatrixPosition(matrix);
  const sample = cube3DPointSample(size, pointId);
  const surface = new THREE.Vector3(...sample.position);
  const normal = new THREE.Vector3(...sample.normal).normalize();
  return position.sub(surface).dot(normal);
};

describe('Cube3DFeatureLayer endgame depth', () => {
  it('keeps dead, unresolved and seki annotations on the grid surface below stones', () => {
    const layer = createCube3DFeatureLayer(size);
    layer.update(viewModel, endgamePresentation, false);

    const expectedLift = cube3DGridPitch(size) * CUBE_3D_REVIEW_SURFACE_LIFT_PITCH_RATIO;
    const annotations = [
      ['cube3d-endgame-dead-rings', 'front:3:3'],
      ['cube3d-endgame-unresolved-rings', 'front:3:4'],
      ['cube3d-endgame-seki-stone-rings', 'front:4:3'],
      ['cube3d-endgame-seki-point-masks', 'front:4:4'],
    ] as const;

    for (const [meshName, pointId] of annotations) {
      expect(instanceLift(layer, meshName, pointId)).toBeCloseTo(expectedLift, 8);
    }

    const deadSurface = cube3DPointSample(size, 'front:3:3');
    const deadNormal = new THREE.Vector3(...deadSurface.normal).normalize();
    const stonePosition = new THREE.Vector3().setFromMatrixPosition(
      cube3DStoneMatrix(size, 'front:3:3'),
    );
    const stoneLift = stonePosition
      .sub(new THREE.Vector3(...deadSurface.position))
      .dot(deadNormal);

    expect(expectedLift).toBeLessThan(cube3DGridPitch(size) * 0.01);
    expect(expectedLift).toBeLessThan(stoneLift * 0.15);

    layer.dispose();
  });
});
