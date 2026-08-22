import { describe, expect, expectTypeOf, it } from 'vitest';
import type { EndgameClassifier } from '../endgame/EndgameClassifier';
import { ChineseScoring } from '../scoring/ChineseScoring';
import type { PointId, Topology } from '../topology/Topology';
import { TorusTopology } from '../topology/TorusTopology';
import type { GameState } from './types';
import { GameEngine } from './GameEngine';
import {
  GameSession,
  type GameCommand,
  type GameSessionConfig,
  type SessionCommand,
} from './GameSession';

const emptyClassifier: EndgameClassifier = Object.freeze({
  analyze: async () => Object.freeze([]),
});

const sessionConfig = (topology: Topology): GameSessionConfig =>
  Object.freeze({
    endgameClassifier: emptyClassifier,
    scoringStrategy: new ChineseScoring(topology),
    komi: 0,
  });

describe('GameSession', () => {
  it('keeps domain and session command types as separate boundaries', () => {
    expectTypeOf<GameCommand>().toEqualTypeOf<
      | Readonly<{ type: 'place-stone'; point: PointId }>
      | Readonly<{ type: 'pass' }>
    >();
    expectTypeOf<SessionCommand>().toEqualTypeOf<
      | Readonly<{ type: 'undo' }>
      | Readonly<{ type: 'redo' }>
    >();
  });

  it('is the command entry point and records only successful actions', async () => {
    const topology = new TorusTopology(9);
    const engine = new GameEngine(topology);
    const session = new GameSession(engine, sessionConfig(topology));

    expect(session.historyLength()).toBe(1);

    const first = await session.execute({ type: 'place-stone', point: '0,0' });
    expect(first.ok).toBe(true);
    expect(session.historyLength()).toBe(2);

    const invalid = await session.execute({ type: 'place-stone', point: '0,0' });
    expect(invalid).toMatchObject({ ok: false, reason: 'occupied' });
    expect(session.historyLength()).toBe(2);

    const pass = await session.execute({ type: 'pass' });
    expect(pass.ok).toBe(true);
    expect(session.historyLength()).toBe(3);
    expect(session.state()).toMatchObject({
      currentPlayer: 'black',
      moveNumber: 2,
      consecutivePasses: 1,
      phase: 'playing',
    });
  });

  it('undo restores board and all current rule-relevant turn state', async () => {
    const topology = new TorusTopology(9);
    const engine = new GameEngine(topology);
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
    const session = new GameSession(engine, sessionConfig(topology), beforeCapture);

    const capture = await session.execute({ type: 'place-stone', point: '4,5' });
    expect(capture.ok).toBe(true);
    expect(session.state().board['4,4']).toBe('empty');
    expect(session.state().board['4,5']).toBe('black');

    const undo = await session.executeSessionCommand({ type: 'undo' });
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

  it('gets minimal SimpleKoContext from LinearHistory and does not record a rejected recapture', async () => {
    const topology = new TorusTopology(9);
    const engine = new GameEngine(topology);
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
    const session = new GameSession(engine, sessionConfig(topology), beforeCapture);

    expect((await session.execute({ type: 'place-stone', point: '4,5' })).ok).toBe(true);
    expect(session.historyLength()).toBe(2);

    const recapture = await session.execute({ type: 'place-stone', point: '4,4' });

    expect(recapture).toMatchObject({ ok: false, reason: 'repetition' });
    expect(session.historyLength()).toBe(2);
    expect(session.state().board['4,4']).toBe('empty');
    expect(session.state().board['4,5']).toBe('black');
  });

  it('undo after a finished endgame returns to playing and keeps the first Pass', async () => {
    const topology = new TorusTopology(9);
    const engine = new GameEngine(topology);
    const session = new GameSession(engine, sessionConfig(topology));

    await session.execute({ type: 'pass' });
    const secondPass = await session.execute({ type: 'pass' });
    expect(secondPass.ok).toBe(true);
    expect(session.state().phase).toBe('endgame');

    await session.finishEndgameReview();
    expect(session.state()).toMatchObject({
      currentPlayer: 'black',
      moveNumber: 2,
      consecutivePasses: 2,
      phase: 'finished',
    });
    expect(session.finalScore()).not.toBeNull();

    const undo = await session.executeSessionCommand({ type: 'undo' });

    expect(undo.ok).toBe(true);
    expect(session.historyLength()).toBe(2);
    expect(session.finalScore()).toBeNull();
    expect(session.state()).toMatchObject({
      currentPlayer: 'white',
      moveNumber: 1,
      consecutivePasses: 1,
      phase: 'playing',
    });
  });

  it('rejects undo when there is no successful action to undo', async () => {
    const topology = new TorusTopology(9);
    const engine = new GameEngine(topology);
    const session = new GameSession(engine, sessionConfig(topology));

    expect(await session.executeSessionCommand({ type: 'undo' })).toMatchObject({
      ok: false,
      reason: 'nothing-to-undo',
    });
    expect(session.historyLength()).toBe(1);
  });
});
