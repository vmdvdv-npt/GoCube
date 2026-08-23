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

const observe = (
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

const groupKeyAt = (state: GameState, topology: Topology, point: PointId): string =>
  buildEndgameGraph(state, topology).pointOwner.get(point) ?? 'missing-group';

const pairKeys = (
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

const oneLibertyCases = (): readonly Engine2AdversarialObservation[] => {
  const deadTopology = makeTopology('e2-11-one-lib-dead', {
    w: Object.freeze(['x', 'b']),
    x: Object.freeze(['w', 'b']),
    b: Object.freeze(['w', 'x', 'be']),
    be: Object.freeze(['b']),
  });
  const deadState = makeState(deadTopology, Object.freeze({ w: 'white', b: 'black' }));
  const dead = readOneLibertyTactics(
    deadState,
    deadTopology,
    buildEndgameGraph(deadState, deadTopology),
    endgameGroupId(['w']),
  );

  const koTopology = makeTopology('e2-11-one-lib-ko', {
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
  const koState = makeState(
    koTopology,
    Object.freeze({ w: 'white', c1: 'white', c2: 'white', b1: 'black', b2: 'black' }),
  );
  const ko = readOneLibertyTactics(
    koState,
    koTopology,
    buildEndgameGraph(koState, koTopology),
    endgameGroupId(['w']),
  );

  return Object.freeze([
    observe('one-liberty-forced-dead', 'one-liberty', 'proven-dead', dead?.outcome ?? 'missing', {
      exploredNodes: dead?.exploredNodes ?? 0,
    }),
    observe('one-liberty-unknown-root-ko', 'one-liberty', 'ko-dependent', ko?.outcome ?? 'missing', {
      mustNotProve: true,
      exploredNodes: ko?.exploredNodes ?? 0,
    }),
  ]);
};

const twoLibertyCases = (): readonly Engine2AdversarialObservation[] => {
  const proofTopology = makeTopology('e2-11-two-lib-proof', {
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
  const proofState = makeState(
    proofTopology,
    Object.freeze({ w: 'white', q: 'black', r: 'white' }),
  );
  const proofGraph = buildEndgameGraph(proofState, proofTopology);
  const proofTarget = endgameGroupId(['w']);
  const exhaustive = readTwoLibertyTactics(proofState, proofTopology, proofGraph, proofTarget);
  const pruned = readTwoLibertyTacticsPruned(proofState, proofTopology, proofGraph, proofTarget);

  const koTopology = makeTopology('e2-11-two-lib-ko', {
    w: Object.freeze(['a', 'b']),
    a: Object.freeze(['w', 'q']),
    b: Object.freeze(['w', 'q']),
    q: Object.freeze(['a', 'b', 'q1', 'q2']),
    q1: Object.freeze(['q']),
    q2: Object.freeze(['q']),
    k: Object.freeze(['c']),
    c: Object.freeze(['k']),
  });
  const koState = makeState(
    koTopology,
    Object.freeze({ w: 'white', q: 'black', k: 'black' }),
  );
  const koGraph = buildEndgameGraph(koState, koTopology);
  const koTarget = endgameGroupId(['w']);
  const koExhaustive = readTwoLibertyTactics(koState, koTopology, koGraph, koTarget);
  const koPruned = readTwoLibertyTacticsPruned(koState, koTopology, koGraph, koTarget);

  return Object.freeze([
    observe(
      'two-liberty-pruned-matches-exhaustive-proof',
      'two-liberty',
      'proven-dead/proven-dead',
      `${exhaustive?.outcome ?? 'missing'}/${pruned?.outcome ?? 'missing'}`,
      { exploredNodes: pruned?.exploredNodes ?? 0 },
    ),
    observe(
      'two-liberty-remote-root-ko',
      'two-liberty',
      'ko-dependent/ko-dependent',
      `${koExhaustive?.outcome ?? 'missing'}/${koPruned?.outcome ?? 'missing'}`,
      { mustNotProve: true, exploredNodes: koPruned?.exploredNodes ?? 0 },
    ),
  ]);
};

const threeAndFourLibertyCases = (): readonly Engine2AdversarialObservation[] => {
  const threeTopology = makeTopology('e2-11-three-lib-kill', {
    w: Object.freeze(['a', 'b', 'c']),
    q: Object.freeze(['a', 'b', 'c', 'q1', 'q2']),
    a: Object.freeze(['q', 'w']),
    b: Object.freeze(['q', 'w']),
    c: Object.freeze(['q', 'w']),
    q1: Object.freeze(['q']),
    q2: Object.freeze(['q']),
  });
  const threeState = makeState(threeTopology, Object.freeze({ w: 'white', q: 'black' }));
  const threeNode = createEndgameProofSearchNode(
    threeTopology,
    threeState,
    'white',
    Object.freeze(['w']),
    'attacker',
  );
  const three = searchDeterministicAndOrProof(
    threeNode,
    createThreeLibertyProofSearchGoAdapter(threeTopology),
  );

  const incompleteTopology = makeTopology('e2-11-three-lib-incomplete', {
    w: Object.freeze(['a', 'b', 'c']),
    a: Object.freeze(['w']),
    b: Object.freeze(['w']),
    c: Object.freeze(['w']),
  });
  const incompleteState = makeState(incompleteTopology, Object.freeze({ w: 'white' }));
  const incompleteNode = createEndgameProofSearchNode(
    incompleteTopology,
    incompleteState,
    'white',
    Object.freeze(['w']),
    'attacker',
  );
  const incomplete = searchDeterministicAndOrProof(
    incompleteNode,
    createThreeLibertyProofSearchGoAdapter(incompleteTopology),
  );

  const fourTopology = makeTopology('e2-11-four-lib-kill', {
    w: Object.freeze(['a', 'b', 'c', 'd']),
    q: Object.freeze(['a', 'b', 'c', 'd', 'q1', 'q2']),
    a: Object.freeze(['q', 'w']),
    b: Object.freeze(['q', 'w']),
    c: Object.freeze(['q', 'w']),
    d: Object.freeze(['q', 'w']),
    q1: Object.freeze(['q']),
    q2: Object.freeze(['q']),
  });
  const fourState = makeState(fourTopology, Object.freeze({ w: 'white', q: 'black' }));
  const fourNode = createEndgameProofSearchNode(
    fourTopology,
    fourState,
    'white',
    Object.freeze(['w']),
    'attacker',
  );
  const four = searchDeterministicAndOrProof(
    fourNode,
    createFourLibertyProofSearchGoAdapter(fourTopology),
  );

  return Object.freeze([
    observe('three-liberty-positive-kill', 'three-liberty', 'proven-kill', three.outcome, {
      exploredNodes: three.exploredNodes,
      transpositionHits: three.transpositionHits,
    }),
    observe(
      'three-liberty-incomplete-attack-boundary',
      'three-liberty',
      'unresolved',
      incomplete.outcome,
      {
        mustNotProve: true,
        exploredNodes: incomplete.exploredNodes,
        transpositionHits: incomplete.transpositionHits,
      },
    ),
    observe('four-liberty-positive-kill', 'four-liberty', 'proven-kill', four.outcome, {
      exploredNodes: four.exploredNodes,
      transpositionHits: four.transpositionHits,
    }),
  ]);
};

const eyeSpaceCases = (): readonly Engine2AdversarialObservation[] => {
  const exactTopology = makeTopology('e2-11-eye-exact', {
    b1: Object.freeze(['b2', 'e1', 'e2']),
    b2: Object.freeze(['b1', 'e1', 'e2']),
    e1: Object.freeze(['b1', 'b2']),
    e2: Object.freeze(['b1', 'b2']),
  });
  const exactState = makeState(exactTopology, Object.freeze({ b1: 'black', b2: 'black' }));
  const exact = analyzeSmallEyeSpace(
    exactState,
    exactTopology,
    groupKeyAt(exactState, exactTopology, 'b1'),
  );

  const budgetTopology = makeTopology('e2-11-eye-budget', {
    t: Object.freeze(['a', 'b', 'c']),
    a: Object.freeze(['t', 'b']),
    b: Object.freeze(['t', 'a', 'c']),
    c: Object.freeze(['t', 'b']),
  });
  const budgetState = makeState(budgetTopology, Object.freeze({ t: 'black' }));
  const budget = analyzeSmallEyeSpace(
    budgetState,
    budgetTopology,
    groupKeyAt(budgetState, budgetTopology, 't'),
    { nodeBudget: 1 },
  );

  return Object.freeze([
    observe(
      'small-eye-exact-two-eyes',
      'eye-space',
      'complete=true;eyes=2-2',
      exact ? `complete=${String(exact.complete)};eyes=${exact.minEyes}-${exact.maxEyes}` : 'missing',
    ),
    observe(
      'small-eye-budget-fail-closed',
      'eye-space',
      'complete=false;budget=true',
      budget
        ? `complete=${String(budget.complete)};budget=${String(
            budget.unresolvedReasons.includes('node-budget-exhausted'),
          )}`
        : 'missing',
      { mustNotProve: true },
    ),
  ]);
};

const tacticalCase = (): Engine2AdversarialObservation => {
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
  return observe(
    'tactical-connection-to-pass-alive',
    'tactical-extension',
    'proven-survival',
    result.outcome,
    { exploredNodes: result.exploredNodes, transpositionHits: result.transpositionHits },
  );
};

const semeaiSekiCases = (): readonly Engine2AdversarialObservation[] => {
  const killTopology = makeTopology('e2-11-semeai-kill', {
    b: Object.freeze(['x', 'be']),
    be: Object.freeze(['b']),
    w: Object.freeze(['x']),
    x: Object.freeze(['b', 'w']),
  });
  const killState = makeState(killTopology, Object.freeze({ b: 'black', w: 'white' }), 'black');
  const [killBlack, killWhite] = pairKeys(killState, killTopology, 'b', 'w');
  const killAnalysis = analyzeSemeaiSeki(killState, killTopology, killBlack, killWhite);
  const whiteKill = killAnalysis?.killProofs.find((entry) => entry.targetColor === 'white');

  const sekiTopology = makeTopology('e2-11-seki-positive', {
    b: Object.freeze(['w', 'x', 'y']),
    w: Object.freeze(['b', 'x', 'y']),
    x: Object.freeze(['b', 'w', 'y']),
    y: Object.freeze(['b', 'w', 'x']),
  });
  const sekiState = makeState(sekiTopology, Object.freeze({ b: 'black', w: 'white' }));
  const [sekiBlack, sekiWhite] = pairKeys(sekiState, sekiTopology, 'b', 'w');
  const seki = analyzeSemeaiSeki(sekiState, sekiTopology, sekiBlack, sekiWhite, {
    includeKillProofs: false,
  });

  const thirdTopology = makeTopology('e2-11-seki-third-group', {
    b: Object.freeze(['w', 'x', 'y']),
    w: Object.freeze(['b', 'x', 'y']),
    x: Object.freeze(['b', 'w', 'y', 't']),
    y: Object.freeze(['b', 'w', 'x']),
    t: Object.freeze(['x', 'te']),
    te: Object.freeze(['t']),
  });
  const thirdState = makeState(
    thirdTopology,
    Object.freeze({ b: 'black', w: 'white', t: 'black' }),
  );
  const [thirdBlack, thirdWhite] = pairKeys(thirdState, thirdTopology, 'b', 'w');
  const third = analyzeSemeaiSeki(thirdState, thirdTopology, thirdBlack, thirdWhite, {
    includeKillProofs: false,
  });
  const thirdActual =
    third?.seki.status === 'unresolved'
      ? `unresolved:${third.seki.reason}`
      : third?.seki.status ?? 'missing';

  return Object.freeze([
    observe(
      'semeai-side-to-move-kill',
      'semeai-seki',
      'proven-kill',
      whiteKill?.result.outcome ?? 'missing',
      {
        exploredNodes: whiteKill?.result.exploredNodes ?? 0,
        transpositionHits: whiteKill?.result.transpositionHits ?? 0,
      },
    ),
    observe(
      'closed-mutual-capture-seki-certificate',
      'semeai-seki',
      'proven-seki',
      seki?.seki.status ?? 'missing',
    ),
    observe(
      'seki-third-group-boundary',
      'semeai-seki',
      'unresolved:third-group-boundary',
      thirdActual,
      { mustNotProve: true },
    ),
  ]);
};

const topologyCase = (): Engine2AdversarialObservation => {
  const torus = new TorusTopology(9);
  const torusState = makeFilledState(torus, ['0,0', '8,0', '4,4']);
  const torusEye = analyzeSmallEyeSpace(
    torusState,
    torus,
    groupKeyAt(torusState, torus, '1,0'),
  );
  const seam = torusEye?.regions.find((region) => region.points.includes('0,0'));
  const torusOk =
    seam?.complete === true &&
    seam.boundary === 'strict-target-boundary' &&
    JSON.stringify(seam.points) === JSON.stringify(['0,0', '8,0']);

  const cube = new CubeTopology(2);
  const cubeState = makeState(
    cube,
    Object.freeze({ 'front:0:0': 'black', 'right:0:0': 'black' }),
  );
  const cubeNode = createEndgameProofSearchNode(
    cube,
    cubeState,
    'black',
    Object.freeze(['front:0:0']),
    'defender',
  );
  const connection = analyzeTacticalExtensionMoves(cubeNode, cube).candidates.find(
    (entry) => entry.point === 'front:0:1',
  );
  const cubeOk = connection?.reasons.includes('connection') === true;

  return observe(
    'torus-seam-and-cube-edge-graph-native',
    'topology',
    'torus=true;cube=true',
    `torus=${String(torusOk)};cube=${String(cubeOk)}`,
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
  nodeKey: (node: ToyNode): string => node.key,
  role: (node: ToyNode): ProofSearchRole => node.role,
  terminal: (node: ToyNode): ProofSearchTerminal | null => node.terminal ?? null,
  expand: (node: ToyNode): ProofSearchExpansion<ToyMove> =>
    Object.freeze({
      moves: node.moves ?? Object.freeze([] as ToyMove[]),
      completeness: node.completeness ?? Object.freeze({ kind: 'complete' as const }),
    }),
  apply: (_node: ToyNode, move: ToyMove): ToyNode => move.child,
  moveKey: (move: ToyMove): string => move.key,
});

const toyTerminal = (key: string, outcome: ProofSearchTerminal['outcome']): ToyNode =>
  Object.freeze({ key, role: 'attacker' as const, terminal: Object.freeze({ outcome }) });

const toyMove = (key: string, child: ToyNode): ToyMove => Object.freeze({ key, child });

const andOrCases = (): readonly Engine2AdversarialObservation[] => {
  const leaf = toyTerminal('leaf', 'proven-survival');
  const shared: ToyNode = Object.freeze({
    key: 'shared',
    role: 'attacker',
    moves: Object.freeze([toyMove('finish', leaf)]),
  });
  const transpositionRoot: ToyNode = Object.freeze({
    key: 'root',
    role: 'attacker',
    moves: Object.freeze([toyMove('b-route', shared), toyMove('a-route', shared)]),
  });
  const optimized = searchDeterministicAndOrProof(transpositionRoot, toyAdapter);
  const baseline = searchDeterministicAndOrProof(
    transpositionRoot,
    toyAdapter,
    Object.freeze({ useTranspositions: false }),
  );
  const parity =
    optimized.outcome === baseline.outcome &&
    optimized.reason === baseline.reason &&
    JSON.stringify(optimized.principalVariation) === JSON.stringify(baseline.principalVariation) &&
    optimized.maxDepth === baseline.maxDepth &&
    optimized.exploredNodes < baseline.exploredNodes &&
    optimized.transpositionHits > 0;

  const incompleteRoot: ToyNode = Object.freeze({
    key: 'incomplete-root',
    role: 'defender',
    moves: Object.freeze([toyMove('known-defense', toyTerminal('dead', 'proven-kill'))]),
    completeness: Object.freeze({ kind: 'incomplete' as const, reason: 'remote defenses unknown' }),
  });
  const incomplete = searchDeterministicAndOrProof(incompleteRoot, toyAdapter);

  const budgetRoot: ToyNode = Object.freeze({
    key: 'budget-root',
    role: 'attacker',
    moves: Object.freeze([
      toyMove('a-live', toyTerminal('live', 'proven-survival')),
      toyMove('z-kill', toyTerminal('kill', 'proven-kill')),
    ]),
  });
  const budget = searchDeterministicAndOrProof(
    budgetRoot,
    toyAdapter,
    Object.freeze({ nodeBudget: 2 }),
  );

  return Object.freeze([
    observe(
      'transposition-semantic-parity',
      'and-or-core',
      'semantic-parity-with-reuse',
      parity ? 'semantic-parity-with-reuse' : 'mismatch',
      { exploredNodes: optimized.exploredNodes, transpositionHits: optimized.transpositionHits },
    ),
    observe(
      'and-or-incomplete-defender-universal-proof-blocked',
      'and-or-core',
      'unresolved',
      incomplete.outcome,
      {
        mustNotProve: true,
        exploredNodes: incomplete.exploredNodes,
        transpositionHits: incomplete.transpositionHits,
      },
    ),
    observe(
      'and-or-budget-exhaustion-propagates',
      'and-or-core',
      'budget-exhausted',
      budget.outcome,
      {
        mustNotProve: true,
        exploredNodes: budget.exploredNodes,
        transpositionHits: budget.transpositionHits,
      },
    ),
  ]);
};

const isAuthoritativeFate = (actual: string): boolean =>
  actual === 'proven-dead' ||
  actual === 'proven-kill' ||
  actual === 'proven-survival' ||
  actual === 'proven-seki' ||
  actual === 'proven-dead/proven-dead';

export const runEngine2AdversarialCorpus = (): Engine2AdversarialEvaluation => {
  const observations = Object.freeze([
    ...oneLibertyCases(),
    ...twoLibertyCases(),
    ...threeAndFourLibertyCases(),
    ...eyeSpaceCases(),
    tacticalCase(),
    ...semeaiSekiCases(),
    topologyCase(),
    ...andOrCases(),
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
