import { describe, expect, it } from 'vitest';
import type { PointId } from '../topology/Topology';
import { TORUS_SIZES, TorusTopology, type TorusSize } from '../topology/TorusTopology';
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
): GameState => {
  const initial = engine.createInitialState();
  return {
    ...initial,
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

describe('GameEngine Simple Ko integration', () => {
  it('rejects a classic immediate ko recapture and preserves the current state', () => {
    const engine = new GameEngine(new TorusTopology(9));
    const beforeCapture = stateWith(engine, {
      '4,4': 'white',
      '3,4': 'black',
      '5,4': 'black',
      '4,3': 'black',
      '3,5': 'white',
      '5,5': 'white',
      '4,6': 'white',
    });

    const blackCapture = expectAccepted(engine.placeStone(beforeCapture, '4,5', 'black'));
    expect(blackCapture.captured).toEqual(['4,4']);

    const recapture = expectRejected(
      engine.placeStone(blackCapture.state, '4,4', 'white', {
        previousBoard: beforeCapture.board,
      }),
      'repetition',
    );

    expect(recapture.state).toBe(blackCapture.state);
    expect(recapture.state.board['4,4']).toBe('empty');
    expect(recapture.state.board['4,5']).toBe('black');
  });

  it('compares Simple Ko against the post-capture candidate board', () => {
    const engine = new GameEngine(new TorusTopology(9));
    const state = stateWith(engine, {
      '4,4': 'white',
      '3,4': 'black',
      '5,4': 'black',
      '4,3': 'black',
    });

    const candidate = expectAccepted(engine.placeStone(state, '4,5', 'black'));
    expect(candidate.captured).toEqual(['4,4']);

    const repeatedCandidate = expectRejected(
      engine.placeStone(state, '4,5', 'black', {
        previousBoard: candidate.state.board,
      }),
      'repetition',
    );

    expect(repeatedCandidate.state).toBe(state);
  });

  it('does not implement superko when only an older board would match', () => {
    const engine = new GameEngine(new TorusTopology(9));
    const state = stateWith(engine, {
      '4,4': 'white',
      '3,4': 'black',
      '5,4': 'black',
      '4,3': 'black',
    });
    const candidate = expectAccepted(engine.placeStone(state, '4,5', 'black'));
    const unrelatedImmediateBoard = {
      ...candidate.state.board,
      '0,0': candidate.state.board['0,0'] === 'black' ? 'empty' : 'black',
    } as const;

    expectAccepted(
      engine.placeStone(state, '4,5', 'black', {
        previousBoard: unrelatedImmediateBoard,
      }),
    );
  });
});

describe.each(TORUS_SIZES)('Simple ko across torus seams %dx%d', (size: TorusSize) => {
  it('rejects immediate ko recapture across the left/right seam', () => {
    const engine = new GameEngine(new TorusTopology(size));
    const last = size - 1;
    const mid = Math.floor(size / 2);
    const capturedPoint = `0,${mid}`;
    const capturePoint = `${last},${mid}`;
    const beforeCapture = stateWith(engine, {
      [capturedPoint]: 'white',
      [`1,${mid}`]: 'black',
      [`0,${mid - 1}`]: 'black',
      [`0,${mid + 1}`]: 'black',
      [`${last - 1},${mid}`]: 'white',
      [`${last},${mid - 1}`]: 'white',
      [`${last},${mid + 1}`]: 'white',
    });

    const blackCapture = expectAccepted(
      engine.placeStone(beforeCapture, capturePoint, 'black'),
    );
    expect(blackCapture.captured).toEqual([capturedPoint]);

    const recapture = expectRejected(
      engine.placeStone(blackCapture.state, capturedPoint, 'white', {
        previousBoard: beforeCapture.board,
      }),
      'repetition',
    );

    expect(recapture.state).toBe(blackCapture.state);
  });

  it('rejects immediate ko recapture across the top/bottom seam', () => {
    const engine = new GameEngine(new TorusTopology(size));
    const last = size - 1;
    const mid = Math.floor(size / 2);
    const capturedPoint = `${mid},0`;
    const capturePoint = `${mid},${last}`;
    const beforeCapture = stateWith(engine, {
      [capturedPoint]: 'white',
      [`${mid - 1},0`]: 'black',
      [`${mid + 1},0`]: 'black',
      [`${mid},1`]: 'black',
      [`${mid - 1},${last}`]: 'white',
      [`${mid + 1},${last}`]: 'white',
      [`${mid},${last - 1}`]: 'white',
    });

    const blackCapture = expectAccepted(
      engine.placeStone(beforeCapture, capturePoint, 'black'),
    );
    expect(blackCapture.captured).toEqual([capturedPoint]);

    const recapture = expectRejected(
      engine.placeStone(blackCapture.state, capturedPoint, 'white', {
        previousBoard: beforeCapture.board,
      }),
      'repetition',
    );

    expect(recapture.state).toBe(blackCapture.state);
  });
});
