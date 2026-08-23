import type { GameState, PointOccupancy } from '../../game/types';
import { CubeTopology } from '../../topology/CubeTopology';
import type { PointId, Topology } from '../../topology/Topology';
import { TorusTopology } from '../../topology/TorusTopology';
import {
  searchDeterministicAndOrProof,
  type DeterministicProofSearchAdapter,
  type ProofSearchExpansion,
  type ProofSearchMoveSetCompleteness,
  type ProofSearchRole,
  type ProofSearchTerminal,
} from '../DeterministicAndOrProofSearch';
import { buildEndgameGraph } from '../EndgameGraphCore';
import { endgameGroupId } from '../EndgameGroupIdentity';
import { createEndgameProofSearchNode } from '../EndgameProofSearchGoAdapter';
import { createFourLibertyProofSearchGoAdapter } from '../FourLibertyProofSearchGoAdapter';
import { readOneLibertyTactics } from '../OneLibertyTacticalReader';
import { analyzeSemeaiSeki } from '../SemeaiSekiProof';
import { analyzeSmallEyeSpace } from '../SmallEyeSpaceAnalyzer';
import {
  analyzeTacticalExtensionMoves,
  createTacticalExtensionProofSearchGoAdapter,
} from '../TacticalExtensionProofSearchGoAdapter';
import { createThreeLibertyProofSearchGoAdapter } from '../ThreeLibertyProofSearchGoAdapter';
import { readTwoLibertyTacticsPruned } from '../TwoLibertyPrunedTacticalReader';
import { readTwoLibertyTactics } from '../TwoLibertyTacticalReader';

export const ENGINE2_ADVERSARIAL_CORPUS_VERSION = 'engine2-adversarial-corpus-v1';

export type Engine2AdversarialCategory =
  | 'one-liberty'
  | 'two-liberty'
  | 'three-liberty'
  | 'four-liberty'
  | 'eye-space'
  | 'tactical-extension'
  | 'semeai-seki'
  | 'topology'
  | 'and-or-core';

export interface Engine2AdversarialObservation {
  readonly id: string;
  readonly category: Engine2AdversarialCategory;
  readonly expected: string;
  readonly actual: string;
  readonly mustNotProve: boolean;
  readonly exploredNodes: number;
  readonly transpositionHits: number;
}

export interface Engine2AdversarialEvaluation {
  readonly corpusVersion: typeof ENGINE2_ADVERSARIAL_CORPUS_VERSION;
  readonly observations: readonly Engine2AdversarialObservation[];
  readonly totalCases: number;
  readonly passedCases: number;
  readonly failedCaseIds: readonly string[];
  readonly authoritativePositiveCases: number;
  readonly failClosedCases: number;
  readonly falseAuthoritativeConclusions: number;
  readonly totalExploredNodes: number;
  readonly transpositionHits: number;
}

