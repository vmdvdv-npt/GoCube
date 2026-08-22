import { describe, expect, it } from 'vitest';
import type { EndgameClassifier } from '../endgame/EndgameClassifier';
import { ManualEndgameClassifier } from '../endgame/ManualEndgameClassifier';
import { ChineseScoring } from '../scoring/ChineseScoring';
import { TorusTopology } from '../topology/TorusTopology';
import { GameEngine } from './GameEngine';
import { GameSession } from './GameSession';

const emptyClassifier: EndgameClassifier = Object.freeze({
  analyze: async () => Object.freeze([]),
});

const createSession = (): GameSession => {
  const topology = new TorusTopology(9);
  return new GameSession(new GameEngine(topology), {
    endgameClassifier: emptyClassifier,
    scoringStrategy: new ChineseScoring(topology),
    komi: 0,
  });
};

describe('GameSession redo', () => {
  it('redo restores the exact rule-relevant state after undo', async () => {
    const session = createSession();
    await session.execute({ type: 'place-stone', point: '0,0' });
    await session.execute({ type: 'pass' });

    const beforeUndo = session.state();
    expect(beforeUndo).toMatchObject({
      currentPlayer: 'black',
      moveNumber: 2,
      consecutivePasses: 1,
      phase: 'playing',
    });

    expect((await session.executeSessionCommand({ type: 'undo' })).ok).toBe(true);
    expect(session.canRedo()).toBe(true);

    const redo = await session.executeSessionCommand({ type: 'redo' });
    expect(redo.ok).toBe(true);
    expect(session.state()).toEqual(beforeUndo);
    expect(session.canRedo()).toBe(false);
  });

  it('undo of the second Pass removes review and redo restores that exact review without reanalysis', async () => {
    const topology = new TorusTopology(9);
    const engine = new GameEngine(topology);
    const initial = engine.createInitialState();
    const session = new GameSession(
      engine,
      {
        endgameClassifier: new ManualEndgameClassifier(),
        scoringStrategy: new ChineseScoring(topology),
        komi: 0,
      },
      Object.freeze({
        ...initial,
        board: Object.freeze({ ...initial.board, '0,0': 'black' as const }),
      }),
    );

    await session.execute({ type: 'pass' });
    await session.execute({ type: 'pass' });
    await session.setEndgameReviewDecision(['0,0'], 'dead');
    const reviewBeforeUndo = session.endgameReview();

    expect(session.state().phase).toBe('endgame');
    expect(reviewBeforeUndo?.groups[0]?.userDecision).toBe('dead');

    await session.executeSessionCommand({ type: 'undo' });
    expect(session.state()).toMatchObject({ phase: 'playing', consecutivePasses: 1 });
    expect(session.endgameReview()).toBeNull();

    await session.executeSessionCommand({ type: 'redo' });
    expect(session.state()).toMatchObject({ phase: 'endgame', consecutivePasses: 2 });
    expect(session.endgameReview()).toEqual(reviewBeforeUndo);
  });

  it('redo restores a finished position and its final result', async () => {
    const session = createSession();
    await session.execute({ type: 'pass' });
    await session.execute({ type: 'pass' });
    await session.finishEndgameReview();

    expect(session.state().phase).toBe('finished');
    const finalScore = session.finalScore();
    expect(finalScore).not.toBeNull();

    expect((await session.executeSessionCommand({ type: 'undo' })).ok).toBe(true);
    expect(session.state()).toMatchObject({ phase: 'playing', consecutivePasses: 1 });
    expect(session.finalScore()).toBeNull();

    expect((await session.executeSessionCommand({ type: 'redo' })).ok).toBe(true);
    expect(session.state()).toMatchObject({ phase: 'finished', consecutivePasses: 2 });
    expect(session.finalScore()).toEqual(finalScore);
  });

  it('a new action after undo removes the redo future', async () => {
    const session = createSession();
    await session.execute({ type: 'place-stone', point: '0,0' });
    await session.execute({ type: 'place-stone', point: '1,0' });
    await session.executeSessionCommand({ type: 'undo' });

    expect(session.canRedo()).toBe(true);
    expect((await session.execute({ type: 'place-stone', point: '2,0' })).ok).toBe(true);
    expect(session.canRedo()).toBe(false);
    expect(await session.executeSessionCommand({ type: 'redo' })).toMatchObject({
      ok: false,
      reason: 'nothing-to-redo',
    });
  });
});
