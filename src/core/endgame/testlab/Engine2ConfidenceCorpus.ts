import type { GameState, PointOccupancy } from '../../game/types';
import { CubeTopology } from '../../topology/CubeTopology';
import type { PointId, Topology } from '../../topology/Topology';
import { TorusTopology } from '../../topology/TorusTopology';
import {
  classifyGroupConfidence,
  type EndgameConfidenceOptions,
  type EndgameConfidenceResult,
} from '../EndgameConfidenceClassifier';
import { buildEndgameGraph } from '../EndgameGraphCore';

export const ENGINE2_CONFIDENCE_CORPUS_VERSION = 'engine2-confidence-corpus-v1';

export type Engine2ConfidenceExpectation =
  | Readonly<{ readonly expectedLabel: 'alive' | 'dead' | 'seki'; readonly minimumConfidence: number }>
  | Readonly<{ readonly expectedUnresolved: true }>;

export interface Engine2ConfidenceCorpusCase {
  readonly id: string;
  readonly category:
    | 'open-space'
    | 'enclosure'
    | 'atari'
    | 'eyes'
    | 'seki'
    | 'ambiguous'
    | 'topology'
    | 'conflict';
  readonly topology: Topology;
  readonly state: GameState;
  readonly targetPoint: PointId;
  readonly expectation: Engine2ConfidenceExpectation;
  readonly optionsForGroup?: (groupKey: string) => EndgameConfidenceOptions;
}

export interface Engine2ConfidenceCorpusObservation {
  readonly id: string;
  readonly expected: string;
  readonly actualLabel: string;
  readonly selectedScore: number;
  readonly passed: boolean;
}

export interface Engine2ConfidenceCorpusEvaluation {
  readonly corpusVersion: typeof ENGINE2_CONFIDENCE_CORPUS_VERSION;
  readonly totalCases: number;
  readonly passedCases: number;
  readonly failedCaseIds: readonly string[];
  readonly labelCounts: Readonly<Record<'alive' | 'dead' | 'seki' | 'unresolved', number>>;
  readonly observations: readonly Engine2ConfidenceCorpusObservation[];
}

const makeState = (
  topology: Topology,
  occupied: Readonly<Record<PointId, Exclude<PointOccupancy, 'empty'>>>,
): GameState => {
  const board: Record<PointId, PointOccupancy> = {};
  for (const point of topology.points()) board[point] = occupied[point] ?? 'empty';
  return Object.freeze({
    board: Object.freeze(board),
    currentPlayer: 'black',
    moveNumber: 120,
    consecutivePasses: 2,
    phase: 'endgame',
    captures: Object.freeze({ black: 0, white: 0 }),
  });
};

const makeGraphTopology = (
  id: string,
  adjacency: Readonly<Record<PointId, readonly PointId[]>>,
): Topology => {
  const points = Object.freeze(Object.keys(adjacency).sort());
  return Object.freeze({
    id,
    points: () => points,
    neighbors: (point: PointId) => adjacency[point] ?? Object.freeze([]),
    has: (point: PointId) => Object.prototype.hasOwnProperty.call(adjacency, point),
  });
};

const torusCase = (
  id: string,
  size: 9 | 13 | 19,
  occupied: Readonly<Record<PointId, 'black' | 'white'>>,
  targetPoint: PointId,
  expectation: Engine2ConfidenceExpectation,
  category: Engine2ConfidenceCorpusCase['category'] = 'open-space',
): Engine2ConfidenceCorpusCase => {
  const topology = new TorusTopology(size);
  return Object.freeze({ id, category, topology, state: makeState(topology, occupied), targetPoint, expectation });
};

const cubeCase = (
  id: string,
  size: number,
  occupied: Readonly<Record<PointId, 'black' | 'white'>>,
  targetPoint: PointId,
  expectation: Engine2ConfidenceExpectation,
): Engine2ConfidenceCorpusCase => {
  const topology = new CubeTopology(size);
  return Object.freeze({ id, category: 'topology', topology, state: makeState(topology, occupied), targetPoint, expectation });
};

