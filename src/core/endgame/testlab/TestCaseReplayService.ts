import { AssistedEndgameClassifier } from '../AssistedEndgameClassifier';
import type { EndgameProposal, EndgameProposalStatus } from '../EndgameClassifier';
import { GameEngine } from '../../game/GameEngine';
import type { BoardOccupancy, GameState, PointOccupancy, StoneColor } from '../../game/types';
import {
  CUBE_FACES,
  CubeTopology,
  isValidCubeSize,
} from '../../topology/CubeTopology';
import type { PointId, Topology } from '../../topology/Topology';
import {
  TORUS_SIZES,
  TorusTopology,
  type TorusSize,
} from '../../topology/TorusTopology';
import type { PlanarOraclePosition } from './DifferentialOracle';
import { DeterministicRandom } from './DeterministicRandom';
import { EndgameTestLab, type EndgameTestTopology } from './EndgameTestLab';
import type {
  LifeDeathPatternName,
  SekiPatternName,
  StressPatternName,
  TopologyStressMode,
} from './EndgameFixture';
import {
  externalCorpusCaseCount,
  importExternalCorpusCase,
} from './ExternalCorpusImporter';
import {
  createLiveTestTopology,
  generateLiveTestCase,
} from './LiveTestGenerators';
import {
  LocalAnalysisClient,
  type LocalAnalysisResult,
} from './LocalAnalysisClient';
import {
  decodeTestCaseId,
  encodeTestCaseId,
  makeTestCaseIdentity,
  type ReferenceStatus,
  type ReplayableTestCase,
  type TestCaseDiagnostics,
  type TestCaseIdentity,
  type TestCaseSource,
  type TestCaseTopology,
} from './TestCase';

export const SYNTHETIC_ENDGAME_GENERATOR_VERSION = 1 as const;
export const EXTERNAL_CORPUS_IMPORTER_VERSION = 1 as const;

interface SyntheticScenario {
  readonly variant: number;
  readonly name: string;
  readonly minimumSize: number;
  readonly topology?: TestCaseTopology;
  readonly request:
    | Readonly<{ kind: 'minimal-unresolved' }>
    | Readonly<{ kind: 'life-death-pattern'; pattern: LifeDeathPatternName }>
    | Readonly<{ kind: 'seki-pattern'; pattern: SekiPatternName }>
    | Readonly<{
        kind: 'topology-stress';
        mode: TopologyStressMode;
        pattern: StressPatternName;
      }>;
}

/** Stable append-only synthetic variant table. Existing variant numbers must never be reassigned. */
const SYNTHETIC_SCENARIOS: readonly SyntheticScenario[] = Object.freeze([
  Object.freeze({ variant: 0, name: 'minimal-unresolved', minimumSize: 2, request: Object.freeze({ kind: 'minimal-unresolved' }) }),
  Object.freeze({ variant: 1, name: 'single-eye', minimumSize: 3, request: Object.freeze({ kind: 'life-death-pattern', pattern: 'single-eye' }) }),
  Object.freeze({ variant: 2, name: 'two-eyes-alive', minimumSize: 5, request: Object.freeze({ kind: 'life-death-pattern', pattern: 'two-eyes' }) }),
  Object.freeze({ variant: 3, name: 'false-eye', minimumSize: 3, request: Object.freeze({ kind: 'life-death-pattern', pattern: 'false-eye' }) }),
  Object.freeze({ variant: 4, name: 'atari', minimumSize: 3, request: Object.freeze({ kind: 'life-death-pattern', pattern: 'atari-group' }) }),
  Object.freeze({ variant: 5, name: 'shared-liberties-seki', minimumSize: 3, request: Object.freeze({ kind: 'seki-pattern', pattern: 'shared-liberties' }) }),
  Object.freeze({ variant: 6, name: 'ambiguous-contact', minimumSize: 3, request: Object.freeze({ kind: 'seki-pattern', pattern: 'ambiguous-contact' }) }),
  Object.freeze({ variant: 7, name: 'torus-seam-single-eye', minimumSize: 3, topology: 'torus', request: Object.freeze({ kind: 'topology-stress', mode: 'torus-seam', pattern: 'single-eye' }) }),
  Object.freeze({ variant: 8, name: 'torus-seam-false-eye', minimumSize: 3, topology: 'torus', request: Object.freeze({ kind: 'topology-stress', mode: 'torus-seam', pattern: 'false-eye' }) }),
  Object.freeze({ variant: 9, name: 'torus-seam-shared-liberties', minimumSize: 3, topology: 'torus', request: Object.freeze({ kind: 'topology-stress', mode: 'torus-seam', pattern: 'shared-liberties' }) }),
  Object.freeze({ variant: 10, name: 'cube-edge-false-eye', minimumSize: 3, topology: 'cube', request: Object.freeze({ kind: 'topology-stress', mode: 'cube-edge', pattern: 'false-eye' }) }),
  Object.freeze({ variant: 11, name: 'cube-edge-shared-liberties', minimumSize: 3, topology: 'cube', request: Object.freeze({ kind: 'topology-stress', mode: 'cube-edge', pattern: 'shared-liberties' }) }),
  Object.freeze({ variant: 12, name: 'cube-corner-single-eye', minimumSize: 3, topology: 'cube', request: Object.freeze({ kind: 'topology-stress', mode: 'cube-corner', pattern: 'single-eye' }) }),
  Object.freeze({ variant: 13, name: 'cube-corner-shared-liberties', minimumSize: 3, topology: 'cube', request: Object.freeze({ kind: 'topology-stress', mode: 'cube-corner', pattern: 'shared-liberties' }) }),
]);

