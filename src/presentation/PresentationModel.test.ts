import presentationSource from './PresentationModel.ts?raw';
import { describe, expect, it } from 'vitest';
import type { GameState, RuleSet } from '../core/game/types';
import type { GameSessionSnapshot } from '../core/persistence/GameSessionSnapshot';
import type { FinalScore } from '../core/scoring/Scoring';
import {
  PresentationModel,
  type PresentationContext,
  type PresentationSessionSource,
} from './PresentationModel';

const state = (
  board: GameState['board'],
  overrides: Partial<Omit<GameState, 'board'>> = {},
): GameState => ({
  board,
  currentPlayer: 'black',
  moveNumber: 0,
  consecutivePasses: 0,
  phase: 'playing',
  captures: { black: 0, white: 0 },
  ...overrides,
});

const context = (
  ruleSet: RuleSet = 'chinese',
  komi = 7.5,
  finalScore: FinalScore | null = null,
): PresentationContext => ({ ruleSet, komi, finalScore });

const finalScore = (ruleSet: RuleSet = 'chinese', komi = 7.5): FinalScore => ({
  ruleSet,
  black: 4,
  white: 5.5,
  komi,
  territory: { black: 2, white: 1, neutral: 1, seki: 0 },
  territoryPoints: {
    black: ['2,0', '0,0'],
    white: ['1,0'],
    neutral: ['3,0'],
    seki: [],
  },
  stonesOnBoard: { black: 2, white: 1 },
  captures: { black: 1, white: 2 },
  prisoners: ruleSet === 'japanese' ? { black: 1, white: 2 } : null,
  deadStones: { black: 0, white: 1 },
  winner: 'white',
  margin: 1.5,
});

const snapshot = (
  gameState: GameState,
  ruleSet: RuleSet,
  komi: number,
  score: FinalScore | null,
): GameSessionSnapshot => ({
  version: 1,
  ruleSet,
  komi,
  history: [gameState],
  finalScore: score,
});

describe('PresentationModel', () => {
  it('builds an empty position with deterministic logical-point order', () => {
    const model = new PresentationModel();
    const gameState = state(
      { '2,0': 'empty', '0,0': 'empty', '1,0': 'empty' },
      {
        currentPlayer: 'white',
        moveNumber: 8,
        consecutivePasses: 1,
        captures: { black: 3, white: 2 },
      },
    );

    expect(model.create(gameState, context())).toEqual({
      points: [
        { logicalPointId: '0,0', occupancy: 'empty' },
        { logicalPointId: '1,0', occupancy: 'empty' },
        { logicalPointId: '2,0', occupancy: 'empty' },
      ],
      currentPlayer: 'white',
      moveNumber: 8,
      consecutivePasses: 1,
      phase: 'playing',
      captures: { black: 3, white: 2 },
      ruleSet: 'chinese',
      komi: 7.5,
      finalScore: null,
    });
  });

  it('preserves black, white and empty occupancy without renderer-specific data', () => {
    const view = new PresentationModel().create(
      state({ '1,0': 'white', '0,0': 'black', '2,0': 'empty' }),
      context('japanese', 6.5),
    );

    expect(view.points).toEqual([
      { logicalPointId: '0,0', occupancy: 'black' },
      { logicalPointId: '1,0', occupancy: 'white' },
      { logicalPointId: '2,0', occupancy: 'empty' },
    ]);
    expect(view.ruleSet).toBe('japanese');
    expect(view.komi).toBe(6.5);
  });

  it('reads configuration and FinalScore from session data for a finished game', () => {
    const model = new PresentationModel();
    const score = finalScore('japanese', 6.5);
    const gameState = state(
      { '0,0': 'black', '1,0': 'white' },
      { phase: 'finished', moveNumber: 12, consecutivePasses: 2 },
    );
    const session: PresentationSessionSource = {
      state: () => gameState,
      snapshot: () => snapshot(gameState, 'japanese', 6.5, score),
    };

    const view = model.fromSession(session);

    expect(view.phase).toBe('finished');
    expect(view.ruleSet).toBe('japanese');
    expect(view.komi).toBe(6.5);
    expect(view.finalScore).toEqual({
      ...score,
      territoryPoints: {
        ...score.territoryPoints,
        black: ['0,0', '2,0'],
      },
    });
    expect(view.finalScore).not.toBe(score);
    expect(view.finalScore?.territoryPoints.black).not.toBe(score.territoryPoints.black);
  });

  it('exposes no FinalScore until the state is finished', () => {
    const score = finalScore();
    const view = new PresentationModel().create(
      state({ '0,0': 'black' }, { phase: 'playing' }),
      context('chinese', 7.5, score),
    );

    expect(view.finalScore).toBeNull();
  });

  it('produces the same ViewModel for equivalent domain states regardless of board insertion order', () => {
    const model = new PresentationModel();
    const first = state({ '2,0': 'empty', '0,0': 'black', '1,0': 'white' });
    const second = state({ '1,0': 'white', '2,0': 'empty', '0,0': 'black' });

    expect(JSON.stringify(model.create(first, context()))).toBe(
      JSON.stringify(model.create(second, context())),
    );
  });

  it('returns a JSON-serializable, deeply read-only ViewModel', () => {
    const score = finalScore('japanese', 6.5);
    const gameState = state(
      { '0,0': 'black', '1,0': 'white' },
      { phase: 'finished', captures: { black: 2, white: 1 } },
    );
    const view = new PresentationModel().create(
      gameState,
      context('japanese', 6.5, score),
    );

    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.points)).toBe(true);
    expect(view.points.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(view.captures)).toBe(true);
    expect(Object.isFrozen(view.finalScore)).toBe(true);
    expect(Object.isFrozen(view.finalScore?.territoryPoints.black)).toBe(true);
  });

  it('does not mutate or alias GameState, captures or FinalScore inputs', () => {
    const board = { '0,0': 'black', '1,0': 'white' } as const;
    const captures = { black: 2, white: 1 };
    const score = finalScore();
    const gameState = state(board, { phase: 'finished', captures });
    const beforeState = JSON.stringify(gameState);
    const beforeScore = JSON.stringify(score);

    const view = new PresentationModel().create(gameState, context('chinese', 7.5, score));

    expect(JSON.stringify(gameState)).toBe(beforeState);
    expect(JSON.stringify(score)).toBe(beforeScore);
    expect(view.points).not.toBe(board);
    expect(view.captures).not.toBe(captures);
    expect(view.finalScore).not.toBe(score);
    expect(score.territoryPoints.black).toEqual(['2,0', '0,0']);
  });

  it('has no dependency on engine, topology implementations, UI, storage or renderers', () => {
    expect(presentationSource).not.toMatch(
      /GameEngine|TorusTopology|localStorage|React|react-dom|SVG|\bDOM\b/,
    );
    expect(presentationSource).not.toMatch(/renderer2d|renderer3d|Renderer/i);
  });
});
