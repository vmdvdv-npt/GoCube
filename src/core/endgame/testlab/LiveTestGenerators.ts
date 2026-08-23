import { GameEngine } from '../../game/GameEngine';
import type { GameState } from '../../game/types';
import { LinearHistory } from '../../history/LinearHistory';
import {
  CubeTopology,
  isValidCubeSize,
} from '../../topology/CubeTopology';
import type { PointId, Topology } from '../../topology/Topology';
import {
  TORUS_SIZES,
  TorusTopology,
  type TorusSize,
} from '../../topology/TorusTopology';
import { DeterministicRandom } from './DeterministicRandom';
import type {
  GeneratedGameCommand,
  LifeDeathPatternName,
  SekiPatternName,
  StressPatternName,
  TopologyStressMode,
} from './EndgameFixture';
import { EndgameTestLab, type EndgameTestTopology } from './EndgameTestLab';

export const LIVE_TEST_GENERATOR_VERSION = 1 as const;

export type LiveTestGeneratorType = 'game-like' | 'endgame';
export type LiveTestTopologyKind = 'torus' | 'cube';
export type LiveTestLoadStrategy = 'replay-commands' | 'snapshot';

export interface LiveTestGenerationSpec {
  readonly generator: LiveTestGeneratorType;
  readonly topology: LiveTestTopologyKind;
  readonly size: number;
  readonly seed: string;
}

export interface LiveTestGeneratedCase {
  readonly id: string;
  readonly version: typeof LIVE_TEST_GENERATOR_VERSION;
  readonly spec: LiveTestGenerationSpec;
  readonly state: GameState;
  readonly commands: readonly GeneratedGameCommand[];
  readonly requestedMoves: number;
  readonly loadStrategy: LiveTestLoadStrategy;
  readonly scenario: string;
  readonly tags: readonly string[];
}

type GenerationProfile = Readonly<{
  targetDensityMin: number;
  targetDensityRange: number;
  focusLimit: number;
  explorationLimit: number;
  contactWeight: number;
  threatenedWeight: number;
}>;

type SyntheticEndgameScenario =
  | Readonly<{
      kind: 'life-death-pattern';
      name: string;
      pattern: LifeDeathPatternName;
    }>
  | Readonly<{
      kind: 'seki-pattern';
      name: string;
      pattern: SekiPatternName;
    }>
  | Readonly<{
      kind: 'topology-stress';
      name: string;
      mode: TopologyStressMode;
      pattern: StressPatternName;
    }>;

type EndgameScenario = 'legal-tactical' | SyntheticEndgameScenario;

const PROFILES: Readonly<Record<LiveTestGeneratorType, GenerationProfile>> = Object.freeze({
  'game-like': Object.freeze({
    targetDensityMin: 0.27,
    targetDensityRange: 0.2,
    focusLimit: 24,
    explorationLimit: 10,
    contactWeight: 8,
    threatenedWeight: 13,
  }),
  endgame: Object.freeze({
    targetDensityMin: 0.48,
    targetDensityRange: 0.17,
    focusLimit: 30,
    explorationLimit: 6,
    contactWeight: 11,
    threatenedWeight: 18,
  }),
});

const isTorusSize = (size: number): size is TorusSize =>
  TORUS_SIZES.some((candidate) => candidate === size);

export const createLiveTestTopology = (spec: LiveTestGenerationSpec): Topology => {
  if (spec.topology === 'torus') {
    if (!isTorusSize(spec.size)) {
      throw new Error(`Unsupported live-test Torus size: ${String(spec.size)}`);
    }
    return new TorusTopology(spec.size);
  }

  if (!isValidCubeSize(spec.size)) {
    throw new Error(`Unsupported live-test Cube size: ${String(spec.size)}`);
  }
  return new CubeTopology(spec.size);
};

const normalizeSpec = (spec: LiveTestGenerationSpec): LiveTestGenerationSpec => {
  const seed = String(spec.seed).trim();
  if (seed.length === 0) throw new Error('Live-test seed must not be empty');
  if (spec.generator !== 'game-like' && spec.generator !== 'endgame') {
    throw new Error(`Unsupported live-test generator: ${String(spec.generator)}`);
  }
  if (spec.topology !== 'torus' && spec.topology !== 'cube') {
    throw new Error(`Unsupported live-test topology: ${String(spec.topology)}`);
  }
  const normalized = Object.freeze({ ...spec, seed });
  createLiveTestTopology(normalized);
  return normalized;
};

const groupKey = (points: readonly PointId[]): string => [...points].sort().join('|');

