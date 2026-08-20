import { describe, expect, it } from 'vitest';
import type { RepetitionContext, RepetitionPolicy } from '../rules/RepetitionPolicy';
import { SimpleKoPolicy } from '../rules/RepetitionPolicy';
import { TorusTopology } from '../topology/TorusTopology';
import type { GameState } from './types';
import { GameEngine } from './GameEngine';
import { GameSession } from './GameSession';

class RecordingPolicy implements RepetitionPolicy {
  readonly contexts: RepetitionContext[] = [];

  isAllowed(context: RepetitionContext): boolean {
    this.contexts.push(context);
    return true;
  }
}

describe('GameSession', () => {
  it('is the command entry point and records only successful actions', () => {
    const engine = new GameEngine(new TorusTopology(9));
    const session = new GameSession(engine, new SimpleKoPolicy());

    expect(session.historyLength()).toBe(1);

    const first = session.execute({ type: 'place-stone', point: '0,0' });
    expect(first.ok).toBe(true);
    expect(session.historyLength()).toBe(2);

    const invalid = session.execute({ type: 'place-stone', point: '0,0' });
    expect(invalid).toMatchObject({ ok: false, reason: 'occupied' });
    expect(session.historyLength()).toBe(2);

    const pass = session.execute({ type: 'pass' });
    expect(pass.ok).toBe(true);
    expect(session.historyLength()).toBe(3);
    expect(session.state()).toMatchObject({
      currentPlayer: 'black',
      moveNumber: 2,
      consecutivePasses: 1,
      phase: 'playing',
    });
  });

  it('undo restores board and all current rule-relevant turn state', () => {
    const engine = new GameEngine(new TorusTopology(9));
    const initial = engine.createInitialState();
    const beforeCapture: GameState = {
      ...initial,
      board: {
        ...initial.board,
        '4,4': 'white',
        '3,4': 'black',
        '5,4': 'black',
        '4,3': 'black',
      },
    };
    const session = new GameSession(engine, new SimpleKoPolicy(), beforeCapture);

    const capture = session.execute({ type: 'place-stone', point: '4,5' });
    expect(capture.ok).toBe(true);
    expect(session.state().board['4,4']).toBe('empty');
    expect(session.state().board['4,5']).toBe('black');

    const undo = session.execute({ type: 'undo' });
    expect(undo.ok).toBe(true);
    expect(session.state()).toEqual(beforeCapture);
    expect(session.state().board['4,4']).toBe('white');
    expect(session.state().board['4,5']).toBe('empty');
    expect(session.state()).toMatchObject({
      currentPlayer: 'black',
      moveNumber: 0,
      consecutivePasses: 0,
      phase: 'playing',
    });
  });

  it('uses LinearHistory as the repetition context and does not record a rejected ko recapture', () => {
    const engine = new GameEngine(new TorusTopology(9));
    const initial = engine.createInitialState();
    const beforeCapture: GameState = {
      ...initial,
      board: {
        ...initial.board,
        '4,4': 'white',
        '3,4': 'black',
        '5,4': 'black',
        '4,3': 'black',
        '3,5': 'white',
        '5,5': 'white',
        '4,6': 'white',
      },
    };
    const session = new GameSession(engine, new SimpleKoPolicy(), beforeCapture);

    expect(session.execute({ type: 'place-stone', point: '4,5' }).ok).toBe(true);
    expect(session.historyLength()).toBe(2);

    const recapture = session.execute({ type: 'place-stone', point: '4,4' });

    expect(recapture).toMatchObject({ ok: false, reason: 'repetition' });
    expect(session.historyLength()).toBe(2);
    expect(session.state().board['4,4']).toBe('empty');
    expect(session.state().board['4,5']).toBe('black');
  });

  it('undo after the second Pass returns from endgame to playing and keeps the first Pass', () => {
    const engine = new GameEngine(new TorusTopology(9));
    const session = new GameSession(engine, new SimpleKoPolicy());

    session.execute({ type: 'pass' });
    const secondPass = session.execute({ type: 'pass' });

    expect(secondPass.ok).toBe(true);
    expect(session.state()).toMatchObject({
      currentPlayer: 'black',
      moveNumber: 2,
      consecutivePasses: 2,
      phase: 'endgame',
    });

    const undo = session.execute({ type: 'undo' });

    expect(undo.ok).toBe(true);
    expect(session.historyLength()).toBe(2);
    expect(session.state()).toMatchObject({
      currentPlayer: 'white',
      moveNumber: 1,
      consecutivePasses: 1,
      phase: 'playing',
    });
  });

  it('restores repetition context after undo by dropping the undone future state', () => {
    const engine = new GameEngine(new TorusTopology(9));
    const policy = new RecordingPolicy();
    const session = new GameSession(engine, policy);

    session.execute({ type: 'place-stone', point: '1,1' });
    const secondMove = session.execute({ type: 'place-stone', point: '2,2' });
    if (!secondMove.ok) throw new Error(`Expected accepted move, got ${secondMove.reason}`);

    expect(session.execute({ type: 'undo' }).ok).toBe(true);
    session.execute({ type: 'place-stone', point: '3,3' });

    const restoredContext = policy.contexts.at(-1);
    expect(restoredContext?.states).toHaveLength(2);
    expect(restoredContext?.states.at(-1)?.board['1,1']).toBe('black');
    expect(restoredContext?.states.at(-1)?.board['2,2']).toBe('empty');
    expect(restoredContext?.states).not.toContain(secondMove.state);
  });

  it('rejects undo when there is no successful action to undo', () => {
    const engine = new GameEngine(new TorusTopology(9));
    const session = new GameSession(engine, new SimpleKoPolicy());

    expect(session.execute({ type: 'undo' })).toMatchObject({
      ok: false,
      reason: 'nothing-to-undo',
    });
    expect(session.historyLength()).toBe(1);
  });
});