const makeTopology = (
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

const makeState = (
  topology: Topology,
  occupied: Readonly<Record<PointId, Exclude<PointOccupancy, 'empty'>>>,
  currentPlayer: 'black' | 'white' = 'black',
): GameState => {
  const board: Record<PointId, PointOccupancy> = {};
  for (const point of topology.points()) board[point] = occupied[point] ?? 'empty';
  return Object.freeze({
    board: Object.freeze(board),
    currentPlayer,
    moveNumber: 100,
    consecutivePasses: 2,
    phase: 'endgame',
    captures: Object.freeze({ black: 0, white: 0 }),
  });
};

const makeFilledState = (
  topology: Topology,
  emptyPoints: readonly PointId[],
): GameState => {
  const empty = new Set(emptyPoints);
  const board: Record<PointId, PointOccupancy> = {};
  for (const point of topology.points()) board[point] = empty.has(point) ? 'empty' : 'black';
  return Object.freeze({
    board: Object.freeze(board),
    currentPlayer: 'black',
    moveNumber: 100,
    consecutivePasses: 2,
    phase: 'endgame',
    captures: Object.freeze({ black: 0, white: 0 }),
  });
};

const observation = (
  id: string,
  category: Engine2AdversarialCategory,
  expected: string,
  actual: string,
  options: Readonly<{
    mustNotProve?: boolean;
    exploredNodes?: number;
    transpositionHits?: number;
  }> = Object.freeze({}),
): Engine2AdversarialObservation =>
  Object.freeze({
    id,
    category,
    expected,
    actual,
    mustNotProve: options.mustNotProve ?? false,
    exploredNodes: options.exploredNodes ?? 0,
    transpositionHits: options.transpositionHits ?? 0,
  });

const groupKeyAt = (
  state: GameState,
  topology: Topology,
  point: PointId,
): string => buildEndgameGraph(state, topology).pointOwner.get(point) ?? 'missing-group';

const semeaiPairKeys = (
  state: GameState,
  topology: Topology,
  left: PointId,
  right: PointId,
): readonly [string, string] => {
  const graph = buildEndgameGraph(state, topology);
  return Object.freeze([
    graph.pointOwner.get(left) ?? 'missing-left-group',
    graph.pointOwner.get(right) ?? 'missing-right-group',
  ]);
};

const oneLibertyDeadCase = (): Engine2AdversarialObservation => {
  const topology = makeTopology('e2-11-one-lib-dead', {
    w: Object.freeze(['x', 'b']),
    x: Object.freeze(['w', 'b']),
    b: Object.freeze(['w', 'x', 'be']),
    be: Object.freeze(['b']),
  });
  const state = makeState(topology, Object.freeze({ w: 'white', b: 'black' }));
  const result = readOneLibertyTactics(
    state,
    topology,
    buildEndgameGraph(state, topology),
    endgameGroupId(['w']),
  );
  return observation(
    'one-liberty-forced-dead',
    'one-liberty',
    'proven-dead',
    result?.outcome ?? 'missing',
    { exploredNodes: result?.exploredNodes ?? 0 },
  );
};

const oneLibertyKoCase = (): Engine2AdversarialObservation => {
  const topology = makeTopology('e2-11-one-lib-ko', {
    w: Object.freeze(['x', 'b1', 'b2']),
    x: Object.freeze(['w', 'c1', 'c2']),
    b1: Object.freeze(['w', 'b1e']),
    b1e: Object.freeze(['b1']),
    b2: Object.freeze(['w', 'b2e']),
    b2e: Object.freeze(['b2']),
    c1: Object.freeze(['x', 'c1e']),
    c1e: Object.freeze(['c1']),
    c2: Object.freeze(['x', 'c2e']),
    c2e: Object.freeze(['c2']),
  });
  const state = makeState(
    topology,
    Object.freeze({
      w: 'white',
      c1: 'white',
      c2: 'white',
      b1: 'black',
      b2: 'black',
    }),
  );
  const result = readOneLibertyTactics(
    state,
    topology,
    buildEndgameGraph(state, topology),
    endgameGroupId(['w']),
  );
  return observation(
    'one-liberty-unknown-root-ko',
    'one-liberty',
    'ko-dependent',
    result?.outcome ?? 'missing',
    { mustNotProve: true, exploredNodes: result?.exploredNodes ?? 0 },
  );
};

const twoLibertyOracleCase = (): Engine2AdversarialObservation => {
  const topology = makeTopology('e2-11-two-lib-oracle', {
    w: Object.freeze(['a', 'b']),
    a: Object.freeze(['w', 'q']),
    b: Object.freeze(['w', 'q']),
    q: Object.freeze(['a', 'b', 'q1', 'q2']),
    q1: Object.freeze(['q']),
    q2: Object.freeze(['q']),
    r: Object.freeze(['x', 'y']),
    x: Object.freeze(['r']),
    y: Object.freeze(['r']),
  });
  const state = makeState(
    topology,
    Object.freeze({ w: 'white', q: 'black', r: 'white' }),
  );
  const graph = buildEndgameGraph(state, topology);
  const target = endgameGroupId(['w']);
  const exhaustive = readTwoLibertyTactics(state, topology, graph, target);
  const pruned = readTwoLibertyTacticsPruned(state, topology, graph, target);
  const actual = `${exhaustive?.outcome ?? 'missing'}/${pruned?.outcome ?? 'missing'}`;
  return observation(
    'two-liberty-pruned-matches-exhaustive-proof',
    'two-liberty',
    'proven-dead/proven-dead',
    actual,
    { exploredNodes: pruned?.exploredNodes ?? 0 },
  );
};

const twoLibertyRemoteKoCase = (): Engine2AdversarialObservation => {
  const topology = makeTopology('e2-11-two-lib-remote-ko', {
    w: Object.freeze(['a', 'b']),
    a: Object.freeze(['w', 'q']),
    b: Object.freeze(['w', 'q']),
    q: Object.freeze(['a', 'b', 'q1', 'q2']),
    q1: Object.freeze(['q']),
    q2: Object.freeze(['q']),
    k: Object.freeze(['c']),
    c: Object.freeze(['k']),
  });
  const state = makeState(
    topology,
    Object.freeze({ w: 'white', q: 'black', k: 'black' }),
  );
  const graph = buildEndgameGraph(state, topology);
  const target = endgameGroupId(['w']);
  const exhaustive = readTwoLibertyTactics(state, topology, graph, target);
  const pruned = readTwoLibertyTacticsPruned(state, topology, graph, target);
  const actual = `${exhaustive?.outcome ?? 'missing'}/${pruned?.outcome ?? 'missing'}`;
  return observation(
    'two-liberty-remote-root-ko',
    'two-liberty',
    'ko-dependent/ko-dependent',
    actual,
    { mustNotProve: true, exploredNodes: pruned?.exploredNodes ?? 0 },
  );
};

const threeLibertyKillCase = (): Engine2AdversarialObservation => {
  const topology = makeTopology('e2-11-three-lib-kill', {
    w: Object.freeze(['a', 'b', 'c']),
    q: Object.freeze(['a', 'b', 'c', 'q1', 'q2']),
    a: Object.freeze(['q', 'w']),
    b: Object.freeze(['q', 'w']),
    c: Object.freeze(['q', 'w']),
    q1: Object.freeze(['q']),
    q2: Object.freeze(['q']),
  });
  const state = makeState(topology, Object.freeze({ w: 'white', q: 'black' }));
  const node = createEndgameProofSearchNode(
    topology,
    state,
    'white',
    Object.freeze(['w']),
    'attacker',
  );
  const result = searchDeterministicAndOrProof(
    node,
    createThreeLibertyProofSearchGoAdapter(topology),
  );
  return observation(
    'three-liberty-positive-kill',
    'three-liberty',
    'proven-kill',
    result.outcome,
    { exploredNodes: result.exploredNodes, transpositionHits: result.transpositionHits },
  );
};

const threeLibertyIncompleteCase = (): Engine2AdversarialObservation => {
  const topology = makeTopology('e2-11-three-lib-incomplete', {
    w: Object.freeze(['a', 'b', 'c']),
    a: Object.freeze(['w']),
    b: Object.freeze(['w']),
    c: Object.freeze(['w']),
  });
  const state = makeState(topology, Object.freeze({ w: 'white' }));
  const node = createEndgameProofSearchNode(
    topology,
    state,
    'white',
    Object.freeze(['w']),
    'attacker',
  );
  const result = searchDeterministicAndOrProof(
    node,
    createThreeLibertyProofSearchGoAdapter(topology),
  );
  return observation(
    'three-liberty-incomplete-attack-boundary',
    'three-liberty',
    'unresolved',
    result.outcome,
    {
      mustNotProve: true,
      exploredNodes: result.exploredNodes,
      transpositionHits: result.transpositionHits,
    },
  );
};

const fourLibertyKillCase = (): Engine2AdversarialObservation => {
  const topology = makeTopology('e2-11-four-lib-kill', {
    w: Object.freeze(['a', 'b', 'c', 'd']),
    q: Object.freeze(['a', 'b', 'c', 'd', 'q1', 'q2']),
    a: Object.freeze(['q', 'w']),
    b: Object.freeze(['q', 'w']),
    c: Object.freeze(['q', 'w']),
    d: Object.freeze(['q', 'w']),
    q1: Object.freeze(['q']),
    q2: Object.freeze(['q']),
  });
  const state = makeState(topology, Object.freeze({ w: 'white', q: 'black' }));
  const node = createEndgameProofSearchNode(
    topology,
    state,
    'white',
    Object.freeze(['w']),
    'attacker',
  );
  const result = searchDeterministicAndOrProof(
    node,
    createFourLibertyProofSearchGoAdapter(topology),
  );
  return observation(
    'four-liberty-positive-kill',
    'four-liberty',
    'proven-kill',
    result.outcome,
    { exploredNodes: result.exploredNodes, transpositionHits: result.transpositionHits },
  );
};

const eyeSpaceExactCase = (): Engine2AdversarialObservation => {
  const topology = makeTopology('e2-11-eye-exact', {
    b1: Object.freeze(['b2', 'e1', 'e2']),
    b2: Object.freeze(['b1', 'e1', 'e2']),
    e1: Object.freeze(['b1', 'b2']),
    e2: Object.freeze(['b1', 'b2']),
  });
  const state = makeState(topology, Object.freeze({ b1: 'black', b2: 'black' }));
  const result = analyzeSmallEyeSpace(state, topology, groupKeyAt(state, topology, 'b1'));
  const actual = result
    ? `complete=${String(result.complete)};eyes=${result.minEyes}-${result.maxEyes}`
    : 'missing';
  return observation(
    'small-eye-exact-two-eyes',
    'eye-space',
    'complete=true;eyes=2-2',
    actual,
  );
};

const eyeSpaceBudgetCase = (): Engine2AdversarialObservation => {
  const topology = makeTopology('e2-11-eye-budget', {
    t: Object.freeze(['a', 'b', 'c']),
    a: Object.freeze(['t', 'b']),
    b: Object.freeze(['t', 'a', 'c']),
    c: Object.freeze(['t', 'b']),
  });
  const state = makeState(topology, Object.freeze({ t: 'black' }));
  const result = analyzeSmallEyeSpace(
    state,
    topology,
    groupKeyAt(state, topology, 't'),
    { nodeBudget: 1 },
  );
  const actual = result
    ? `complete=${String(result.complete)};budget=${String(
        result.unresolvedReasons.includes('node-budget-exhausted'),
      )}`
    : 'missing';
  return observation(
    'small-eye-budget-fail-closed',
    'eye-space',
    'complete=false;budget=true',
    actual,
    { mustNotProve: true },
  );
};

const tacticalConnectionSurvivalCase = (): Engine2AdversarialObservation => {
  const topology = makeTopology('e2-11-tactical-connection', {
    a: Object.freeze(['x']),
    x: Object.freeze(['a', 'b']),
    b: Object.freeze(['x', 'e1', 'e2']),
    e1: Object.freeze(['b']),
    e2: Object.freeze(['b']),
  });
  const state = makeState(topology, Object.freeze({ a: 'black', b: 'black' }));
  const node = createEndgameProofSearchNode(
    topology,
    state,
    'black',
    Object.freeze(['a']),
    'defender',
  );
  const result = searchDeterministicAndOrProof(
    node,
    createTacticalExtensionProofSearchGoAdapter(topology),
  );
  return observation(
    'tactical-connection-to-pass-alive',
    'tactical-extension',
    'proven-survival',
    result.outcome,
    { exploredNodes: result.exploredNodes, transpositionHits: result.transpositionHits },
  );
};

const semeaiKillCase = (): Engine2AdversarialObservation => {
  const topology = makeTopology('e2-11-semeai-kill', {
    b: Object.freeze(['x', 'be']),
    be: Object.freeze(['b']),
    w: Object.freeze(['x']),
    x: Object.freeze(['b', 'w']),
  });
  const state = makeState(topology, Object.freeze({ b: 'black', w: 'white' }), 'black');
  const [blackKey, whiteKey] = semeaiPairKeys(state, topology, 'b', 'w');
  const analysis = analyzeSemeaiSeki(state, topology, blackKey, whiteKey);
  const proof = analysis?.killProofs.find((candidate) => candidate.targetColor === 'white');
  return observation(
    'semeai-side-to-move-kill',
    'semeai-seki',
    'proven-kill',
    proof?.result.outcome ?? 'missing',
    {
      exploredNodes: proof?.result.exploredNodes ?? 0,
      transpositionHits: proof?.result.transpositionHits ?? 0,
    },
  );
};

const sekiCertificateCase = (): Engine2AdversarialObservation => {
  const topology = makeTopology('e2-11-seki-positive', {
    b: Object.freeze(['w', 'x', 'y']),
    w: Object.freeze(['b', 'x', 'y']),
    x: Object.freeze(['b', 'w', 'y']),
    y: Object.freeze(['b', 'w', 'x']),
  });
  const state = makeState(topology, Object.freeze({ b: 'black', w: 'white' }));
  const [blackKey, whiteKey] = semeaiPairKeys(state, topology, 'b', 'w');
  const analysis = analyzeSemeaiSeki(state, topology, blackKey, whiteKey, {
    includeKillProofs: false,
  });
  return observation(
    'closed-mutual-capture-seki-certificate',
    'semeai-seki',
    'proven-seki',
    analysis?.seki.status ?? 'missing',
  );
};

const sekiThirdGroupCase = (): Engine2AdversarialObservation => {
  const topology = makeTopology('e2-11-seki-third-group', {
    b: Object.freeze(['w', 'x', 'y']),
    w: Object.freeze(['b', 'x', 'y']),
    x: Object.freeze(['b', 'w', 'y', 't']),
    y: Object.freeze(['b', 'w', 'x']),
    t: Object.freeze(['x', 'te']),
    te: Object.freeze(['t']),
  });
  const state = makeState(
    topology,
    Object.freeze({ b: 'black', w: 'white', t: 'black' }),
  );
  const [blackKey, whiteKey] = semeaiPairKeys(state, topology, 'b', 'w');
  const analysis = analyzeSemeaiSeki(state, topology, blackKey, whiteKey, {
    includeKillProofs: false,
  });
  const actual =
    analysis?.seki.status === 'unresolved'
      ? `unresolved:${analysis.seki.reason}`
      : analysis?.seki.status ?? 'missing';
  return observation(
    'seki-third-group-boundary',
    'semeai-seki',
    'unresolved:third-group-boundary',
    actual,
    { mustNotProve: true },
  );
};

const torusSeamEyeCase = (): Engine2AdversarialObservation => {
  const topology = new TorusTopology(9);
  const state = makeFilledState(topology, ['0,0', '8,0', '4,4']);
  const result = analyzeSmallEyeSpace(
    state,
    topology,
    groupKeyAt(state, topology, '1,0'),
  );
  const seam = result?.regions.find((region) => region.points.includes('0,0'));
  const actual = seam
    ? `${seam.boundary};complete=${String(seam.complete)};points=${seam.points.join(',')}`
    : 'missing';
  return observation(
    'torus-seam-graph-native-eye-space',
    'topology',
    'strict-target-boundary;complete=true;points=0,0,8,0',
    actual,
  );
};

const cubeEdgeConnectionCase = (): Engine2AdversarialObservation => {
  const topology = new CubeTopology(2);
  const state = makeState(
    topology,
    Object.freeze({ 'front:0:0': 'black', 'right:0:0': 'black' }),
  );
  const node = createEndgameProofSearchNode(
    topology,
    state,
    'black',
    Object.freeze(['front:0:0']),
    'defender',
  );
  const candidate = analyzeTacticalExtensionMoves(node, topology).candidates.find(
    (entry) => entry.point === 'front:0:1',
  );
  const actual = candidate?.reasons.includes('connection') ? 'connection' : 'missing';
  return observation(
    'cube-face-edge-graph-native-connection',
    'topology',
    'connection',
    actual,
  );
};

interface ToyNode {
  readonly key: string;
  readonly role: ProofSearchRole;
  readonly terminal?: ProofSearchTerminal;
  readonly completeness?: ProofSearchMoveSetCompleteness;
  readonly moves?: readonly ToyMove[];
}

interface ToyMove {
  readonly key: string;
  readonly child: ToyNode;
}

const toyAdapter: DeterministicProofSearchAdapter<ToyNode, ToyMove> = Object.freeze({
  nodeKey: (node) => node.key,
  role: (node) => node.role,
  terminal: (node) => node.terminal ?? null,
  expand: (node): ProofSearchExpansion<ToyMove> =>
    Object.freeze({
      moves: node.moves ?? Object.freeze([]),
      completeness: node.completeness ?? Object.freeze({ kind: 'complete' as const }),
    }),
  apply: (_node, move) => move.child,
  moveKey: (move) => move.key,
});

const toyTerminal = (
  key: string,
  outcome: ProofSearchTerminal['outcome'],
): ToyNode => Object.freeze({ key, role: 'attacker', terminal: Object.freeze({ outcome }) });

const toyMove = (key: string, child: ToyNode): ToyMove => Object.freeze({ key, child });

const transpositionParityCase = (): Engine2AdversarialObservation => {
  const leaf = toyTerminal('leaf', 'proven-survival');
  const shared: ToyNode = Object.freeze({
    key: 'shared',
    role: 'attacker',
    moves: Object.freeze([toyMove('finish', leaf)]),
  });
  const root: ToyNode = Object.freeze({
    key: 'root',
    role: 'attacker',
    moves: Object.freeze([toyMove('b-route', shared), toyMove('a-route', shared)]),
  });
  const optimized = searchDeterministicAndOrProof(root, toyAdapter);
  const baseline = searchDeterministicAndOrProof(
    root,
    toyAdapter,
    Object.freeze({ useTranspositions: false }),
  );
  const sameSemantics =
    optimized.outcome === baseline.outcome &&
    optimized.reason === baseline.reason &&
    JSON.stringify(optimized.principalVariation) === JSON.stringify(baseline.principalVariation) &&
    optimized.maxDepth === baseline.maxDepth;
  const actual =
    sameSemantics &&
    optimized.exploredNodes < baseline.exploredNodes &&
    optimized.transpositionHits > 0
      ? 'semantic-parity-with-reuse'
      : 'mismatch';
  return observation(
    'transposition-semantic-parity',
    'and-or-core',
    'semantic-parity-with-reuse',
    actual,
    {
      exploredNodes: optimized.exploredNodes,
      transpositionHits: optimized.transpositionHits,
    },
  );
};

const incompleteDefenderCase = (): Engine2AdversarialObservation => {
  const dead = toyTerminal('dead', 'proven-kill');
  const root: ToyNode = Object.freeze({
    key: 'incomplete-defender-root',
    role: 'defender',
    moves: Object.freeze([toyMove('known-defense', dead)]),
    completeness: Object.freeze({ kind: 'incomplete', reason: 'remote defenses unknown' }),
  });
  const result = searchDeterministicAndOrProof(root, toyAdapter);
  return observation(
    'and-or-incomplete-defender-universal-proof-blocked',
    'and-or-core',
    'unresolved',
    result.outcome,
    {
      mustNotProve: true,
      exploredNodes: result.exploredNodes,
      transpositionHits: result.transpositionHits,
    },
  );
};

const budgetExhaustionCase = (): Engine2AdversarialObservation => {
  const root: ToyNode = Object.freeze({
    key: 'budget-root',
    role: 'attacker',
    moves: Object.freeze([
      toyMove('a-live', toyTerminal('live', 'proven-survival')),
      toyMove('z-kill', toyTerminal('kill', 'proven-kill')),
    ]),
  });
  const result = searchDeterministicAndOrProof(
    root,
    toyAdapter,
    Object.freeze({ nodeBudget: 2 }),
  );
  return observation(
    'and-or-budget-exhaustion-propagates',
    'and-or-core',
    'budget-exhausted',
    result.outcome,
    {
      mustNotProve: true,
      exploredNodes: result.exploredNodes,
      transpositionHits: result.transpositionHits,
    },
  );
};

const isAuthoritativeFate = (actual: string): boolean =>
  actual === 'proven-dead' ||
  actual === 'proven-kill' ||
  actual === 'proven-survival' ||
  actual === 'proven-seki' ||
  actual === 'proven-dead/proven-dead';

export const runEngine2AdversarialCorpus = (): Engine2AdversarialEvaluation => {
  const observations = Object.freeze([
    oneLibertyDeadCase(),
    oneLibertyKoCase(),
    twoLibertyOracleCase(),
    twoLibertyRemoteKoCase(),
    threeLibertyKillCase(),
    threeLibertyIncompleteCase(),
    fourLibertyKillCase(),
    eyeSpaceExactCase(),
    eyeSpaceBudgetCase(),
    tacticalConnectionSurvivalCase(),
    semeaiKillCase(),
    sekiCertificateCase(),
    sekiThirdGroupCase(),
    torusSeamEyeCase(),
    cubeEdgeConnectionCase(),
    transpositionParityCase(),
    incompleteDefenderCase(),
    budgetExhaustionCase(),
  ]);
  const failedCaseIds = Object.freeze(
    observations.filter((entry) => entry.actual !== entry.expected).map((entry) => entry.id),
  );
  return Object.freeze({
    corpusVersion: ENGINE2_ADVERSARIAL_CORPUS_VERSION,
    observations,
    totalCases: observations.length,
    passedCases: observations.length - failedCaseIds.length,
    failedCaseIds,
    authoritativePositiveCases: observations.filter(
      (entry) => !entry.mustNotProve && isAuthoritativeFate(entry.actual),
    ).length,
    failClosedCases: observations.filter((entry) => entry.mustNotProve).length,
    falseAuthoritativeConclusions: observations.filter(
      (entry) => entry.mustNotProve && isAuthoritativeFate(entry.actual),
    ).length,
    totalExploredNodes: observations.reduce((sum, entry) => sum + entry.exploredNodes, 0),
    transpositionHits: observations.reduce((sum, entry) => sum + entry.transpositionHits, 0),
  });
};