const collectCandidatePoints = (
  topology: Topology,
  engine: GameEngine,
  state: GameState,
  random: DeterministicRandom,
  profile: GenerationProfile,
): readonly PointId[] => {
  const empty = topology.points().filter((point) => state.board[point] === 'empty');
  if (empty.length <= profile.focusLimit + profile.explorationLimit) {
    return random.shuffle(empty);
  }

  const focused = new Set<PointId>();
  const visitedGroups = new Set<PointId>();

  for (const point of topology.points()) {
    if (state.board[point] === 'empty') continue;

    for (const neighbor of topology.neighbors(point)) {
      if (state.board[neighbor] === 'empty') focused.add(neighbor);
    }

    if (visitedGroups.has(point)) continue;
    const group = engine.groupAt(state, point);
    if (!group) continue;
    for (const groupPoint of group.points) visitedGroups.add(groupPoint);
    if (group.liberties.length <= 3) {
      for (const liberty of group.liberties) focused.add(liberty);
    }
  }

  const focusedSample = random.shuffle([...focused]).slice(0, profile.focusLimit);
  const explorationSample = random
    .shuffle(empty.filter((point) => !focused.has(point)))
    .slice(0, profile.explorationLimit);

  return Object.freeze([...new Set([...focusedSample, ...explorationSample])]);
};

const scoreCandidate = (
  topology: Topology,
  engine: GameEngine,
  state: GameState,
  point: PointId,
  acceptedState: GameState,
  capturedCount: number,
  random: DeterministicRandom,
  profile: GenerationProfile,
): number => {
  const friendlyGroups = new Map<string, number>();
  const enemyGroups = new Map<string, number>();
  let friendlyNeighbors = 0;
  let enemyNeighbors = 0;

  for (const neighbor of topology.neighbors(point)) {
    const occupancy = state.board[neighbor];
    if (occupancy === 'empty') continue;
    const group = engine.groupAt(state, neighbor);
    if (!group) continue;
    const key = groupKey(group.points);
    if (occupancy === state.currentPlayer) {
      friendlyNeighbors += 1;
      friendlyGroups.set(key, group.liberties.length);
    } else {
      enemyNeighbors += 1;
      enemyGroups.set(key, group.liberties.length);
    }
  }

  let score = random.next() * 5;
  score += capturedCount * 70;
  score += (friendlyNeighbors + enemyNeighbors) * profile.contactWeight;
  score += Math.max(0, friendlyGroups.size - 1) * 18;
  score += Math.max(0, enemyGroups.size - 1) * 14;

  for (const liberties of enemyGroups.values()) {
    if (liberties === 1) score += profile.threatenedWeight * 2.2;
    else if (liberties === 2) score += profile.threatenedWeight;
    else if (liberties === 3) score += profile.threatenedWeight * 0.3;
  }
  for (const liberties of friendlyGroups.values()) {
    if (liberties === 1) score += profile.threatenedWeight * 1.7;
    else if (liberties === 2) score += profile.threatenedWeight * 0.8;
  }

  const ownGroup = engine.groupAt(acceptedState, point);
  const ownLiberties = ownGroup?.liberties.length ?? 0;
  if (ownLiberties <= 1 && capturedCount === 0) score -= 18;
  else if (ownLiberties === 2) score += 5;
  else if (ownLiberties === 3) score += 8;
  else score += 4;

  const localOccupancy = friendlyNeighbors + enemyNeighbors;
  if (state.moveNumber < 4) {
    score += localOccupancy === 0 ? 15 : 3;
  } else if (localOccupancy === 0) {
    score -= profile.contactWeight * 0.65;
  }

  return score;
};

const requestedMoveCount = (
  topology: Topology,
  spec: LiveTestGenerationSpec,
  profile: GenerationProfile,
): number => {
  const random = new DeterministicRandom(`${spec.seed}|${spec.generator}|density`);
  const density = profile.targetDensityMin + random.next() * profile.targetDensityRange;
  return Math.max(4, Math.min(256, Math.floor(topology.points().length * density)));
};

