import { describe, expect, it } from 'vitest';
import { CubeTopology, cubePointId } from '../topology/CubeTopology';
import type { PointId } from '../topology/Topology';
import {
  GameEngine,
  type AcceptedPlaceStoneResult,
  type PlaceStoneResult,
  type RejectedPlaceStoneResult,
} from './GameEngine';
import type { GameState, StoneColor } from './types';

const stateWith = (
  engine: GameEngine,
  stones: Record<PointId, StoneColor>,
  currentPlayer: StoneColor = 'black',
): GameState => {
  const initial = engine.createInitialState();
  return {
    ...initial,
    currentPlayer,
    board: { ...initial.board, ...stones },
  };
};

const expectAccepted = (result: PlaceStoneResult): AcceptedPlaceStoneResult => {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`Expected accepted move, got ${result.reason}`);
  return result;
};

const expectRejected = (
  result: PlaceStoneResult,
  reason: RejectedPlaceStoneResult['reason'],
): RejectedPlaceStoneResult => {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('Expected rejected move');
  expect(result.reason).toBe(reason);
  return result;
};

describe('GameEngine with CubeTopology', () => {
  const topology = new CubeTopology(3);
  const engine = new GameEngine(topology);
  const frontEdge = cubePointId('front', 1, 2);
  const rightEdge = cubePointId('right', 1, 0);

  it('treats same-color stones across an edge as one group', () => {
    const state = stateWith(engine, {
      [frontEdge]: 'black',
      [rightEdge]: 'black',
    });

    const group = engine.groupAt(state, frontEdge);

    expect(new Set(group?.points ?? [])).toEqual(new Set([frontEdge, rightEdge]));
  });

  it('counts a free point on the neighboring face as a liberty', () => {
    const state = stateWith(engine, { [frontEdge]: 'black' });
    const group = engine.groupAt(state, frontEdge);

    expect(group?.liberties).toContain(rightEdge);
  });

  it('captures a group that crosses a cube edge', () => {
    const state = stateWith(engine, {
      [frontEdge]: 'white',
      [rightEdge]: 'white',
      [cubePointId('front', 1, 1)]: 'black',
      [cubePointId('front', 0, 2)]: 'black',
      [cubePointId('front', 2, 2)]: 'black',
      [cubePointId('right', 0, 0)]: 'black',
      [cubePointId('right', 2, 0)]: 'black',
    });

    const result = expectAccepted(
      engine.placeStone(state, cubePointId('right', 1, 1), 'black'),
    );

    expect(new Set(result.captured)).toEqual(new Set([frontEdge, rightEdge]));
    expect(result.state.board[frontEdge]).toBe('empty');
    expect(result.state.board[rightEdge]).toBe('empty');
  });

  it('rejects suicide when the fourth blocking neighbor is on another face', () => {
    const state = stateWith(engine, {
      [cubePointId('front', 1, 1)]: 'white',
      [cubePointId('front', 0, 2)]: 'white',
      [cubePointId('front', 2, 2)]: 'white',
      [rightEdge]: 'white',
    });

    const result = expectRejected(engine.placeStone(state, frontEdge, 'black'), 'suicide');

    expect(result.state).toBe(state);
    expect(result.state.board[frontEdge]).toBe('empty');
  });

  it('applies simple ko to an immediate recapture across an edge', () => {
    const beforeCapture = stateWith(engine, {
      [rightEdge]: 'white',
      [cubePointId('front', 1, 1)]: 'white',
      [cubePointId('front', 0, 2)]: 'white',
      [cubePointId('front', 2, 2)]: 'white',
      [cubePointId('right', 1, 1)]: 'black',
      [cubePointId('right', 0, 0)]: 'black',
      [cubePointId('right', 2, 0)]: 'black',
    });

    const capture = expectAccepted(engine.placeStone(beforeCapture, frontEdge, 'black'));
    expect(capture.captured).toEqual([rightEdge]);

    const recapture = expectRejected(
      engine.placeStone(capture.state, rightEdge, 'white', {
        previousBoard: beforeCapture.board,
      }),
      'repetition',
    );

    expect(recapture.state).toBe(capture.state);
  });
});
