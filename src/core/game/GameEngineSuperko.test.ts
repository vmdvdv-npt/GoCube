import { describe, expect, it } from 'vitest';
import { SimpleKoPolicy, SuperkoPolicy } from '../rules/RepetitionPolicy';
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

const withInterveningStone = (state: GameState): GameState => ({
  ...state,
  board: { ...state.board, '2,2': 'black' },
});

describe.each(TORUS_SIZES)('Superko across torus seams %dx%d', (size: TorusSize) => {
  const superko = new SuperkoPolicy();
  const simpleKo = new SimpleKoPolicy();

  it('rejects an older repetition across the left/right seam without changing simple ko', () => {
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
    const history = {
      states: [beforeCapture, withInterveningStone(blackCapture.state), blackCapture.state],
    };

    expectAccepted(
      engine.placeStone(blackCapture.state, capturedPoint, 'white', simpleKo, history),
    );

    const recapture = expectRejected(
      engine.placeStone(blackCapture.state, capturedPoint, 'white', superko, history),
      'repetition',
    );

    expect(recapture.state).toBe(blackCapture.state);
  });

  it('rejects an older repetition across the top/bottom seam without changing simple ko', () => {
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
    const history = {
      states: [beforeCapture, withInterveningStone(blackCapture.state), blackCapture.state],
    };

    expectAccepted(
      engine.placeStone(blackCapture.state, capturedPoint, 'white', simpleKo, history),
    );

    const recapture = expectRejected(
      engine.placeStone(blackCapture.state, capturedPoint, 'white', superko, history),
      'repetition',
    );

    expect(recapture.state).toBe(blackCapture.state);
  });
});