const isTorusSize = (size: number): size is TorusSize =>
  TORUS_SIZES.some((candidate) => candidate === size);

export const createTestCaseTopology = (identity: TestCaseIdentity): Topology => {
  if (identity.topology === 'torus') {
    if (!isTorusSize(identity.size)) {
      throw new Error(`Unsupported Test ID Torus size: ${String(identity.size)}`);
    }
    return new TorusTopology(identity.size);
  }
  if (!isValidCubeSize(identity.size)) {
    throw new Error(`Unsupported Test ID Cube size: ${String(identity.size)}`);
  }
  return new CubeTopology(identity.size);
};

const asEndgameTopology = (topology: Topology): EndgameTestTopology => {
  if (topology instanceof TorusTopology || topology instanceof CubeTopology) return topology;
  throw new Error('Unsupported endgame test topology');
};

export const allowedSyntheticVariants = (
  topology: TestCaseTopology,
  size: number,
): readonly number[] =>
  Object.freeze(
    SYNTHETIC_SCENARIOS
      .filter((scenario) =>
        size >= scenario.minimumSize && (!scenario.topology || scenario.topology === topology),
      )
      .map((scenario) => scenario.variant),
  );

const syntheticScenario = (identity: TestCaseIdentity): SyntheticScenario => {
  const scenario = SYNTHETIC_SCENARIOS.find((candidate) => candidate.variant === identity.variant);
  if (!scenario) throw new Error(`Unknown synthetic endgame variant: ${String(identity.variant)}`);
  if (identity.size < scenario.minimumSize) {
    throw new Error(`${scenario.name} requires board size >= ${String(scenario.minimumSize)}`);
  }
  if (scenario.topology && scenario.topology !== identity.topology) {
    throw new Error(`${scenario.name} is not valid for ${identity.topology}`);
  }
  return scenario;
};

const playableSyntheticState = (state: GameState, moveNumber: number): GameState =>
  Object.freeze({
    ...state,
    currentPlayer: 'black',
    moveNumber,
    consecutivePasses: 0,
    phase: 'playing',
  });

