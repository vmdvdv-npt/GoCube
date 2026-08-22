import { describe, expect, it } from 'vitest';
import { CubeTopology, type CubeSize } from '../core/topology/CubeTopology';
import { createCube2DLayout } from '../presentation/cube/Cube2DLayout';
import { CubeOrientation } from '../presentation/cube/CubeOrientation';
import {
  CUBE_2D_SVG_SIZE,
  createCube2DRenderModel,
  hitTestCube2DPoint,
} from './Cube2DRenderer';

const CUBE_HIT_TEST_CONTRACT_SIZES = [2, 3, 4, 5, 6, 7, 8, 10] as const satisfies readonly CubeSize[];

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

describe('Cube2D hit testing', () => {
  it.each(CUBE_HIT_TEST_CONTRACT_SIZES)(
    'maps the center of every visual hit-area to one unique logical point for Cube size %d',
    (size) => {
      const topology = new CubeTopology(size);

      for (const orientation of allOrientations()) {
        for (const anchor of [0, 1, 2, 3] as const) {
          const model = createCube2DRenderModel(createCube2DLayout(orientation, size, anchor));
          const hitIds: string[] = [];

          for (const board of model.boards) {
            for (const point of board.points) {
              const hit = hitTestCube2DPoint(board, point.x, point.y);
              expect(hit).toBe(point.pointId);
              hitIds.push(hit!);
            }
          }

          expect(hitIds).toHaveLength(6 * size * size);
          expect(new Set(hitIds)).toEqual(new Set(topology.points()));
        }
      }
    },
  );

  it('has no dead margin at board edges and never returns two logical points', () => {
    const size = 4;
    const model = createCube2DRenderModel(createCube2DLayout(new CubeOrientation(), size));
    const central = model.boards.find((board) => board.isCentral)!;
    const epsilon = 0.0001;

    expect(hitTestCube2DPoint(central, epsilon, epsilon)).toBe(central.pointRows[0][0].pointId);
    expect(hitTestCube2DPoint(central, CUBE_2D_SVG_SIZE - epsilon, epsilon)).toBe(
      central.pointRows[0][size - 1].pointId,
    );
    expect(hitTestCube2DPoint(central, epsilon, CUBE_2D_SVG_SIZE - epsilon)).toBe(
      central.pointRows[size - 1][0].pointId,
    );
    expect(
      hitTestCube2DPoint(
        central,
        CUBE_2D_SVG_SIZE - epsilon,
        CUBE_2D_SVG_SIZE - epsilon,
      ),
    ).toBe(central.pointRows[size - 1][size - 1].pointId);

    expect(hitTestCube2DPoint(central, -epsilon, 50)).toBeNull();
    expect(hitTestCube2DPoint(central, CUBE_2D_SVG_SIZE, 50)).toBeNull();
  });

  it('continues returning the resolved logical PointId after navigation and anchor changes', () => {
    const states = [
      { orientation: new CubeOrientation(), anchor: 0 as const },
      { orientation: new CubeOrientation().moveLeft(), anchor: 1 as const },
      { orientation: new CubeOrientation().moveRight(), anchor: 2 as const },
      { orientation: new CubeOrientation().moveUp(), anchor: 3 as const },
      { orientation: new CubeOrientation().moveDown(), anchor: 1 as const },
    ];

    for (const state of states) {
      const model = createCube2DRenderModel(createCube2DLayout(state.orientation, 5, state.anchor));
      for (const board of model.boards) {
        for (const point of board.points) {
          expect(hitTestCube2DPoint(board, point.x, point.y)).toBe(point.pointId);
        }
      }
    }
  });
});
