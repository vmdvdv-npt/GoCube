import { describe, expect, it } from 'vitest';
import {
  CUBE_FACES,
  CubeTopology,
  cubePointId,
  type CubeFace,
} from '../../core/topology/CubeTopology';
import type { PointId } from '../../core/topology/Topology';
import { CubeOrientation, type CubeRotation } from './CubeOrientation';

type MoveMethod = 'moveLeft' | 'moveRight' | 'moveUp' | 'moveDown';
type CubeEdge = 'top' | 'right' | 'bottom' | 'left';

const MOVES: readonly MoveMethod[] = ['moveLeft', 'moveRight', 'moveUp', 'moveDown'];

const SCREEN_EDGE_BY_ROTATION: Readonly<
  Record<CubeRotation, Readonly<Record<MoveMethod, CubeEdge>>>
> = Object.freeze({
  0: Object.freeze({
    moveUp: 'top',
    moveRight: 'right',
    moveDown: 'bottom',
    moveLeft: 'left',
  }),
  90: Object.freeze({
    moveUp: 'left',
    moveRight: 'top',
    moveDown: 'right',
    moveLeft: 'bottom',
  }),
  180: Object.freeze({
    moveUp: 'bottom',
    moveRight: 'left',
    moveDown: 'top',
    moveLeft: 'right',
  }),
  270: Object.freeze({
    moveUp: 'right',
    moveRight: 'bottom',
    moveDown: 'left',
    moveLeft: 'top',
  }),
});

const pointOnEdge = (
  face: CubeFace,
  edge: CubeEdge,
  index: number,
  last: number,
): PointId => {
  switch (edge) {
    case 'top':
      return cubePointId(face, 0, index);
    case 'right':
      return cubePointId(face, index, last);
    case 'bottom':
      return cubePointId(face, last, index);
    case 'left':
      return cubePointId(face, index, 0);
  }
};

const allOrientations = (): readonly CubeOrientation[] => {
  const orientations: CubeOrientation[] = [];

  for (const centerFace of CUBE_FACES) {
    for (const upFace of CUBE_FACES) {
      try {
        orientations.push(new CubeOrientation({ centerFace, upFace }));
      } catch {
        // A face cannot point toward itself or its opposite face.
      }
    }
  }

  return orientations;
};

const expectSameOrientation = (actual: CubeOrientation, expected: CubeOrientation) => {
  expect(actual.toState()).toEqual(expected.toState());
  expect(actual.rotation).toBe(expected.rotation);
};

describe('CubeOrientation', () => {
  it('has exactly 24 valid oriented-face states', () => {
    const orientations = allOrientations();

    expect(orientations).toHaveLength(24);
    expect(new Set(orientations.map((entry) => JSON.stringify(entry.toState()))).size).toBe(24);
  });

  it.each(MOVES)('returns to exactly the same orientation after four %s operations', (move: MoveMethod) => {
    for (const start of allOrientations()) {
      let current = start;
      for (let step = 0; step < 4; step += 1) current = current[move]();
      expectSameOrientation(current, start);
    }
  });

  it('right then left and up then down restore face and rotation exactly', () => {
    for (const start of allOrientations()) {
      expectSameOrientation(start.moveRight().moveLeft(), start);
      expectSameOrientation(start.moveLeft().moveRight(), start);
      expectSameOrientation(start.moveUp().moveDown(), start);
      expectSameOrientation(start.moveDown().moveUp(), start);
    }
  });

  it('keeps directional neighbors consistent with CubeTopology on every oriented face', () => {
    const topology = new CubeTopology(3);
    const last = topology.size - 1;

    for (const orientation of allOrientations()) {
      for (const move of MOVES) {
        const edge = SCREEN_EDGE_BY_ROTATION[orientation.rotation][move];
        const source = pointOnEdge(orientation.centerFace, edge, 1, last);
        const crossingNeighbor = topology
          .neighbors(source)
          .find((point) => !point.startsWith(`${orientation.centerFace}:`));

        expect(crossingNeighbor).toBeDefined();
        const targetFace = crossingNeighbor?.split(':')[0] as CubeFace;
        expect(orientation[move]().centerFace).toBe(targetFace);
      }
    }
  });

  it('rejects an up face that is central or opposite to the central face', () => {
    expect(() => new CubeOrientation({ centerFace: 'front', upFace: 'front' })).toThrow(
      /Invalid cube orientation/,
    );
    expect(() => new CubeOrientation({ centerFace: 'front', upFace: 'back' })).toThrow(
      /Invalid cube orientation/,
    );
  });
});