const customCases = (): readonly Engine2ConfidenceCorpusCase[] => {
  const bensonTopology = makeGraphTopology('e2-12b-benson', {
    w1: Object.freeze(['w2', 'e1']),
    w2: Object.freeze(['w1', 'e2']),
    e1: Object.freeze(['w1']),
    e2: Object.freeze(['w2']),
  });
  const deadTopology = makeGraphTopology('e2-12b-one-lib-dead', {
    w: Object.freeze(['x', 'b']),
    x: Object.freeze(['w', 'b']),
    b: Object.freeze(['w', 'x', 'be']),
    be: Object.freeze(['b']),
  });
  const sekiTopology = makeGraphTopology('e2-12b-seki', {
    black: Object.freeze(['x', 'y']),
    white: Object.freeze(['x', 'y']),
    x: Object.freeze(['black', 'white', 'y']),
    y: Object.freeze(['black', 'white', 'x']),
  });
  const ambiguousTopology = makeGraphTopology('e2-12b-ambiguous', {
    b1: Object.freeze(['x', 'y']),
    b2: Object.freeze(['x', 'z']),
    w1: Object.freeze(['x', 'y', 'z']),
    x: Object.freeze(['b1', 'b2', 'w1']),
    y: Object.freeze(['b1', 'w1']),
    z: Object.freeze(['b2', 'w1']),
  });
  const oneEyeTopology = makeGraphTopology('e2-12b-one-eye-shared', {
    w1: Object.freeze(['w2', 'e1']),
    w2: Object.freeze(['w1', 'e2']),
    e1: Object.freeze(['w1']),
    e2: Object.freeze(['w2', 'b', 'o']),
    o: Object.freeze(['e2']),
    b: Object.freeze(['e2', 'be']),
    be: Object.freeze(['b']),
  });

  const bensonState = makeState(bensonTopology, Object.freeze({ w1: 'white', w2: 'white' }));
  const deadState = makeState(deadTopology, Object.freeze({ w: 'white', b: 'black' }));
  const sekiState = makeState(sekiTopology, Object.freeze({ black: 'black', white: 'white' }));
  const ambiguousState = makeState(
    ambiguousTopology,
    Object.freeze({ b1: 'black', b2: 'black', w1: 'white' }),
  );
  const oneEyeState = makeState(
    oneEyeTopology,
    Object.freeze({ w1: 'white', w2: 'white', b: 'black' }),
  );

  return Object.freeze([
    Object.freeze({
      id: 'benson-two-vital-regions', category: 'eyes', topology: bensonTopology,
      state: bensonState, targetPoint: 'w1',
      expectation: Object.freeze({ expectedLabel: 'alive' as const, minimumConfidence: 1 }),
    }),
    Object.freeze({
      id: 'one-liberty-strict-dead', category: 'enclosure', topology: deadTopology,
      state: deadState, targetPoint: 'w',
      expectation: Object.freeze({ expectedLabel: 'dead' as const, minimumConfidence: 1 }),
    }),
    Object.freeze({
      id: 'strict-seki-black', category: 'seki', topology: sekiTopology,
      state: sekiState, targetPoint: 'black',
      expectation: Object.freeze({ expectedLabel: 'seki' as const, minimumConfidence: 1 }),
    }),
    Object.freeze({
      id: 'strict-seki-white', category: 'seki', topology: sekiTopology,
      state: sekiState, targetPoint: 'white',
      expectation: Object.freeze({ expectedLabel: 'seki' as const, minimumConfidence: 1 }),
    }),
    Object.freeze({
      id: 'ambiguous-three-liberty-contact', category: 'ambiguous', topology: ambiguousTopology,
      state: ambiguousState, targetPoint: 'w1',
      expectation: Object.freeze({ expectedUnresolved: true as const }),
    }),
    Object.freeze({
      id: 'one-eye-plus-shared-space', category: 'eyes', topology: oneEyeTopology,
      state: oneEyeState, targetPoint: 'w1',
      expectation: Object.freeze({ expectedUnresolved: true as const }),
    }),
    Object.freeze({
      id: 'contradictory-provided-proofs', category: 'conflict', topology: ambiguousTopology,
      state: ambiguousState, targetPoint: 'w1',
      expectation: Object.freeze({ expectedUnresolved: true as const }),
      optionsForGroup: (groupKey: string): EndgameConfidenceOptions => Object.freeze({
        providedProofEvidence: Object.freeze([
          Object.freeze({ groupKey, label: 'alive' as const, algorithm: 'corpus-alive-proof' }),
          Object.freeze({ groupKey, label: 'dead' as const, algorithm: 'corpus-dead-proof' }),
        ]),
      }),
    }),
  ]);
};