const generateSequence = (
  topology: Topology,
  spec: LiveTestGenerationSpec,
): Readonly<{
  state: GameState;
  commands: readonly GeneratedGameCommand[];
  requestedMoves: number;
}> => {
  const engine = new GameEngine(topology);
  const history = new LinearHistory(engine.createInitialState());
  const random = new DeterministicRandom(
    `${LIVE_TEST_GENERATOR_VERSION}|${spec.generator}|${spec.topology}|${spec.size}|${spec.seed}`,
  );
  const profile = PROFILES[spec.generator];
  const maxMoves = requestedMoveCount(topology, spec, profile);
  const commands: GeneratedGameCommand[] = [];

  for (let move = 0; move < maxMoves; move += 1) {
    const state = history.current();
    const candidates = collectCandidatePoints(topology, engine, state, random, profile);
    let best: Readonly<{ point: PointId; state: GameState; score: number }> | null = null;

    for (const point of [...candidates].sort()) {
      const result = engine.placeStone(
        state,
        point,
        state.currentPlayer,
        history.simpleKoContext(),
      );
      if (!result.ok) continue;
      const score = scoreCandidate(
        topology,
        engine,
        state,
        point,
        result.state,
        result.captured.length,
        random,
        profile,
      );
      if (!best || score > best.score) {
        best = Object.freeze({ point, state: result.state, score });
      }
    }

    if (!best) {
      for (const point of random.shuffle(topology.points())) {
        if (state.board[point] !== 'empty') continue;
        const result = engine.placeStone(
          state,
          point,
          state.currentPlayer,
          history.simpleKoContext(),
        );
        if (!result.ok) continue;
        best = Object.freeze({ point, state: result.state, score: 0 });
        break;
      }
    }

    if (!best) break;
    history.push(best.state);
    commands.push(Object.freeze({ type: 'place-stone', point: best.point }));
  }

  return Object.freeze({
    state: history.current(),
    commands: Object.freeze(commands),
    requestedMoves: maxMoves,
  });
};

const syntheticEndgameScenarios = (
  topology: EndgameTestTopology,
): readonly SyntheticEndgameScenario[] => {
  const scenarios: SyntheticEndgameScenario[] = [];

  if (topology.size >= 3) {
    scenarios.push(
      Object.freeze({
        kind: 'life-death-pattern',
        name: 'single-eye',
        pattern: 'single-eye',
      }),
      Object.freeze({
        kind: 'life-death-pattern',
        name: 'false-eye',
        pattern: 'false-eye',
      }),
      Object.freeze({
        kind: 'life-death-pattern',
        name: 'atari',
        pattern: 'atari-group',
      }),
      Object.freeze({
        kind: 'seki-pattern',
        name: 'shared-liberties-seki',
        pattern: 'shared-liberties',
      }),
      Object.freeze({
        kind: 'seki-pattern',
        name: 'ambiguous-contact',
        pattern: 'ambiguous-contact',
      }),
    );
  }

  if (topology.size >= 5) {
    scenarios.push(
      Object.freeze({
        kind: 'life-death-pattern',
        name: 'two-eyes-alive',
        pattern: 'two-eyes',
      }),
    );
  }

  if (topology instanceof TorusTopology && topology.size >= 3) {
    scenarios.push(
      Object.freeze({
        kind: 'topology-stress',
        name: 'torus-seam-single-eye',
        mode: 'torus-seam',
        pattern: 'single-eye',
      }),
      Object.freeze({
        kind: 'topology-stress',
        name: 'torus-seam-false-eye',
        mode: 'torus-seam',
        pattern: 'false-eye',
      }),
      Object.freeze({
        kind: 'topology-stress',
        name: 'torus-seam-shared-liberties',
        mode: 'torus-seam',
        pattern: 'shared-liberties',
      }),
    );
  }

  if (topology instanceof CubeTopology && topology.size >= 3) {
    scenarios.push(
      Object.freeze({
        kind: 'topology-stress',
        name: 'cube-edge-false-eye',
        mode: 'cube-edge',
        pattern: 'false-eye',
      }),
      Object.freeze({
        kind: 'topology-stress',
        name: 'cube-edge-shared-liberties',
        mode: 'cube-edge',
        pattern: 'shared-liberties',
      }),
      Object.freeze({
        kind: 'topology-stress',
        name: 'cube-corner-single-eye',
        mode: 'cube-corner',
        pattern: 'single-eye',
      }),
      Object.freeze({
        kind: 'topology-stress',
        name: 'cube-corner-shared-liberties',
        mode: 'cube-corner',
        pattern: 'shared-liberties',
      }),
    );
  }

  return Object.freeze(scenarios);
};

const selectEndgameScenario = (
  topology: EndgameTestTopology,
  spec: LiveTestGenerationSpec,
): EndgameScenario => {
  const scenarios: EndgameScenario[] = [
    'legal-tactical',
    ...syntheticEndgameScenarios(topology),
  ];
  const random = new DeterministicRandom(
    `${LIVE_TEST_GENERATOR_VERSION}|endgame-scenario|${spec.topology}|${spec.size}|${spec.seed}`,
  );
  return scenarios[random.integer(scenarios.length)] ?? 'legal-tactical';
};

