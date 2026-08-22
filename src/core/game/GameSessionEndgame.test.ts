import { describe, expect, it } from 'vitest';
import type {
  EndgameClassification,
  EndgameClassifier,
} from '../endgame/EndgameClassifier';
import { ChineseScoring } from '../scoring/ChineseScoring';
import { JapaneseScoring } from '../scoring/JapaneseScoring';
import type { FinalScore, ScoringStrategy } from '../scoring/Scoring';
import type { PointId } from '../topology/Topology';
import { TorusTopology } from '../topology/TorusTopology';
import { GameEngine } from './GameEngine';
import { GameSession, type GameSessionConfig } from './GameSession';
import type { GameState } from './types';

const emptyClassification: EndgameClassification = Object.freeze([]);

class RecordingClassifier implements EndgameClassifier {
  readonly calls: (readonly (readonly PointId[])[])[] = [];

  constructor(private readonly result: EndgameClassification = emptyClassification) {}

  async classify(
    groups: readonly (readonly PointId[])[],
  ): Promise<EndgameClassification> {
    this.calls.push(groups);
    return this.result;
  }
}

class RecordingScoring implements ScoringStrategy {
  readonly ruleSet: ScoringStrategy['ruleSet'];
  readonly results: FinalScore[] = [];
  readonly calls: {
    readonly state: GameState;
    readonly classification: EndgameClassification;
    readonly komi: number;
  }[] = [];

  constructor(private readonly delegate: ScoringStrategy) {
    this.ruleSet = delegate.ruleSet;
  }

  score(
    state: GameState,
    classification: EndgameClassification,
    komi: number,
  ): FinalScore {
    this.calls.push({ state, classification, komi });
    const result = this.delegate.score(state, classification, komi);
    this.results.push(result);
    return result;
  }
}

const config = (
  endgameClassifier: EndgameClassifier,
  scoringStrategy: ScoringStrategy,
  komi = 0,
): GameSessionConfig =>
  Object.freeze({ endgameClassifier, scoringStrategy, komi });