export const buildEngine2ConfidenceCorpus = (): readonly Engine2ConfidenceCorpusCase[] => Object.freeze([
  torusCase(
    'torus19-two-stone-open-space', 19,
    Object.freeze({ '9,9': 'white', '10,9': 'white', '0,0': 'black', '1,0': 'black' }),
    '9,9', Object.freeze({ expectedLabel: 'alive', minimumConfidence: 0.95 }),
  ),
  torusCase(
    'torus19-isolated-open-space', 19,
    Object.freeze({ '9,9': 'white', '0,0': 'black' }),
    '9,9', Object.freeze({ expectedLabel: 'alive', minimumConfidence: 0.9 }),
  ),
  torusCase(
    'torus13-two-stone-open-space', 13,
    Object.freeze({ '6,6': 'white', '7,6': 'white', '0,0': 'black' }),
    '6,6', Object.freeze({ expectedLabel: 'alive', minimumConfidence: 0.9 }),
  ),
  torusCase(
    'torus9-isolated-open-space', 9,
    Object.freeze({ '4,4': 'white', '0,0': 'black' }),
    '4,4', Object.freeze({ expectedLabel: 'alive', minimumConfidence: 0.9 }),
  ),
  torusCase(
    'torus19-seam-open-space', 19,
    Object.freeze({ '0,9': 'white', '18,9': 'white', '9,0': 'black' }),
    '0,9', Object.freeze({ expectedLabel: 'alive', minimumConfidence: 0.9 }), 'topology',
  ),
  cubeCase(
    'cube5-face-edge-open-space', 5,
    Object.freeze({ 'front:2:4': 'white', 'right:2:0': 'white', 'back:2:2': 'black' }),
    'front:2:4', Object.freeze({ expectedLabel: 'alive', minimumConfidence: 0.9 }),
  ),
  cubeCase(
    'cube7-isolated-open-space', 7,
    Object.freeze({ 'front:3:3': 'white', 'back:3:3': 'black' }),
    'front:3:3', Object.freeze({ expectedLabel: 'alive', minimumConfidence: 0.9 }),
  ),
  torusCase(
    'torus19-expandable-atari', 19,
    Object.freeze({ '9,9': 'white', '8,9': 'black', '10,9': 'black', '9,8': 'black' }),
    '9,9', Object.freeze({ expectedUnresolved: true }), 'atari',
  ),
  torusCase(
    'torus19-narrow-contested-exit', 19,
    Object.freeze({
      '9,9': 'white', '9,10': 'white',
      '8,9': 'black', '10,9': 'black', '9,8': 'black', '10,10': 'black',
      '7,10': 'black', '8,11': 'black',
    }),
    '9,9', Object.freeze({ expectedUnresolved: true }), 'enclosure',
  ),
  ...customCases(),
]);

const selectedScore = (result: EndgameConfidenceResult): number =>
  result.label === 'unresolved' ? Math.max(result.scores.alive, result.scores.dead, result.scores.seki) : result.scores[result.label];

export const evaluateEngine2ConfidenceCorpus = (): Engine2ConfidenceCorpusEvaluation => {
  const observations: Engine2ConfidenceCorpusObservation[] = [];
  const labelCounts = { alive: 0, dead: 0, seki: 0, unresolved: 0 };

  for (const corpusCase of buildEngine2ConfidenceCorpus()) {
    const graph = buildEndgameGraph(corpusCase.state, corpusCase.topology);
    const groupKey = graph.pointOwner.get(corpusCase.targetPoint);
    if (!groupKey) throw new Error(`Confidence corpus target is not a stone: ${corpusCase.id}`);
    const result = classifyGroupConfidence(
      corpusCase.state,
      corpusCase.topology,
      groupKey,
      corpusCase.optionsForGroup?.(groupKey) ?? Object.freeze({}),
    );
    if (!result) throw new Error(`Confidence corpus group missing: ${corpusCase.id}`);
    labelCounts[result.label] += 1;

    let expected: string;
    let passed: boolean;
    if ('expectedUnresolved' in corpusCase.expectation) {
      expected = 'unresolved';
      passed = result.label === 'unresolved';
    } else {
      expected = `${corpusCase.expectation.expectedLabel}>=${corpusCase.expectation.minimumConfidence}`;
      passed =
        result.label === corpusCase.expectation.expectedLabel &&
        result.scores[corpusCase.expectation.expectedLabel] >= corpusCase.expectation.minimumConfidence;
    }
    observations.push(Object.freeze({
      id: corpusCase.id,
      expected,
      actualLabel: result.label,
      selectedScore: selectedScore(result),
      passed,
    }));
  }

  const failedCaseIds = Object.freeze(observations.filter((item) => !item.passed).map((item) => item.id));
  return Object.freeze({
    corpusVersion: ENGINE2_CONFIDENCE_CORPUS_VERSION,
    totalCases: observations.length,
    passedCases: observations.length - failedCaseIds.length,
    failedCaseIds,
    labelCounts: Object.freeze(labelCounts),
    observations: Object.freeze(observations),
  });
};