const minimalSyntheticState = (
  topology: Topology,
  seed: number,
): Readonly<{ state: GameState; targetPoints: readonly PointId[] }> => {
  const engine = new GameEngine(topology);
  const initial = engine.createInitialState();
  const random = new DeterministicRandom(`synthetic-minimal-v${SYNTHETIC_ENDGAME_GENERATOR_VERSION}:${topology.id}:${seed}`);
  const first = random.pick(topology.points());
  const forbidden = new Set([first, ...topology.neighbors(first)]);
  const candidates = topology.points().filter((point) => !forbidden.has(point));
  const second = candidates.length > 0 ? random.pick(candidates) : topology.points().find((point) => point !== first);
  if (!second) throw new Error('Synthetic topology has fewer than two logical points');

  const board: Record<PointId, PointOccupancy> = { ...initial.board };
  board[first] = 'black';
  board[second] = 'white';
  const state: GameState = Object.freeze({
    board: Object.freeze(board) as BoardOccupancy,
    currentPlayer: 'black',
    moveNumber: 2,
    consecutivePasses: 0,
    phase: 'playing',
    captures: Object.freeze({ black: 0, white: 0 }),
  });
  for (const point of [first, second]) {
    const group = engine.groupAt(state, point);
    if (!group || group.liberties.length === 0) {
      throw new Error('Minimal synthetic generator created an invalid zero-liberty group');
    }
  }
  return Object.freeze({ state, targetPoints: Object.freeze([first, second]) });
};

const generateSyntheticCase = (identity: TestCaseIdentity): ReplayableTestCase => {
  const topology = createTestCaseTopology(identity);
  const scenario = syntheticScenario(identity);
  const testId = encodeTestCaseId(identity);

  if (scenario.request.kind === 'minimal-unresolved') {
    const generated = minimalSyntheticState(topology, identity.payload);
    return Object.freeze({
      testId,
      identity,
      state: generated.state,
      loadStrategy: 'snapshot',
      commands: Object.freeze([]),
      targetPoints: generated.targetPoints,
      scenario: scenario.name,
      tags: Object.freeze(['synthetic-endgame', 'unresolved', 'bootstrap-state']),
    });
  }

  const lab = new EndgameTestLab();
  const endgameTopology = asEndgameTopology(topology);
  const seed = String(identity.payload);
  const fixture = scenario.request.kind === 'life-death-pattern'
    ? lab.generate({ kind: scenario.request.kind, topology: endgameTopology, seed, pattern: scenario.request.pattern })
    : scenario.request.kind === 'seki-pattern'
      ? lab.generate({ kind: scenario.request.kind, topology: endgameTopology, seed, pattern: scenario.request.pattern })
      : lab.generate({
          kind: scenario.request.kind,
          topology: endgameTopology,
          seed,
          mode: scenario.request.mode,
          pattern: scenario.request.pattern,
        });

  const targetPoints = Object.freeze(
    fixture.placements.length > 0
      ? fixture.placements.map((placement) => placement.point)
      : topology.points().filter((point) => fixture.state.board[point] !== 'empty'),
  );
  return Object.freeze({
    testId,
    identity,
    state: playableSyntheticState(fixture.state, fixture.placements.length),
    loadStrategy: 'snapshot',
    commands: Object.freeze([]),
    targetPoints,
    scenario: scenario.name,
    tags: Object.freeze(['synthetic-endgame', scenario.name, ...fixture.tags]),
  });
};

const generateGameLikeCase = (identity: TestCaseIdentity): ReplayableTestCase => {
  const generated = generateLiveTestCase({
    generator: 'game-like',
    topology: identity.topology,
    size: identity.size,
    seed: String(identity.payload),
  });
  return Object.freeze({
    testId: encodeTestCaseId(identity),
    identity,
    state: generated.state,
    loadStrategy: 'replay-commands',
    commands: generated.commands,
    targetPoints: Object.freeze([]),
    scenario: 'game-like',
    tags: Object.freeze(['game-like', 'domain-generated', ...generated.tags]),
  });
};

const collectGroups = (
  state: GameState,
  topology: Topology,
): readonly (readonly PointId[])[] => {
  const engine = new GameEngine(topology);
  const visited = new Set<PointId>();
  const groups: (readonly PointId[])[] = [];
  for (const point of topology.points()) {
    if (visited.has(point) || state.board[point] === 'empty') continue;
    const group = engine.groupAt(state, point);
    if (!group) continue;
    const points = Object.freeze([...group.points].sort());
    for (const member of points) visited.add(member);
    groups.push(points);
  }
  return Object.freeze(groups);
};