describe('GameSession endgame flow', () => {
  it('does not start endgame after the first Pass', async () => {
    const topology = new TorusTopology(9);
    const classifier = new RecordingClassifier();
    const session = new GameSession(
      new GameEngine(topology),
      config(classifier, new ChineseScoring(topology)),
    );

    const result = await session.execute({ type: 'pass' });

    expect(result.ok).toBe(true);
    expect(session.state()).toMatchObject({
      consecutivePasses: 1,
      phase: 'playing',
    });
    expect(classifier.calls).toHaveLength(0);
    expect(session.finalScore()).toBeNull();
  });

  it('a normal move after one Pass resets the sequence without starting endgame', async () => {
    const topology = new TorusTopology(9);
    const classifier = new RecordingClassifier();
    const session = new GameSession(
      new GameEngine(topology),
      config(classifier, new ChineseScoring(topology)),
    );

    await session.execute({ type: 'pass' });
    const move = await session.execute({ type: 'place-stone', point: '0,0' });

    expect(move.ok).toBe(true);
    expect(session.state()).toMatchObject({
      consecutivePasses: 0,
      phase: 'playing',
    });
    expect(classifier.calls).toHaveLength(0);
    expect(session.finalScore()).toBeNull();
  });

  it('runs classification after the engine reaches endgame and passes it unchanged to scoring', async () => {
    const topology = new TorusTopology(9);
    const engine = new GameEngine(topology);
    const initial = engine.createInitialState();
    const position: GameState = {
      ...initial,
      board: {
        ...initial.board,
        '0,0': 'black',
        '0,1': 'black',
        '4,4': 'white',
      },
    };
    const classification = emptyClassification;
    const scoring = new RecordingScoring(new ChineseScoring(topology));
    let session: GameSession | null = null;
    const observation: {
      phaseAtClassification: GameState['phase'] | null;
      endgameSnapshot: GameState | null;
    } = { phaseAtClassification: null, endgameSnapshot: null };
    const classifier: EndgameClassifier = {
      classify: async (groups) => {
        observation.phaseAtClassification = session?.state().phase ?? null;
        observation.endgameSnapshot = session?.state() ?? null;
        expect(groups).toEqual([
          ['0,0', '0,1'],
          ['4,4'],
        ]);
        return classification;
      },
    };
    session = new GameSession(
      engine,
      config(classifier, scoring, 0),
      position,
    );

    await session.execute({ type: 'pass' });
    const secondPass = await session.execute({ type: 'pass' });

    expect(secondPass.ok).toBe(true);
    expect(observation.phaseAtClassification).toBe('endgame');
    expect(observation.endgameSnapshot?.phase).toBe('endgame');
    expect(scoring.calls).toHaveLength(1);
    expect(scoring.calls[0]?.state.phase).toBe('endgame');
    expect(scoring.calls[0]?.classification).toBe(classification);
    expect(session.state().phase).toBe('finished');
    expect(observation.endgameSnapshot).not.toBe(session.state());
    expect(observation.endgameSnapshot?.phase).toBe('endgame');
    expect(session.finalScore()).toBe(scoring.results[0]);
  });

  it('finishes a Chinese-scoring game through GameSession', async () => {
    const topology = new TorusTopology(9);
    const classifier = new RecordingClassifier();
    const session = new GameSession(
      new GameEngine(topology),
      config(classifier, new ChineseScoring(topology), 6.5),
    );

    await session.execute({ type: 'pass' });
    await session.execute({ type: 'pass' });

    expect(session.state().phase).toBe('finished');
    expect(session.finalScore()).toMatchObject({
      ruleSet: 'chinese',
      black: 0,
      white: 6.5,
      komi: 6.5,
      territory: { black: 0, white: 0, neutral: 81, seki: 0 },
      winner: 'white',
      margin: 6.5,
    });
    expect(JSON.parse(JSON.stringify(session.finalScore()))).toEqual(session.finalScore());
  });

  it('finishes a Japanese-scoring game through GameSession', async () => {
    const topology = new TorusTopology(9);
    const classifier = new RecordingClassifier();
    const session = new GameSession(
      new GameEngine(topology),
      config(classifier, new JapaneseScoring(topology), 5.5),
    );

    await session.execute({ type: 'pass' });
    await session.execute({ type: 'pass' });

    expect(session.state().phase).toBe('finished');
    expect(session.finalScore()).toMatchObject({
      ruleSet: 'japanese',
      black: 0,
      white: 5.5,
      komi: 5.5,
      prisoners: { black: 0, white: 0 },
      winner: 'white',
      margin: 5.5,
    });
  });

  it('rejects new game actions after the session is finished', async () => {
    const topology = new TorusTopology(9);
    const session = new GameSession(
      new GameEngine(topology),
      config(new RecordingClassifier(), new ChineseScoring(topology)),
    );

    await session.execute({ type: 'pass' });
    await session.execute({ type: 'pass' });
    const score = session.finalScore();

    expect(await session.execute({ type: 'place-stone', point: '0,0' })).toMatchObject({
      ok: false,
      reason: 'not-playing',
      state: { phase: 'finished' },
    });
    expect(await session.execute({ type: 'pass' })).toMatchObject({
      ok: false,
      reason: 'not-playing',
      state: { phase: 'finished' },
    });
    expect(session.historyLength()).toBe(3);
    expect(session.finalScore()).toBe(score);
  });

  it('Undo removes the finishing Pass and score, and redoing the Pass recalculates deterministically', async () => {
    const topology = new TorusTopology(9);
    const classifier = new RecordingClassifier();
    const scoring = new RecordingScoring(new ChineseScoring(topology));
    const session = new GameSession(
      new GameEngine(topology),
      config(classifier, scoring, 7.5),
    );

    const firstPass = await session.execute({ type: 'pass' });
    await session.execute({ type: 'pass' });
    const firstScore = session.finalScore();

    expect(firstPass.ok).toBe(true);
    expect(firstPass.state).toMatchObject({
      consecutivePasses: 1,
      phase: 'playing',
    });
    expect(classifier.calls).toHaveLength(1);
    expect(scoring.calls).toHaveLength(1);

    const undo = await session.executeSessionCommand({ type: 'undo' });

    expect(undo.ok).toBe(true);
    expect(session.state()).toEqual(firstPass.state);
    expect(session.state()).toMatchObject({
      consecutivePasses: 1,
      phase: 'playing',
    });
    expect(session.finalScore()).toBeNull();

    await session.execute({ type: 'pass' });
    const secondScore = session.finalScore();

    expect(session.state().phase).toBe('finished');
    expect(classifier.calls).toHaveLength(2);
    expect(scoring.calls).toHaveLength(2);
    expect(secondScore).not.toBe(firstScore);
    expect(JSON.stringify(secondScore)).toBe(JSON.stringify(firstScore));
  });
});