const generateSyntheticEndgame = (
  topology: EndgameTestTopology,
  spec: LiveTestGenerationSpec,
  scenario: SyntheticEndgameScenario,
): Readonly<{
  state: GameState;
  commands: readonly GeneratedGameCommand[];
  requestedMoves: number;
  loadStrategy: LiveTestLoadStrategy;
  scenario: string;
  tags: readonly string[];
}> => {
  const lab = new EndgameTestLab();
  const fixture = scenario.kind === 'life-death-pattern'
    ? lab.generate({
        kind: scenario.kind,
        topology,
        seed: spec.seed,
        pattern: scenario.pattern,
      })
    : scenario.kind === 'seki-pattern'
      ? lab.generate({
          kind: scenario.kind,
          topology,
          seed: spec.seed,
          pattern: scenario.pattern,
        })
      : lab.generate({
          kind: scenario.kind,
          topology,
          seed: spec.seed,
          mode: scenario.mode,
          pattern: scenario.pattern,
        });

  const state: GameState = Object.freeze({
    ...fixture.state,
    currentPlayer: 'black',
    moveNumber: fixture.placements.length,
    consecutivePasses: 0,
    phase: 'playing',
    captures: Object.freeze({ black: 0, white: 0 }),
  });

  return Object.freeze({
    state,
    commands: Object.freeze([]),
    requestedMoves: 0,
    loadStrategy: 'snapshot' as const,
    scenario: scenario.name,
    tags: Object.freeze(['endgame', 'synthetic', ...fixture.tags]),
  });
};

const generateEndgameCase = (
  topology: EndgameTestTopology,
  spec: LiveTestGenerationSpec,
): Readonly<{
  state: GameState;
  commands: readonly GeneratedGameCommand[];
  requestedMoves: number;
  loadStrategy: LiveTestLoadStrategy;
  scenario: string;
  tags: readonly string[];
}> => {
  const scenario = selectEndgameScenario(topology, spec);
  if (scenario === 'legal-tactical') {
    const generated = generateSequence(topology, spec);
    return Object.freeze({
      ...generated,
      loadStrategy: 'replay-commands' as const,
      scenario,
      tags: Object.freeze(['endgame', 'legal', 'tactical', 'contact-play']),
    });
  }

  try {
    return generateSyntheticEndgame(topology, spec, scenario);
  } catch {
    const generated = generateSequence(topology, spec);
    return Object.freeze({
      ...generated,
      loadStrategy: 'replay-commands' as const,
      scenario: 'legal-tactical-fallback',
      tags: Object.freeze(['endgame', 'legal', 'tactical', 'fallback']),
    });
  }
};

export const generateLiveTestCase = (input: LiveTestGenerationSpec): LiveTestGeneratedCase => {
  const spec = normalizeSpec(input);
  const topology = createLiveTestTopology(spec);
  const generated = spec.generator === 'endgame'
    ? generateEndgameCase(topology as EndgameTestTopology, spec)
    : Object.freeze({
        ...generateSequence(topology, spec),
        loadStrategy: 'replay-commands' as const,
        scenario: 'tactical-local-play',
        tags: Object.freeze(['game-like', 'legal', 'tactical', 'local-play']),
      });

  return Object.freeze({
    id: `${spec.generator}:v${LIVE_TEST_GENERATOR_VERSION}:${spec.topology}:${spec.size}:seed=${spec.seed}`,
    version: LIVE_TEST_GENERATOR_VERSION,
    spec,
    state: generated.state,
    commands: generated.commands,
    requestedMoves: generated.requestedMoves,
    loadStrategy: generated.loadStrategy,
    scenario: generated.scenario,
    tags: generated.tags,
  });
};

export const replayLiveTestCase = (spec: LiveTestGenerationSpec): LiveTestGeneratedCase =>
  generateLiveTestCase(spec);

export class GameLikeGenerator {
  generate(spec: Omit<LiveTestGenerationSpec, 'generator'>): LiveTestGeneratedCase {
    return generateLiveTestCase(Object.freeze({ ...spec, generator: 'game-like' }));
  }
}

export class EndgameGenerator {
  generate(spec: Omit<LiveTestGenerationSpec, 'generator'>): LiveTestGeneratedCase {
    return generateLiveTestCase(Object.freeze({ ...spec, generator: 'endgame' }));
  }
}