const cubeGoTargetStatus = async (
  state: GameState,
  topology: Topology,
  targetPoints: readonly PointId[],
): Promise<ReferenceStatus> => {
  const proposal: EndgameProposal = await new AssistedEndgameClassifier().analyze(
    Object.freeze({ state, topology, groups: collectGroups(state, topology) }),
  );
  const target = targetPoints[0];
  if (!target) return 'unresolved';
  const group = proposal.find((candidate) => candidate.points.includes(target));
  return group?.status ?? 'unresolved';
};

const targetColor = (
  position: PlanarOraclePosition,
): StoneColor | null => {
  const first = position.targetCoordinates[0];
  if (!first) return null;
  return position.stones.find(
    (stone) => stone.row === first.row && stone.column === first.column,
  )?.color ?? null;
};

const kataGoOwnershipStatus = (
  position: PlanarOraclePosition,
  result: LocalAnalysisResult,
): ReferenceStatus => {
  const color = targetColor(position);
  if (!color || !result.ownership || result.ownership.length < position.boardSize * position.boardSize) {
    return 'unstable';
  }
  const values = position.targetCoordinates
    .map(({ row, column }) => result.ownership![row * position.boardSize + column])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (values.length !== position.targetCoordinates.length || values.length === 0) return 'unstable';
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const confidence = color === 'black' ? mean : -mean;
  if (confidence >= 0.8) return 'alive';
  if (confidence <= -0.8) return 'dead';
  return 'unstable';
};

const asPlanarOraclePosition = (
  diagnostics: TestCaseDiagnostics,
): PlanarOraclePosition =>
  Object.freeze({
    boardSize: diagnostics.sourcePosition.boardSize,
    currentPlayer: diagnostics.sourcePosition.currentPlayer,
    stones: diagnostics.sourcePosition.stones,
    targetCoordinates: diagnostics.sourcePosition.targetCoordinates,
  });

const evaluateKataGo = async (
  diagnostics: TestCaseDiagnostics,
  client: LocalAnalysisClient,
): Promise<Readonly<{ status: ReferenceStatus; reason?: string }>> => {
  const availability = await client.availability();
  if (!availability.available) {
    return Object.freeze({ status: 'unavailable', reason: availability.reason ?? 'Local KataGo is unavailable.' });
  }
  const position = asPlanarOraclePosition(diagnostics);
  try {
    const first = kataGoOwnershipStatus(position, await client.analyze(position));
    const second = kataGoOwnershipStatus(position, await client.analyze(position));
    if (first === 'unstable' || second === 'unstable' || first !== second) {
      return Object.freeze({ status: 'unstable', reason: 'KataGo target ownership was weak or inconsistent across repeated analysis.' });
    }
    return Object.freeze({ status: first });
  } catch (error) {
    return Object.freeze({
      status: 'unavailable',
      reason: error instanceof Error ? error.message : 'KataGo analysis failed.',
    });
  }
};

const attentionFor = (
  source: ReferenceStatus,
  kataGo: ReferenceStatus,
  cubeGo: ReferenceStatus,
  kataReason?: string,
): Readonly<{ attention: boolean; reason?: string }> => {
  if (kataGo === 'unavailable' || kataGo === 'unstable') {
    return Object.freeze({ attention: true, reason: kataReason ?? `KataGo result is ${kataGo}.` });
  }
  if (source !== 'unknown' && source !== 'unavailable' && source !== 'unstable' && source !== kataGo) {
    return Object.freeze({ attention: true, reason: `Source ${source} disagrees with KataGo ${kataGo}.` });
  }
  if (cubeGo !== kataGo) {
    return Object.freeze({ attention: true, reason: `KataGo ${kataGo} disagrees with Cube Go ${cubeGo}.` });
  }
  return Object.freeze({ attention: false });
};

export interface TestCaseReplayServiceOptions {
  readonly localAnalysisClient?: LocalAnalysisClient | null;
}

