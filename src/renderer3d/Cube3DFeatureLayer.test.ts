import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  ENDGAME_GROUP_HOVER_COLOR,
  type EndgamePresentationModel,
} from '../presentation/EndgamePresentation';
import type { GameViewModel } from '../presentation/PresentationModel';
import { cube3DReviewContourGridLoops } from './Cube3DEndgameContourGeometry';
import {
  CUBE_3D_REVIEW_CONTOUR_HOVER_WIDTH_PITCH_RATIO,
  CUBE_3D_REVIEW_CONTOUR_SELECTED_WIDTH_PITCH_RATIO,
  CUBE_3D_REVIEW_CONTOUR_WIDTH_PITCH_RATIO,
  CUBE_3D_REVIEW_SURFACE_LIFT_PITCH_RATIO,
  createCube3DFeatureLayer,
} from './Cube3DFeatureLayer';
import {
  CUBE_3D_STONE_DIAMETER_PITCH_RATIO,
  cube3DGridPitch,
  cube3DStoneMatrix,
} from './Cube3DGameplayGeometry';
import { cube3DPointSample } from './Cube3DSurfaceGeometry';

const size = 7 as const;

const viewModel: GameViewModel = Object.freeze({
  points: Object.freeze([
    Object.freeze({ logicalPointId: 'front:3:3', occupancy: 'black' as const, moveNumber: 1 }),
    Object.freeze({ logicalPointId: 'front:3:2', occupancy: 'black' as const, moveNumber: 2 }),
    Object.freeze({ logicalPointId: 'front:3:4', occupancy: 'white' as const, moveNumber: 3 }),
    Object.freeze({ logicalPointId: 'front:4:3', occupancy: 'black' as const, moveNumber: 4 }),
    Object.freeze({ logicalPointId: 'front:4:4', occupancy: 'empty' as const, moveNumber: null }),
  ]),
  currentPlayer: 'black',
  moveNumber: 5,
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
      points: Object.freeze(['front:3:3', 'front:3:2']),
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
  contours: Object.freeze([
    Object.freeze({
      status: 'dead' as const,
      color: 'black' as const,
      groupIds: Object.freeze(['dead-group']),
      points: Object.freeze(['front:3:3', 'front:3:2']),
      edges: Object.freeze([]),
      contourColor: '#e52b2b',
      selected: false,
      hovered: false,
    }),
    Object.freeze({
      status: 'unresolved' as const,
      color: 'white' as const,
      groupIds: Object.freeze(['unresolved-group']),
      points: Object.freeze(['front:3:4']),
      edges: Object.freeze([]),
      contourColor: '#f8cf4d',
      selected: false,
      hovered: false,
    }),
  ]),
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

const featureMesh = (
  layer: ReturnType<typeof createCube3DFeatureLayer>,
  meshName: string,
): THREE.InstancedMesh => {
  const mesh = layer.group.getObjectByName(meshName);
  if (!(mesh instanceof THREE.InstancedMesh)) {
    throw new Error(`Missing Cube 3D feature mesh: ${meshName}`);
  }
  return mesh;
};

const instanceLift = (
  layer: ReturnType<typeof createCube3DFeatureLayer>,
  meshName: string,
  pointId: string,
): number => {
  const mesh = featureMesh(layer, meshName);
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(0, matrix);
  const position = new THREE.Vector3().setFromMatrixPosition(matrix);
  const sample = cube3DPointSample(size, pointId);
  const surface = new THREE.Vector3(...sample.position);
  const normal = new THREE.Vector3(...sample.normal).normalize();
  return position.sub(surface).dot(normal);
};

describe('Cube3DFeatureLayer endgame contours', () => {
  it('keeps review geometry below the stones so the inward overlap is occluded', () => {
    const layer = createCube3DFeatureLayer(size);
    const diagnostics = layer.update(viewModel, endgamePresentation, false);

    const expectedLift = cube3DGridPitch(size) * CUBE_3D_REVIEW_SURFACE_LIFT_PITCH_RATIO;
    expect(instanceLift(layer, 'cube3d-endgame-seki-point-masks', 'front:4:4')).toBeCloseTo(
      expectedLift,
      6,
    );

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
    expect(diagnostics.deadReviewCount).toBe(2);
    expect(diagnostics.unresolvedReviewCount).toBe(1);
    expect(diagnostics.sekiReviewCount).toBe(2);

    layer.dispose();
  });

  it('renders one continuous outer ribbon instead of filled discs between group stones', () => {
    const layer = createCube3DFeatureLayer(size);
    layer.update(viewModel, endgamePresentation, false);

    const reviewContours = layer.group.getObjectByName('cube3d-endgame-review-contours');
    expect(reviewContours).toBeInstanceOf(THREE.Group);
    expect(reviewContours?.children).toHaveLength(3);

    const deadContour = layer.group.getObjectByName('cube3d-endgame-dead-contour-0');
    expect(deadContour).toBeInstanceOf(THREE.Mesh);
    if (!(deadContour instanceof THREE.Mesh)) throw new Error('Missing dead contour mesh');
    expect(deadContour.geometry).toBeInstanceOf(THREE.BufferGeometry);
    expect(deadContour.geometry).not.toBeInstanceOf(THREE.CircleGeometry);
    expect(deadContour.geometry.getAttribute('position').count).toBeGreaterThan(0);
    expect(deadContour.material).toBeInstanceOf(THREE.MeshBasicMaterial);
    if (!(deadContour.material instanceof THREE.MeshBasicMaterial)) {
      throw new Error('Unexpected dead contour material');
    }
    expect(deadContour.material.depthTest).toBe(true);
    expect(deadContour.material.depthWrite).toBe(false);

    expect(layer.group.getObjectByName('cube3d-endgame-dead-discs')).toBeUndefined();
    expect(layer.group.getObjectByName('cube3d-endgame-unresolved-discs')).toBeUndefined();
    expect(layer.group.getObjectByName('cube3d-endgame-seki-stone-discs')).toBeUndefined();

    layer.dispose();
  });

  it('keeps the hover material at the exact UI accent instead of tone-mapping it', () => {
    const layer = createCube3DFeatureLayer(size);
    layer.update(viewModel, endgamePresentation, false);

    const hoverContour = layer.group.getObjectByName('cube3d-endgame-hover-contour-dead-group');
    expect(hoverContour).toBeInstanceOf(THREE.Mesh);
    if (!(hoverContour instanceof THREE.Mesh)) throw new Error('Missing hover contour mesh');
    expect(hoverContour.material).toBeInstanceOf(THREE.MeshBasicMaterial);
    if (!(hoverContour.material instanceof THREE.MeshBasicMaterial)) {
      throw new Error('Unexpected hover contour material');
    }

    expect(hoverContour.material.color.getHexString()).toBe(
      new THREE.Color(ENDGAME_GROUP_HOVER_COLOR).getHexString(),
    );
    expect(hoverContour.material.toneMapped).toBe(false);

    layer.dispose();
  });

  it('creates filled review hit targets for every logical group', () => {
    const layer = createCube3DFeatureLayer(size);
    layer.update(viewModel, endgamePresentation, false);

    const hitTargets = layer.group.getObjectByName('cube3d-endgame-review-hit-targets');
    expect(hitTargets).toBeInstanceOf(THREE.Group);
    expect(hitTargets?.children).toHaveLength(endgamePresentation.groups.length);

    for (const child of hitTargets?.children ?? []) {
      expect(child).toBeInstanceOf(THREE.Mesh);
      if (!(child instanceof THREE.Mesh)) continue;
      expect(child.geometry.getAttribute('position').count).toBeGreaterThan(0);
      expect(child.geometry.getIndex()?.count ?? 0).toBeGreaterThan(0);
      expect(typeof child.userData.endgameRepresentativePointId).toBe('string');
    }

    layer.dispose();
  });

  it('rounds a single-stone contour around the stone instead of producing inward spikes', () => {
    const loops = cube3DReviewContourGridLoops(size, ['front:3:3']);
    expect(loops).toHaveLength(1);
    const loop = loops[0]!;

    for (const point of loop.points) {
      expect(Math.hypot(point.x - 3, point.y - 3)).toBeCloseTo(0.5, 6);
    }
  });

  it('keeps straight group sides continuous and removes the internal edge between neighbours', () => {
    const loops = cube3DReviewContourGridLoops(size, ['front:3:2', 'front:3:3']);
    expect(loops).toHaveLength(1);
    const loop = loops[0]!;

    const internalEdgeSamples = loop.points.filter(
      (point) =>
        Math.abs(point.x - 2.5) < 1e-9 && point.y > 2.5 + 1e-6 && point.y < 3.5 - 1e-6,
    );
    expect(internalEdgeSamples).toHaveLength(0);

    const topStraight = loop.points.filter(
      (point) => point.x > 2 && point.x < 3 && Math.abs(point.y - 2.5) < 1e-9,
    );
    expect(topStraight.length).toBeGreaterThan(1);
    expect(topStraight.every((point) => Math.abs(point.y - 2.5) < 1e-9)).toBe(true);
  });

  it('overlaps the stone silhouette enough to avoid board-colored slivers in 3D', () => {
    const pitch = cube3DGridPitch(size);
    const stoneRadius = (pitch * CUBE_3D_STONE_DIAMETER_PITCH_RATIO) / 2;
    const contourCenterRadius = pitch / 2;
    const baseStrokeWidth = pitch * CUBE_3D_REVIEW_CONTOUR_WIDTH_PITCH_RATIO;
    const innerContourEdge = contourCenterRadius - baseStrokeWidth / 2;
    const inwardOverlap = stoneRadius - innerContourEdge;

    expect(inwardOverlap).toBeGreaterThanOrEqual(pitch * 0.015);
    expect(inwardOverlap).toBeLessThanOrEqual(pitch * 0.025);
    expect(CUBE_3D_REVIEW_CONTOUR_HOVER_WIDTH_PITCH_RATIO).toBe(
      CUBE_3D_REVIEW_CONTOUR_WIDTH_PITCH_RATIO,
    );
    expect(CUBE_3D_REVIEW_CONTOUR_SELECTED_WIDTH_PITCH_RATIO).toBeGreaterThan(
      CUBE_3D_REVIEW_CONTOUR_WIDTH_PITCH_RATIO,
    );
  });
});