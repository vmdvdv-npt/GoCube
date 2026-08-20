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
import type { RepetitionContext, RepetitionPolicy } from '../rules/RepetitionPolicy';
import { SimpleKoPolicy } from '../rules/RepetitionPolicy';

const stateWith = (
  engine: GameEngine,
  stones: Record<PointId, StoneColor>,
): GameState => ({
  board: { ...engine.createInitialState().board, ...stones },
});

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

class RecordingPolicy implements RepetitionPolicy {
  calls = 0;
  lastCandidate: GameState | null = null;

  constructor(private readonly allowed: boolean) {}

  isAllowed(_context: RepetitionContext, candidateState: GameState): boolean {
    this.calls += 1;
    this.lastCandidate = candidateState;
    return this.allowed;
  }
}

describe('GameEngine repetition integration', () => {
  it('rejects a classic immediate ko recapture and preserves the current state', () => {
    const engine = new GameEngine(new TorusTopology(9));
    const policy = new SimpleKoPolicy();
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
      engine.placeStone(
        blackCapture.state,
        '4,4',
        'white',
        policy,
        { states: [beforeCapture, blackCapture.state] },
      ),
      'repetition',
    );

    expect(recapture.state).toBe(blackCapture.state);
    expect(recapture.state.board['4,4']).toBe('empty');
    expect(recapture.state.board['4,5']).toBe('black');
  });

  it('calls repetition policy only after captures and passes the post-capture candidate state', () => {
    const engine = new GameEngine(new TorusTopology(9));
    const policy = new RecordingPolicy(false);
    const state = stateWith(engine, {
      '4,4': 'white',
      '3,4': 'black',
      '5,4': 'black',
      '4,3': 'black',
    });

    const result = expectRejected(
      engine.placeStone(state, '4,5', 'black', policy, { states: [state] }),
      'repetition',
    );

    expect(policy.calls).toBe(1);
    expect(policy.lastCandidate?.board['4,4']).toBe('empty');
    expect(policy.lastCandidate?.board['4,5']).toBe('black');
    expect(result.state).toBe(state);
    expect(state.board['4,4']).toBe('white');
    expect(state.board['4,5']).toBe('empty');
  });

  it('does not call repetition policy when the move already fails suicide validation', () => {
    const engine = new GameEngine(new TorusTopology(9));
    const policy = new RecordingPolicy(false);
    const state = stateWith(engine, {
      '3,4': 'white',
      '5,4': 'white',
      '4,3': 'white',
      '4,5': 'white',
    });

    expectRejected(
      engine.placeStone(state, '4,4', 'black', policy, { states: [state] }),
      'suicide',
    );
    expect(policy.calls).toBe(0);
  });
});

describe.each(TORUS_SIZES)('Simple ko across torus seams %dx%d', (size: TorusSize) => {
  const policy = new SimpleKoPolicy();

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
      engine.placeStone(
        blackCapture.state,
        capturedPoint,
        'white',
        policy,
        { states: [beforeCapture, blackCapture.state] },
      ),
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
      engine.placeStone(
        blackCapture.state,
        capturedPoint,
        'white',
        policy,
        { states: [beforeCapture, blackCapture.state] },
      ),
      'repetition',
    );

    expect(recapture.state).toBe(blackCapture.state);
  });
});
