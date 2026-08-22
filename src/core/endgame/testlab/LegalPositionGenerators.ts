import { GameEngine } from '../../game/GameEngine';
import { LinearHistory } from '../../history/LinearHistory';
import type { Topology } from '../../topology/Topology';
import { DeterministicRandom } from './DeterministicRandom';
import {
  ENDGAME_TEST_GENERATOR_VERSION,
  endgameFixtureId,
  type EndgameTestFixture,
  type EndgameTestTopologyDescriptor,
  type GeneratedGameCommand,
} from './EndgameFixture';

const defaultMaxMoves = (topology: Topology): number =>
  Math.max(1, Math.min(96, Math.floor(topology.points().length * 0.45)));

const assertMaxMoves = (maxMoves: number): void => {
  if (!Number.isSafeInteger(maxMoves) || maxMoves < 0) {
    throw new Error(`maxMoves must be a non-negative safe integer, got ${String(maxMoves)}`);
  }
};

interface LegalSequenceResult {
  readonly engine: GameEngine;
  readonly history: LinearHistory;
  readonly commands: readonly GeneratedGameCommand[];
}

const generateLegalSequence = (
  topology: Topology,
  seed: string,
  maxMoves: number,
): LegalSequenceResult => {
  assertMaxMoves(maxMoves);
  const engine = new GameEngine(topology);
  const history = new LinearHistory(engine.createInitialState());
  const random = new DeterministicRandom(seed);
  const commands: GeneratedGameCommand[] = [];

  for (let move = 0; move < maxMoves; move += 1) {
    const state = history.current();
    let accepted = false;
    const candidates = random.shuffle(topology.points());

    for (const point of candidates) {
      if (state.board[point] !== 'empty') continue;
      const result = engine.placeStone(
        state,
        point,
        state.currentPlayer,
        history.simpleKoContext(),
      );
      if (!result.ok) continue;

      history.push(result.state);
      commands.push(Object.freeze({ type: 'place-stone', point }));
      accepted = true;
      break;
    }

    if (!accepted) break;
  }

  return Object.freeze({
    engine,
    history,
    commands: Object.freeze(commands),
  });
};

export interface LegalGameGeneratorOptions {
  readonly seed: string | number;
  readonly maxMoves?: number;
}

export const generateLegalGameFixture = (
  topology: Topology,
  descriptor: EndgameTestTopologyDescriptor,
  options: LegalGameGeneratorOptions,
): EndgameTestFixture => {
  const seed = String(options.seed);
  const maxMoves = options.maxMoves ?? defaultMaxMoves(topology);
  const generated = generateLegalSequence(topology, seed, maxMoves);
  const metadata = Object.freeze({
    kind: 'legal-game' as const,
    version: ENDGAME_TEST_GENERATOR_VERSION,
    seed,
    options: Object.freeze({ maxMoves }),
  });

  return Object.freeze({
    fixtureId: endgameFixtureId(descriptor, metadata),
    topology: descriptor,
    state: generated.history.current(),
    commands: generated.commands,
    placements: Object.freeze([]),
    tags: Object.freeze(['legal-game', 'domain-generated']),
    generator: metadata,
  });
};

export interface EndgamePositionGeneratorOptions {
  readonly seed: string | number;
  readonly maxMoves?: number;
}

export const generateEndgamePositionFixture = (
  topology: Topology,
  descriptor: EndgameTestTopologyDescriptor,
  options: EndgamePositionGeneratorOptions,
): EndgameTestFixture => {
  const seed = String(options.seed);
  const maxMoves = options.maxMoves ?? defaultMaxMoves(topology);
  const generated = generateLegalSequence(topology, seed, maxMoves);
  const commands = [...generated.commands];

  for (let passIndex = 0; passIndex < 2; passIndex += 1) {
    const pass = generated.engine.pass(generated.history.current());
    if (!pass.ok) throw new Error('Generated legal simulation rejected its endgame Pass');
    generated.history.push(pass.state);
    commands.push(Object.freeze({ type: 'pass' }));
  }

  const metadata = Object.freeze({
    kind: 'endgame-position' as const,
    version: ENDGAME_TEST_GENERATOR_VERSION,
    seed,
    options: Object.freeze({ maxMoves }),
  });

  return Object.freeze({
    fixtureId: endgameFixtureId(descriptor, metadata),
    topology: descriptor,
    state: generated.history.current(),
    commands: Object.freeze(commands),
    placements: Object.freeze([]),
    tags: Object.freeze(['endgame-position', 'domain-generated']),
    generator: metadata,
  });
};

export const replayGeneratedCommands = (
  topology: Topology,
  commands: readonly GeneratedGameCommand[],
) => {
  const engine = new GameEngine(topology);
  const history = new LinearHistory(engine.createInitialState());

  for (const command of commands) {
    if (command.type === 'pass') {
      const result = engine.pass(history.current());
      if (!result.ok) throw new Error('Generated replay rejected Pass');
      history.push(result.state);
      continue;
    }

    const state = history.current();
    const result = engine.placeStone(
      state,
      command.point,
      state.currentPlayer,
      history.simpleKoContext(),
    );
    if (!result.ok) {
      throw new Error(`Generated replay rejected ${command.point}: ${result.reason}`);
    }
    history.push(result.state);
  }

  return history.current();
};
