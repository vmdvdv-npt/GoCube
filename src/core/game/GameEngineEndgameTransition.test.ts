import { describe, expect, it, vi } from 'vitest';
import type { EndgameClassifier } from '../endgame/EndgameClassifier';
import { ChineseScoring } from '../scoring/ChineseScoring';
import { TorusTopology } from '../topology/TorusTopology';
import { GameEngine } from './GameEngine';
import { GameSession } from './GameSession';

describe('GameEngine endgame transition ownership', () => {
  it('owns the endgame -> finished GameState transition', () => {
    const engine = new GameEngine(new TorusTopology(9));
    const initial = engine.createInitialState();

    const rejectedPlaying = engine.completeEndgame(initial);
    expect(rejectedPlaying).toEqual({
      ok: false,
      state: initial,
      reason: 'not-endgame',
    });
    expect(rejectedPlaying.state).toBe(initial);

    const firstPass = engine.pass(initial);
    expect(firstPass.ok).toBe(true);
    if (!firstPass.ok) throw new Error('Expected first Pass to be accepted');

    const secondPass = engine.pass(firstPass.state);
    expect(secondPass.ok).toBe(true);
    if (!secondPass.ok) throw new Error('Expected second Pass to be accepted');

    const endgame = secondPass.state;
    expect(endgame.phase).toBe('endgame');

    const completion = engine.completeEndgame(endgame);
    expect(completion.ok).toBe(true);
    if (!completion.ok) throw new Error(`Expected endgame completion, got ${completion.reason}`);

    expect(completion.state).not.toBe(endgame);
    expect(completion.state.phase).toBe('finished');
    expect(completion.state.board).toBe(endgame.board);
    expect(completion.state.currentPlayer).toBe(endgame.currentPlayer);
    expect(completion.state.moveNumber).toBe(endgame.moveNumber);
    expect(completion.state.consecutivePasses).toBe(endgame.consecutivePasses);
    expect(completion.state.captures).toEqual(endgame.captures);
    expect(Object.isFrozen(completion.state)).toBe(true);
    expect(endgame.phase).toBe('endgame');

    const rejectedFinished = engine.completeEndgame(completion.state);
    expect(rejectedFinished.ok).toBe(false);
    if (rejectedFinished.ok) throw new Error('Expected finished state to be rejected');
    expect(rejectedFinished.reason).toBe('not-endgame');
    expect(rejectedFinished.state).toBe(completion.state);
  });

  it('makes GameSession consume the GameEngine-produced finished state', async () => {
    const topology = new TorusTopology(9);
    const engine = new GameEngine(topology);
    const realCompleteEndgame = engine.completeEndgame.bind(engine);
    const sentinelMoveNumber = 9_876;
    const completeEndgame = vi.spyOn(engine, 'completeEndgame').mockImplementation((state) => {
      const completion = realCompleteEndgame(state);
      if (!completion.ok) return completion;

      return Object.freeze({
        ok: true as const,
        state: Object.freeze({
          ...completion.state,
          moveNumber: sentinelMoveNumber,
        }),
      });
    });
    const classifier: EndgameClassifier = {
      classify: async () => Object.freeze([]),
    };
    const session = new GameSession(engine, {
      endgameClassifier: classifier,
      scoringStrategy: new ChineseScoring(topology),
      komi: 7.5,
    });

    await session.execute({ type: 'pass' });
    await session.execute({ type: 'pass' });

    expect(completeEndgame).toHaveBeenCalledTimes(1);
    const endgameInput = completeEndgame.mock.calls[0]?.[0];
    expect(endgameInput?.phase).toBe('endgame');

    const completion = completeEndgame.mock.results[0]?.value;
    expect(completion?.ok).toBe(true);
    if (!completion || !completion.ok) {
      throw new Error('Expected GameEngine.completeEndgame to produce the finished state');
    }

    expect(session.state()).toStrictEqual(completion.state);
    expect(session.state().phase).toBe('finished');
    expect(session.state().moveNumber).toBe(sentinelMoveNumber);
    expect(session.historyLength()).toBe(3);
  });
});
