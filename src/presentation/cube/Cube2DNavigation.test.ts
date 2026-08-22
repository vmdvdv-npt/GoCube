import { describe, expect, it } from 'vitest';
import { CUBE_FACES, CubeTopology, type CubeSize } from '../../core/topology/CubeTopology';
import { CUBE_2D_CENTER, createCube2DLayout } from './Cube2DLayout';
import {
  createCube2DViewState,
  navigateCube2DViewState,
  type Cube2DNavigationDirection,
} from './Cube2DNavigation';
import { CubeOrientation } from './CubeOrientation';

const CUBE_VIEW_CONTRACT_SIZES = [2, 3, 4, 5, 6, 7, 8, 10] as const satisfies readonly CubeSize[];

const allOrientations = (): readonly CubeOrientation[] => {
  const queue = [new CubeOrientation()];
  const result = new Map<string, CubeOrientation>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    const key = `${current.centerFace}:${current.upFace}`;
    if (result.has(key)) continue;
    result.set(key, current);
    queue.push(current.moveLeft(), current.moveRight(), current.moveUp(), current.moveDown());
  }

  return [...result.values()];
};

const moveOrientation = (
  orientation: CubeOrientation,
  direction: Cube2DNavigationDirection,
): CubeOrientation => {
  switch (direction) {
    case 'left':
      return orientation.moveLeft();
    case 'right':
      return orientation.moveRight();
    case 'up':
      return orientation.moveUp();
    case 'down':
      return orientation.moveDown();
  }
};

describe('Cube 2D navigation and view state', () => {
  it('starts with only the canonical orientation as presentation state', () => {
    const state = createCube2DViewState();

    expect(state.orientation.toState()).toEqual({ centerFace: 'front', upFace: 'top' });
    expect(Object.keys(state)).toEqual(['orientation']);
    expect('verticalAnchorColumn' in state).toBe(false);
  });

  it('routes left/right/up/down through CubeOrientation for all 24 orientations', () => {
    const orientations = allOrientations();
    expect(orientations).toHaveLength(24);

    for (const orientation of orientations) {
      for (const direction of ['left', 'right', 'up', 'down'] as const) {
        const state = createCube2DViewState(orientation);
        const moved = navigateCube2DViewState(state, direction);
        const expected = moveOrientation(orientation, direction);

        expect(moved.orientation.equals(expected)).toBe(true);
        expect(moved.orientation.centerFace).toBe(expected.centerFace);
        expect(Object.keys(moved)).toEqual(['orientation']);
      }
    }
  });

  it('returns to the exact initial orientation after four horizontal moves', () => {
    for (const orientation of allOrientations()) {
      for (const direction of ['left', 'right'] as const) {
        let state = createCube2DViewState(orientation);
        for (let step = 0; step < 4; step += 1) {
          state = navigateCube2DViewState(state, direction);
        }

        expect(state.orientation.equals(orientation)).toBe(true);
      }
    }
  });

  it('keeps vertical navigation reversible and four-step cyclic from every orientation', () => {
    for (const orientation of allOrientations()) {
      const initial = createCube2DViewState(orientation);
      const upThenDown = navigateCube2DViewState(
        navigateCube2DViewState(initial, 'up'),
        'down',
      );
      const downThenUp = navigateCube2DViewState(
        navigateCube2DViewState(initial, 'down'),
        'up',
      );

      expect(upThenDown.orientation.equals(orientation)).toBe(true);
      expect(downThenUp.orientation.equals(orientation)).toBe(true);

      for (const direction of ['up', 'down'] as const) {
        let state = initial;
        for (let step = 0; step < 4; step += 1) {
          state = navigateCube2DViewState(state, direction);
        }
        expect(state.orientation.equals(orientation)).toBe(true);
      }
    }
  });

  it('keeps exactly six unique faces and logical points after every navigation transition', () => {
    const orientations = allOrientations();

    for (const size of CUBE_VIEW_CONTRACT_SIZES) {
      const topology = new CubeTopology(size);

      for (const orientation of orientations) {
        const initial = createCube2DViewState(orientation);
        const states = [
          initial,
          ...(['left', 'right', 'up', 'down'] as const).map((direction) =>
            navigateCube2DViewState(initial, direction),
          ),
        ];

        for (const state of states) {
          const layout = createCube2DLayout(state.orientation, size);
          const pointIds = layout.cells.flatMap((cell) => cell.pointIds.flat());
          const central = layout.rows[CUBE_2D_CENTER.row][CUBE_2D_CENTER.column];

          expect(layout.cells).toHaveLength(CUBE_FACES.length);
          expect(new Set(layout.cells.map((cell) => cell.face))).toEqual(new Set(CUBE_FACES));
          expect(pointIds).toHaveLength(6 * size * size);
          expect(new Set(pointIds).size).toBe(6 * size * size);
          expect(new Set(pointIds)).toEqual(new Set(topology.points()));
          expect(central?.isCentral).toBe(true);
          expect(central?.face).toBe(state.orientation.centerFace);
          expect(layout.rows[0][1]?.face).toBe(state.orientation.neighbors.top);
          expect(layout.rows[2][1]?.face).toBe(state.orientation.neighbors.bottom);
          expect(layout.rows[0].filter(Boolean)).toHaveLength(1);
          expect(layout.rows[2].filter(Boolean)).toHaveLength(1);
        }
      }
    }
  });
});