export class TestCaseReplayService {
  private readonly localAnalysisClient: LocalAnalysisClient | null;

  constructor(options: TestCaseReplayServiceOptions = {}) {
    this.localAnalysisClient = options.localAnalysisClient ?? null;
  }

  identityForGenerated(
    source: Exclude<TestCaseSource, 'corpus'>,
    topology: TestCaseTopology,
    size: number,
    payload: number,
  ): TestCaseIdentity {
    if (!Number.isSafeInteger(payload) || payload < 0 || payload > 0xffff_ffff) {
      throw new Error(`Generated Test ID payload must be uint32, got ${String(payload)}`);
    }
    const variant = source === 'synthetic-endgame'
      ? new DeterministicRandom(`synthetic-variant:${topology}:${size}:${payload}`).pick(
          allowedSyntheticVariants(topology, size),
        )
      : 0;
    return makeTestCaseIdentity({
      source,
      topology,
      size,
      variant,
      transform: 0,
      payload,
    });
  }

  identityForCorpus(
    topology: TestCaseTopology,
    size: number,
    catalogIndex: number,
    transform: number,
  ): TestCaseIdentity {
    if (!Number.isSafeInteger(catalogIndex) || catalogIndex < 0 || catalogIndex >= externalCorpusCaseCount()) {
      throw new Error(`Unknown external corpus case index: ${String(catalogIndex)}`);
    }
    return makeTestCaseIdentity({
      source: 'corpus',
      topology,
      size,
      variant: 0,
      transform,
      payload: catalogIndex,
    });
  }

  async createFromId(testId: string, evaluateCorpus = true): Promise<ReplayableTestCase> {
    return this.createFromIdentity(decodeTestCaseId(testId), evaluateCorpus);
  }

  async createFromIdentity(
    identity: TestCaseIdentity,
    evaluateCorpus = true,
  ): Promise<ReplayableTestCase> {
    createTestCaseTopology(identity);
    if (identity.source === 'game-like') return generateGameLikeCase(identity);
    if (identity.source === 'synthetic-endgame') return generateSyntheticCase(identity);

    const imported = importExternalCorpusCase(identity);
    const cubeGoStatus = await cubeGoTargetStatus(imported.state, imported.topology, imported.targetPoints);
    const kata = evaluateCorpus && this.localAnalysisClient
      ? await evaluateKataGo(imported.diagnostics, this.localAnalysisClient)
      : Object.freeze({ status: 'unavailable' as const, reason: 'Local KataGo analysis was not requested.' });
    const attention = attentionFor(
      imported.diagnostics.sourceStatus,
      kata.status,
      cubeGoStatus,
      kata.reason,
    );
    const diagnostics: TestCaseDiagnostics = Object.freeze({
      ...imported.diagnostics,
      kataGoStatus: kata.status,
      cubeGoStatus,
      attention: attention.attention,
      ...(attention.reason ? { attentionReason: attention.reason } : {}),
    });
    return Object.freeze({
      testId: encodeTestCaseId(identity),
      identity,
      state: imported.state,
      loadStrategy: 'snapshot',
      commands: Object.freeze([]),
      targetPoints: imported.targetPoints,
      diagnostics,
      scenario: imported.scenario,
      tags: imported.tags,
    });
  }
}

export const testCaseIdentityForLiveGame = (
  source: Exclude<TestCaseSource, 'corpus'>,
  topology: TestCaseTopology,
  size: number,
  payload: number,
): TestCaseIdentity => new TestCaseReplayService().identityForGenerated(source, topology, size, payload);

export const testCaseIdForIdentity = (identity: TestCaseIdentity): string => encodeTestCaseId(identity);

/** Compatibility helper for tests that already use the lower-level live generator topology factory. */
export const createLegacyLiveTopologyForIdentity = (identity: TestCaseIdentity): Topology =>
  createLiveTestTopology({
    generator: identity.source === 'synthetic-endgame' ? 'endgame' : 'game-like',
    topology: identity.topology,
    size: identity.size,
    seed: String(identity.payload),
  });
