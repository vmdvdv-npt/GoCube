import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CubeSize } from '../core/topology/CubeTopology';
import type { PointId } from '../core/topology/Topology';
import {
  createCube3DPickTargets,
  disposeCube3DPickTargets,
  pointFromCube3DClientPosition,
  type Cube3DPickTargets,
} from './Cube3DPicking';
import { createCube3DRoundedSurfaceGeometry } from './Cube3DSurfaceGeometry';

const VIEWPORT = Object.freeze({ left: 0, top: 0, width: 800, height: 800 });
const CAMERA_DISTANCE = 5;
const LOCAL_SURFACE_UP = new THREE.Vector3(0, 1, 0);

interface PickFixture {
  readonly camera: THREE.PerspectiveCamera;
  readonly root: THREE.Group;
  readonly surface: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly targets: Cube3DPickTargets;
  readonly surfaceGeometry: THREE.BufferGeometry;
  readonly surfaceMaterial: THREE.MeshBasicMaterial;
}

const fixtures: PickFixture[] = [];

const createFixture = (size: CubeSize): PickFixture => {
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, CAMERA_DISTANCE);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  const surfaceGeometry = createCube3DRoundedSurfaceGeometry();
  const surfaceMaterial = new THREE.MeshBasicMaterial();
  const surface = new THREE.Mesh(surfaceGeometry, surfaceMaterial);
  const targets = createCube3DPickTargets(size);
  const root = new THREE.Group();
  root.add(surface, targets.mesh);
  root.updateMatrixWorld(true);

  const fixture = { camera, root, surface, targets, surfaceGeometry, surfaceMaterial };
  fixtures.push(fixture);
  return fixture;
};

afterEach(() => {
  while (fixtures.length > 0) {
    const fixture = fixtures.pop()!;
    fixture.surfaceGeometry.dispose();
    fixture.surfaceMaterial.dispose();
    disposeCube3DPickTargets(fixture.targets);
  }
});

const pointIndex = (fixture: PickFixture, pointId: PointId): number => {
  const index = fixture.targets.pointIds.indexOf(pointId);
  if (index < 0) throw new Error(`Unknown point ${pointId}`);
  return index;
};

const localProxyMatrix = (fixture: PickFixture, pointId: PointId): THREE.Matrix4 => {
  const matrix = new THREE.Matrix4();
  fixture.targets.mesh.getMatrixAt(pointIndex(fixture, pointId), matrix);
  return matrix;
};

const localProxyPosition = (fixture: PickFixture, pointId: PointId): THREE.Vector3 =>
  new THREE.Vector3().setFromMatrixPosition(localProxyMatrix(fixture, pointId));

const localProxyNormal = (fixture: PickFixture, pointId: PointId): THREE.Vector3 =>
  LOCAL_SURFACE_UP.clone().transformDirection(localProxyMatrix(fixture, pointId));

const orientPointTowardCamera = (fixture: PickFixture, pointId: PointId): void => {
  const normal = localProxyNormal(fixture, pointId);
  fixture.root.quaternion.setFromUnitVectors(normal, new THREE.Vector3(0, 0, 1));
  fixture.root.updateMatrixWorld(true);
};

const clientPositionForPoint = (fixture: PickFixture, pointId: PointId): readonly [number, number] => {
  const world = localProxyPosition(fixture, pointId).applyMatrix4(fixture.root.matrixWorld);
  const projected = world.project(fixture.camera);
  return Object.freeze([
    VIEWPORT.left + ((projected.x + 1) / 2) * VIEWPORT.width,
    VIEWPORT.top + ((1 - projected.y) / 2) * VIEWPORT.height,
  ] as const);
};

const pick = (fixture: PickFixture, x: number, y: number): PointId | null =>
  pointFromCube3DClientPosition(
    {
      camera: fixture.camera,
      surface: fixture.surface,
      targets: fixture.targets,
      viewport: VIEWPORT,
    },
    x,
    y,
  );

