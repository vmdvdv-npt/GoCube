import { describe, expect, it } from 'vitest';
import { CUBE_FACES, CUBE_SIZES, CubeTopology } from '../../core/topology/CubeTopology';
import { CUBE_2D_CENTER, createCube2DLayout } from './Cube2DLayout';
import {
  createCube2DViewState,
  navigateCube2DViewState,
  setCube2DVerticalAnchorColumn,
  type Cube2DNavigationDirection,
} from './Cube2DNavigation';
import { CubeOrientation } from './CubeOrientation';

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
  it('starts with the canonical orientation and vertical anchor column 1', () => {
    const state = createCube2DViewState();

    expect(state.orientation.toState()).toEqual({ centerFace: 'front', upFace: 'top' });
    expect(state.verticalAnchorColumn).toBe(1);
  });

  it('routes left/right/up/down through CubeOrientation for all 24 orientations', () => {
    const orientations = allOrientations();
    expect(orientations).toHaveLength(24);

    for (const orientation of orientations) {
      for (const direction of ['left', 'right', 'up', 'down'] as const) {
        const state = createCube2DViewState(orientation, 3);
        const moved = navigateCube2DViewState(state, direction);
        const expected = moveOrientation(orientation, direction);

        expect(moved.orientation.equals(expected)).toBe(true);
        expect(moved.orientation.centerFace).toBe(expected.centerFace);
        expect(moved.verticalAnchorColumn).toBe(3);
      }
    }
  });

  it('returns to the exact initial orientation after four horizontal moves', () => {
    for (const orientation of allOrientations()) {
      for (const direction of ['left', 'right'] as const) {
        let state = createCube2DViewState(orientation, 2);
        for (let step = 0; step < 4; step += 1) {
          state = navigateCube2DViewState(state, direction);
        }

        expect(state.orientation.equals(orientation)).toBe(true);
        expect(state.verticalAnchorColumn).toBe(2);
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

  it('accepts only vertical anchor columns 0, 1, 2 and 3 without changing orientation', () => {
    const orientation = new CubeOrientation().moveRight().moveUp();
    const initial = createCube2DViewState(orientation);

    for (const column of [0, 1, 2, 3] as const) {
      const moved = setCube2DVerticalAnchorColumn(initial, column);
      expect(moved.verticalAnchorColumn).toBe(column);
      expect(moved.orientation).toBe(orientation);
    }

    expect(() => setCube2DVerticalAnchorColumn(initial, -1)).toThrow();
    expect(() => setCube2DVerticalAnchorColumn(initial, 4)).toThrow();
  });

  it('keeps exactly six unique faces and logical points after every transition', () => {
    const orientations = allOrientations();

    for (const size of CUBE_SIZES) {
      const topology = new CubeTopology(size);

      for (const orientation of orientations) {
        for (const anchor of [0, 1, 2, 3] as const) {
          const initial = createCube2DViewState(orientation, anchor);
          const states = [
            initial,
            ...(['left', 'right', 'up', 'down'] as const).map((direction) =>
              navigateCube2DViewState(initial, direction),
            ),
          ];

          for (const state of states) {
            const layout = createCube2DLayout(
              state.orientation,
              size,
              state.verticalAnchorColumn,
            );
            const pointIds = layout.cells.flatMap((cell) => cell.pointIds.flat());
            const central = layout.rows[CUBE_2D_CENTER.row][CUBE_2D_CENTER.column];

            expect(layout.cells).toHaveLength(CUBE_FACES.length);
            expect(new Set(layout.cells.map((cell) => cell.face))).toEqual(new Set(CUBE_FACES));
            expect(pointIds).toHaveLength(6 * size * size);
            expect(new Set(pointIds).size).toBe(6 * size * size);
            expect(new Set(pointIds)).toEqual(new Set(topology.points()));
            expect(central?.isCentral).toBe(true);
            expect(central?.face).toBe(state.orientation.centerFace);
          }
        }
      }
    }
  });

  it('moves TOP and BOTTOM together to the selected column while preserving their faces', () => {
    const orientation = new CubeOrientation();
    const initial = createCube2DViewState(orientation);
    const topFace = orientation.neighbors.top;
    const bottomFace = orientation.neighbors.bottom;

    for (const anchor of [0, 1, 2, 3] as const) {
      const state = setCube2DVerticalAnchorColumn(initial, anchor);
      const layout = createCube2DLayout(state.orientation, 4, state.verticalAnchorColumn);
      const top = layout.rows[0][anchor];
      const bottom = layout.rows[2][anchor];

      expect(top?.face).toBe(topFace);
      expect(bottom?.face).toBe(bottomFace);
      expect(top?.column).toBe(anchor);
      expect(bottom?.column).toBe(anchor);
      expect(layout.rows[0].filter(Boolean)).toHaveLength(1);
      expect(layout.rows[2].filter(Boolean)).toHaveLength(1);
    }
  });
});