const expectPointRoundTrip = (fixture: PickFixture, pointId: PointId): void => {
  orientPointTowardCamera(fixture, pointId);
  const [x, y] = clientPositionForPoint(fixture, pointId);
  expect(pick(fixture, x, y)).toBe(pointId);
};

const point = (face: string, row: number, column: number): PointId =>
  `${face}:${row}:${column}` as PointId;

describe('Cube3D logical picking', () => {
  it.each([2, 4, 7] as const)(
    'round-trips representative center-face points for Cube size %d',
    (size) => {
      const fixture = createFixture(size);
      const middle = Math.floor((size - 1) / 2);
      for (const face of ['front', 'right', 'back', 'left', 'top', 'bottom']) {
        expectPointRoundTrip(fixture, point(face, middle, middle));
      }
    },
  );

  it('round-trips points adjacent to all 12 physical edges', () => {
    const size = 5 as CubeSize;
    const last = size - 1;
    const middle = 2;
    const fixture = createFixture(size);
    const edgeRepresentatives = [
      point('front', 0, middle),
      point('front', last, middle),
      point('front', middle, 0),
      point('front', middle, last),
      point('back', 0, middle),
      point('back', last, middle),
      point('back', middle, 0),
      point('back', middle, last),
      point('left', 0, middle),
      point('left', last, middle),
      point('right', 0, middle),
      point('right', last, middle),
    ] as const;

    for (const pointId of edgeRepresentatives) expectPointRoundTrip(fixture, pointId);
  });

  it('round-trips points adjacent to all 8 physical corners', () => {
    const size = 5 as CubeSize;
    const last = size - 1;
    const fixture = createFixture(size);
    const cornerRepresentatives = [
      point('front', 0, 0),
      point('front', 0, last),
      point('front', last, 0),
      point('front', last, last),
      point('back', 0, 0),
      point('back', 0, last),
      point('back', last, 0),
      point('back', last, last),
    ] as const;

    for (const pointId of cornerRepresentatives) expectPointRoundTrip(fixture, pointId);
  });

  it('returns null for background outside the rounded Cube surface', () => {
    const fixture = createFixture(4);
    expect(pick(fixture, 8, 8)).toBeNull();
  });

  it('does not select a hidden back-side point through the visible surface', () => {
    const fixture = createFixture(5);
    const hidden = point('back', 2, 2);
    const [x, y] = clientPositionForPoint(fixture, hidden);
    expect(pick(fixture, x, y)).not.toBe(hidden);
  });

  it('keeps neighboring front-face hit areas unambiguous', () => {
    const size = 7 as CubeSize;
    const fixture = createFixture(size);
    for (let row = 0; row < size; row += 1) {
      for (let column = 0; column < size; column += 1) {
        const pointId = point('front', row, column);
        const [x, y] = clientPositionForPoint(fixture, pointId);
        expect(pick(fixture, x, y)).toBe(pointId);
      }
    }
  });

  it('preserves logical identity across arbitrary rotations and zoom levels', () => {
    const fixture = createFixture(5);
    const pointId = point('right', 2, 2);
    orientPointTowardCamera(fixture, pointId);
    fixture.root.rotateZ(0.37);
    fixture.root.updateMatrixWorld(true);

    for (const zoom of [0.78, 1, 2.25]) {
      fixture.camera.position.set(0, 0, CAMERA_DISTANCE / zoom);
      fixture.camera.lookAt(0, 0, 0);
      fixture.camera.updateMatrixWorld(true);
      const [x, y] = clientPositionForPoint(fixture, pointId);
      expect(x).toBeGreaterThanOrEqual(VIEWPORT.left);
      expect(x).toBeLessThanOrEqual(VIEWPORT.left + VIEWPORT.width);
      expect(y).toBeGreaterThanOrEqual(VIEWPORT.top);
      expect(y).toBeLessThanOrEqual(VIEWPORT.top + VIEWPORT.height);
      expect(pick(fixture, x, y)).toBe(pointId);
    }
  });
});
