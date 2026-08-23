import { describe, expect, it } from 'vitest';
import type {
  EndgameClassification,
  EndgameProposal,
  EndgameProposalStatus,
} from '../EndgameClassifier';
import { AssistedEndgameClassifier } from '../AssistedEndgameClassifier';
import { buildEndgameGraph, type EndgameStoneString } from '../EndgameGraphCore';
import {
  LOCAL_LIFE_DEATH_ALGORITHM,
  readLocalLifeDeath,
} from '../LocalLifeDeathReader';
import { proveSafeConnectionToBenson, SAFE_CONNECTION_ALGORITHM } from '../SafeConnection';
import { proveSimpleCutFromBenson, SIMPLE_CUT_ALGORITHM } from '../SimpleCut';
import { analyzeSimpleSemeai, SIMPLE_SEMEAI_ALGORITHM } from '../SemeaiCore';
import { analyzeBoundedSemeai, BOUNDED_SEMEAI_ALGORITHM } from '../SemeaiSearch';
import { analyzeBasicSeki, BASIC_SEKI_ALGORITHM } from '../SekiSearch';
import {
  readTacticalCapture,
  verifyTacticalDead,
  TACTICAL_READER_ALGORITHM,
} from '../TacticalReader';
import { resolveTerritory } from '../TerritoryResolver';
import type { GameState, PointOccupancy } from '../../game/types';
import { ChineseScoring } from '../../scoring/ChineseScoring';
import { JapaneseScoring } from '../../scoring/JapaneseScoring';
import { CubeTopology } from '../../topology/CubeTopology';
import type { PointId, Topology } from '../../topology/Topology';
import { TorusTopology } from '../../topology/TorusTopology';
import { EndgameTestLab } from './EndgameTestLab';
import type { Work9KnownAnswerCase } from './Work9Acceptance';
import {
  runWork9ShadowCase,
  summarizeWork9Acceptance,
  WORK9_ACCEPTANCE_SCHEMA_VERSION,
} from './Work9Acceptance';

const GOSCORER_COMMIT = '0ac5f59962a9e40f39f4667645335ba5068acf86';

class GraphTopology implements Topology {
  readonly id: string;
  private readonly allPoints: readonly PointId[];
  private readonly adjacency: ReadonlyMap<PointId, readonly PointId[]>;

  constructor(id: string, edges: readonly (readonly [PointId, PointId])[]) {
    this.id = id;
    const neighbors = new Map<PointId, Set<PointId>>();
    for (const [left, right] of edges) {
      if (!neighbors.has(left)) neighbors.set(left, new Set());
      if (!neighbors.has(right)) neighbors.set(right, new Set());
      neighbors.get(left)!.add(right);
      neighbors.get(right)!.add(left);
    }
    this.allPoints = Object.freeze([...neighbors.keys()].sort());
    this.adjacency = new Map(
      [...neighbors].map(([point, values]) => [point, Object.freeze([...values].sort())] as const),
    );
  }

  points(): readonly PointId[] {
    return this.allPoints;
  }

  neighbors(point: PointId): readonly PointId[] {
    const values = this.adjacency.get(point);
    if (!values) throw new Error(`Unknown graph point: ${point}`);
    return values;
  }

  has(point: PointId): boolean {
    return this.adjacency.has(point);
  }
}

class GridTopology implements Topology {
  readonly id: string;
  private readonly allPoints: readonly PointId[];
  private readonly pointSet: ReadonlySet<PointId>;

  constructor(
    readonly rows: number,
    readonly columns: number = rows,
  ) {
    this.id = `work9-grid-${rows}x${columns}`;
    this.allPoints = Object.freeze(
      Array.from({ length: rows * columns }, (_, index) => {
        const row = Math.floor(index / columns);
        const column = index % columns;
        return GridTopology.point(row, column);
      }),
    );
    this.pointSet = new Set(this.allPoints);
  }

  static point(row: number, column: number): PointId {
    return `${column},${row}`;
  }

  points(): readonly PointId[] {
    return this.allPoints;
  }

  has(point: PointId): boolean {
    return this.pointSet.has(point);
  }

  neighbors(point: PointId): readonly PointId[] {
    if (!this.has(point)) throw new Error(`Unknown grid point: ${point}`);
    const [columnText, rowText] = point.split(',');
    const row = Number(rowText);
    const column = Number(columnText);
    return Object.freeze(
      [
        [row - 1, column],
        [row, column + 1],
        [row + 1, column],
        [row, column - 1],
      ]
        .filter(
          ([nextRow, nextColumn]) =>
            nextRow >= 0 &&
            nextRow < this.rows &&
            nextColumn >= 0 &&
            nextColumn < this.columns,
        )
        .map(([nextRow, nextColumn]) => GridTopology.point(nextRow, nextColumn)),
    );
  }
}

class CountingTopology implements Topology {
  readonly id: string;
  neighborCalls = 0;

  constructor(private readonly inner: Topology) {
    this.id = `work9-counting:${inner.id}`;
  }

  points(): readonly PointId[] {
    return this.inner.points();
  }

  has(point: PointId): boolean {
    return this.inner.has(point);
  }

  neighbors(point: PointId): readonly PointId[] {
    this.neighborCalls += 1;
    return this.inner.neighbors(point);
  }
}

const makeState = (
  topology: Topology,
  stones: Readonly<Partial<Record<PointId, PointOccupancy>>>,
  currentPlayer: 'black' | 'white' = 'black',
): GameState => {
  const board: Record<PointId, PointOccupancy> = {};
  for (const point of topology.points()) board[point] = stones[point] ?? 'empty';
  return Object.freeze({
    board: Object.freeze(board),
    currentPlayer,
    moveNumber: 0,
    consecutivePasses: 2,
    phase: 'endgame',
    captures: Object.freeze({ black: 0, white: 0 }),
  });
};

const makeFilledState = (
  topology: Topology,
  occupancyAt: (point: PointId) => PointOccupancy,
): GameState => {
  const board: Record<PointId, PointOccupancy> = {};
  for (const point of topology.points()) board[point] = occupancyAt(point);
  return Object.freeze({
    board: Object.freeze(board),
    currentPlayer: 'black',
    moveNumber: 0,
    consecutivePasses: 2,
    phase: 'endgame',
    captures: Object.freeze({ black: 0, white: 0 }),
  });
};

const targetAt = (
  state: GameState,
  topology: Topology,
  point: PointId,
): EndgameStoneString => {
  const target = buildEndgameGraph(state.board, topology).strings.find((candidate) =>
    candidate.points.includes(point),
  );
  if (!target) throw new Error(`No target group at ${point}`);
  return target;
};

const firstStonePoint = (state: GameState, topology: Topology): PointId => {
  const first = buildEndgameGraph(state.board, topology).strings[0]?.points[0];
  if (!first) throw new Error(`No stone group on ${topology.id}`);
  return first;
};

const asClassification = (proposal: EndgameProposal): EndgameClassification =>
  Object.freeze(
    proposal.map((group) => {
      if (group.status === 'unresolved') {
        throw new Error(`Composite Work 9 pipeline fixture left ${group.points.join(',')} unresolved`);
      }
      return Object.freeze({
        points: group.points,
        status: group.status,
        source: 'automatic' as const,
      });
    }),
  );

const enclosedLifeDeath = (
  libertyCount: 2 | 3 | 4,
): Readonly<{ topology: Topology; state: GameState }> => {
  const liberties = ['a', 'b', 'c', 'd'].slice(0, libertyCount);
  const edges: Array<readonly [PointId, PointId]> = [];
  for (const liberty of liberties) edges.push(['t', liberty], [liberty, 'B']);
  edges.push(
    ['t', 'B'],
    ['B', 'be1'],
    ['B', 'be2'],
    ['B', 'outside'],
    ['outside', 'far'],
  );
  const topology = new GraphTopology(`work9-enclosed-${String(libertyCount)}`, edges);
  return Object.freeze({
    topology,
    state: makeState(topology, { t: 'white', B: 'black' }),
  });
};

const safeConnectionFixture = (): Readonly<{ topology: Topology; state: GameState }> => {
  const topology = new GraphTopology('work9-safe-connection', [
    ['t', 'c1'],
    ['t', 'c2'],
    ['s', 'c1'],
    ['s', 'c2'],
    ['c1', 'u'],
    ['u', 'c2'],
    ['s', 'e1'],
    ['s', 'e2'],
    ['s', 'far'],
  ]);
  return Object.freeze({ topology, state: makeState(topology, { t: 'black', s: 'black' }) });
};

const cutFixture = (): Readonly<{ topology: Topology; state: GameState }> => {
  const topology = new GraphTopology('work9-simple-cut', [
    ['t', 'c'],
    ['t', 'x'],
    ['x', 'w'],
    ['s', 'c'],
    ['s', 'e1'],
    ['s', 'e2'],
    ['s', 'far'],
    ['w', 'c'],
    ['w', 'w1'],
    ['w', 'w2'],
  ]);
  return Object.freeze({
    topology,
    state: makeState(topology, { t: 'black', s: 'black', w: 'white' }),
  });
};

const simpleSemeaiFixture = (
  leftLiberties: number,
  rightLiberties: number,
): Readonly<{ topology: Topology; state: GameState }> => {
  const edges: Array<readonly [PointId, PointId]> = [['L', 'R']];
  for (let index = 1; index <= leftLiberties; index += 1) {
    edges.push(['L', `l${index}`], [`l${index}`, `le${index}`]);
  }
  for (let index = 1; index <= rightLiberties; index += 1) {
    edges.push(['R', `r${index}`], [`r${index}`, `re${index}`]);
  }
  const topology = new GraphTopology(
    `work9-simple-semeai-${String(leftLiberties)}-${String(rightLiberties)}`,
    edges,
  );
  return Object.freeze({ topology, state: makeState(topology, { L: 'black', R: 'white' }) });
};

const sharedSemeaiFixture = (): Readonly<{ topology: Topology; state: GameState }> => {
  const topology = new GraphTopology('work9-shared-semeai', [
    ['L', 'R'],
    ['L', 's'],
    ['R', 's'],
    ['s', 'B'],
    ['B', 'b'],
    ['L', 'l'],
    ['l', 'W'],
    ['W', 'w'],
    ['OUT1', 'OUT2'],
  ]);
  return Object.freeze({
    topology,
    state: makeState(topology, { L: 'black', R: 'white', B: 'black', W: 'white' }),
  });
};

const basicSekiFixture = (): Readonly<{ topology: Topology; state: GameState }> => {
  const topology = new GraphTopology('work9-basic-seki', [
    ['L', 's1'],
    ['R', 's1'],
    ['L', 's2'],
    ['R', 's2'],
    ['OUT1', 'OUT2'],
  ]);
  return Object.freeze({ topology, state: makeState(topology, { L: 'black', R: 'white' }) });
};

const koSemeaiFixture = (): Readonly<{ topology: Topology; state: GameState }> => {
  const topology = new GraphTopology('work9-ko-semeai', [
    ['L', 'R'],
    ['L', 'l1'],
    ['l1', 'le1'],
    ['L', 'l2'],
    ['l2', 'le2'],
    ['R', 'c'],
    ['OUT1', 'OUT2'],
  ]);
  return Object.freeze({ topology, state: makeState(topology, { L: 'black', R: 'white' }) });
};

const immediateCaptureFixture = (): Readonly<{ topology: Topology; state: GameState }> => {
  const topology = new GridTopology(3);
  return Object.freeze({
    topology,
    state: makeState(topology, {
      '0,0': 'white',
      '0,1': 'black',
      '1,1': 'black',
      '2,0': 'black',
    }),
  });
};

const forcedCaptureFixture = (): Readonly<{ topology: Topology; state: GameState }> => {
  const topology = new GridTopology(3);
  return Object.freeze({
    topology,
    state: makeState(topology, {
      '0,0': 'white',
      '1,1': 'black',
      '2,0': 'black',
      '0,2': 'black',
    }),
  });
};

const counterCaptureFixture = (): Readonly<{ topology: Topology; state: GameState }> => {
  const topology = new GridTopology(5);
  return Object.freeze({
    topology,
    state: makeState(topology, {
      '2,2': 'white',
      '0,2': 'white',
      '1,1': 'white',
      '1,2': 'black',
      '2,1': 'black',
      '3,2': 'black',
    }),
  });
};

const openBoundaryFixture = (): Readonly<{ topology: Topology; state: GameState }> => {
  const topology = new GridTopology(5);
  return Object.freeze({ topology, state: makeState(topology, { '2,2': 'white' }) });
};

const closedSekiTorus = (): Readonly<{ topology: Topology; state: GameState }> => {
  const topology = new TorusTopology(9);
  const liberties = new Set<PointId>(['3,0', '3,1']);
  const state = makeFilledState(topology, (point) => {
    if (liberties.has(point)) return 'empty';
    const x = Number(point.split(',')[0]);
    return x <= 3 ? 'black' : 'white';
  });
  return Object.freeze({ topology, state });
};

const closedSekiCube = (): Readonly<{ topology: Topology; state: GameState }> => {
  const topology = new CubeTopology(5);
  const liberties = new Set<PointId>(['front:2:2', 'front:3:2']);
  const white = new Set<PointId>(['front:2:3', 'front:3:3']);
  const state = makeFilledState(topology, (point) => {
    if (liberties.has(point)) return 'empty';
    return white.has(point) ? 'white' : 'black';
  });
  return Object.freeze({ topology, state });
};

const buildFrozenKnownAnswerCases = (): readonly Work9KnownAnswerCase[] => {
  const lab = new EndgameTestLab();
  const torusTwoEye = lab.generate({
    kind: 'life-death-pattern',
    topology: new TorusTopology(9),
    seed: 'work9-known-two-eye-torus',
    pattern: 'two-eyes',
  });
  const cubeTwoEye = lab.generate({
    kind: 'life-death-pattern',
    topology: new CubeTopology(5),
    seed: 'work9-known-two-eye-cube',
    pattern: 'two-eyes',
  });
  const torusSingleEye = lab.generate({
    kind: 'life-death-pattern',
    topology: new TorusTopology(9),
    seed: 'work9-known-single-eye',
    pattern: 'single-eye',
  });
  const cubeFalseEye = lab.generate({
    kind: 'life-death-pattern',
    topology: new CubeTopology(5),
    seed: 'work9-known-false-eye',
    pattern: 'false-eye',
  });

  const immediate = immediateCaptureFixture();
  const forced = forcedCaptureFixture();
  const counter = counterCaptureFixture();
  const open = openBoundaryFixture();
  const localDeath = enclosedLifeDeath(3);
  const safe = safeConnectionFixture();
  const cut = cutFixture();
  const simpleSemeai = simpleSemeaiFixture(2, 1);
  const sharedSemeai = sharedSemeaiFixture();
  const basicSeki = basicSekiFixture();
  const ko = koSemeaiFixture();
  const torusSeki = closedSekiTorus();
  const cubeSeki = closedSekiCube();

  return Object.freeze([
    Object.freeze({
      id: 'benson-two-eye-torus',
      className: 'benson',
      topologyClass: 'torus',
      topology: new TorusTopology(9),
      state: torusTwoEye.state,
      targetPoint: firstStonePoint(torusTwoEye.state, new TorusTopology(9)),
      expectedStatus: 'alive',
      provenance: 'Frozen two-eye Benson fixture verified before Work 9.',
    }),
    Object.freeze({
      id: 'benson-two-eye-cube',
      className: 'benson',
      topologyClass: 'cube',
      topology: new CubeTopology(5),
      state: cubeTwoEye.state,
      targetPoint: firstStonePoint(cubeTwoEye.state, new CubeTopology(5)),
      expectedStatus: 'alive',
      provenance: 'Frozen two-eye Benson fixture verified before Work 9.',
    }),
    Object.freeze({
      id: 'one-eye-unresolved-torus',
      className: 'benson',
      topologyClass: 'torus',
      topology: new TorusTopology(9),
      state: torusSingleEye.state,
      targetPoint: firstStonePoint(torusSingleEye.state, new TorusTopology(9)),
      expectedStatus: 'unresolved',
      provenance: 'One-eye negative Benson fixture verified before Work 9.',
    }),
    Object.freeze({
      id: 'false-eye-unresolved-cube',
      className: 'benson',
      topologyClass: 'cube',
      topology: new CubeTopology(5),
      state: cubeFalseEye.state,
      targetPoint: firstStonePoint(cubeFalseEye.state, new CubeTopology(5)),
      expectedStatus: 'unresolved',
      provenance: 'False-eye negative Benson fixture verified before Work 9.',
    }),
    Object.freeze({
      id: 'tactical-immediate-capture',
      className: 'tactical',
      topologyClass: 'arbitrary',
      topology: immediate.topology,
      state: immediate.state,
      targetPoint: '0,0',
      expectedStatus: 'dead',
      provenance: 'Immediate capture known-answer from TacticalReader regression corpus.',
    }),
    Object.freeze({
      id: 'tactical-forced-short-capture',
      className: 'tactical',
      topologyClass: 'arbitrary',
      topology: forced.topology,
      state: forced.state,
      targetPoint: '0,0',
      expectedStatus: 'dead',
      provenance: 'Forced short capture known-answer verified in both first-player orders.',
    }),
    Object.freeze({
      id: 'tactical-counter-capture-defense',
      className: 'tactical',
      topologyClass: 'arbitrary',
      topology: counter.topology,
      state: counter.state,
      targetPoint: '2,2',
      expectedStatus: 'unresolved',
      provenance: 'Counter-capture defense regression forbids automatic dead.',
    }),
    Object.freeze({
      id: 'tactical-open-boundary',
      className: 'tactical',
      topologyClass: 'arbitrary',
      topology: open.topology,
      state: open.state,
      targetPoint: '2,2',
      expectedStatus: 'unresolved',
      provenance: 'Open-boundary tactical regression is intentionally unresolved.',
    }),
    Object.freeze({
      id: 'local-life-death-enclosed-three-liberty',
      className: 'local-life-death',
      topologyClass: 'arbitrary',
      topology: localDeath.topology,
      state: localDeath.state,
      targetPoint: 't',
      expectedStatus: 'dead',
      provenance: 'Frozen enclosed three-liberty tsumego-equivalent known-answer.',
    }),
    Object.freeze({
      id: 'safe-connection-to-benson',
      className: 'connection',
      topologyClass: 'arbitrary',
      topology: safe.topology,
      state: safe.state,
      targetPoint: 't',
      expectedStatus: 'alive',
      provenance: 'Two-shared-liberty miai connection proof verified before Work 9.',
    }),
    Object.freeze({
      id: 'cut-is-fact-not-status',
      className: 'connection',
      topologyClass: 'arbitrary',
      topology: cut.topology,
      state: cut.state,
      targetPoint: 't',
      expectedStatus: 'unresolved',
      provenance: 'Simple cut proof is intentionally not an alive/dead promotion.',
    }),
    Object.freeze({
      id: 'simple-semeai-stable-loser',
      className: 'semeai',
      topologyClass: 'arbitrary',
      topology: simpleSemeai.topology,
      state: simpleSemeai.state,
      targetPoint: 'R',
      expectedStatus: 'dead',
      provenance: 'simple-semeai-v1 proves left wins in both first-player orders.',
    }),
    Object.freeze({
      id: 'shared-liberty-semeai-stable-loser',
      className: 'semeai',
      topologyClass: 'arbitrary',
      topology: sharedSemeai.topology,
      state: sharedSemeai.state,
      targetPoint: 'R',
      expectedStatus: 'dead',
      provenance: 'bounded-semeai-v1 proves left wins in both first-player orders.',
    }),
    Object.freeze({
      id: 'ko-dependent-semeai-unresolved',
      className: 'semeai',
      topologyClass: 'arbitrary',
      topology: ko.topology,
      state: ko.state,
      targetPoint: 'R',
      expectedStatus: 'unresolved',
      provenance: 'Restoring simple-ko semeai regression must fail closed.',
    }),
    Object.freeze({
      id: 'basic-seki-arbitrary-graph',
      className: 'seki',
      topologyClass: 'arbitrary',
      topology: basicSeki.topology,
      state: basicSeki.state,
      targetPoint: 'L',
      expectedStatus: 'seki',
      provenance: 'basic-seki-v1 mutual-restraint fixture verified before Work 9.',
    }),
    Object.freeze({
      id: 'closed-seki-torus',
      className: 'seki',
      topologyClass: 'torus',
      topology: torusSeki.topology,
      state: torusSeki.state,
      targetPoint: '0,0',
      expectedStatus: 'seki',
      provenance: 'Closed two-shared-liberty mutual-life Torus regression.',
    }),
    Object.freeze({
      id: 'closed-seki-cube',
      className: 'seki',
      topologyClass: 'cube',
      topology: cubeSeki.topology,
      state: cubeSeki.state,
      targetPoint: 'front:2:3',
      expectedStatus: 'seki',
      provenance: 'Closed two-shared-liberty mutual-life Cube regression.',
    }),
  ] satisfies readonly Work9KnownAnswerCase[]);
};

const tacticalReaderFixtures = () => {
  const ladderTopology = new GridTopology(5);
  const ladder = makeState(ladderTopology, {
    '1,1': 'white',
    '0,0': 'black',
    '0,1': 'black',
    '1,0': 'black',
    '2,0': 'black',
    '3,0': 'black',
    '4,0': 'black',
  });

  const netTopology = new GridTopology(4);
  const net = makeState(netTopology, {
    '0,0': 'white',
    '1,0': 'black',
    '2,0': 'white',
    '3,0': 'white',
    '0,1': 'black',
    '1,1': 'white',
    '2,1': 'white',
    '2,2': 'black',
    '3,2': 'black',
    '0,3': 'black',
    '1,3': 'black',
    '2,3': 'black',
  });

  const snapbackTopology = new GridTopology(4);
  const snapback = makeState(snapbackTopology, {
    '0,0': 'white',
    '3,0': 'black',
    '0,1': 'white',
    '1,1': 'black',
    '3,1': 'white',
    '2,2': 'black',
    '3,2': 'black',
    '0,3': 'white',
    '1,3': 'white',
    '2,3': 'black',
    '3,3': 'black',
  });

  return Object.freeze({ ladderTopology, ladder, netTopology, net, snapbackTopology, snapback });
};

const stateFromPlanarRows = (rows: readonly string[]) => {
  const topology = new GridTopology(rows.length, rows[0]?.length ?? 0);
  const stones: Record<PointId, PointOccupancy> = {};
  for (let row = 0; row < rows.length; row += 1) {
    for (let column = 0; column < rows[row]!.length; column += 1) {
      const cell = rows[row]![column];
      const point = GridTopology.point(row, column);
      if (cell === 'x') stones[point] = 'black';
      else if (cell === 'o') stones[point] = 'white';
      else if (cell !== '.') throw new Error(`Unsupported planar fixture cell: ${String(cell)}`);
    }
  }
  return Object.freeze({ topology, state: makeState(topology, stones) });
};

const territoryOwnerAt = (
  resolution: ReturnType<typeof resolveTerritory>,
  point: PointId,
): 'BLACK' | 'WHITE' | 'NEUTRAL' => {
  const key = resolution.regionByPoint.get(point);
  if (!key) throw new Error(`No resolved region for ${point}`);
  const region = resolution.regions.find((candidate) => candidate.key === key);
  if (!region) throw new Error(`Missing resolved region ${key}`);
  return region.owner;
};

const proposalSignature = (proposal: EndgameProposal) =>
  proposal.map((group) =>
    Object.freeze({
      points: group.points,
      status: group.status,
      source: group.source ?? null,
      algorithm:
        typeof group.evidence?.algorithm === 'string' ? group.evidence.algorithm : null,
      evidence: group.evidence ?? null,
    }),
  );

describe('Work 9 Massive Acceptance / Shadow Comparison', () => {
  it('measures a frozen independent known-answer corpus and treats every false automatic status as critical', async () => {
    const cases = buildFrozenKnownAnswerCases();
    const records = [];

    for (const testCase of cases) {
      const first = await runWork9ShadowCase(testCase);
      const second = await runWork9ShadowCase(testCase);
      expect(second).toEqual(first);
      expect(first.schemaVersion).toBe(WORK9_ACCEPTANCE_SCHEMA_VERSION);
      expect(first.currentClassifierStatus).toBe('unresolved');
      if (first.automatic) expect(first.engineStatus).toBe(testCase.expectedStatus);
      records.push(first);
    }

    const summary = summarizeWork9Acceptance(records);
    expect(summary.total).toBe(17);
    expect(summary.criticalFalseAutomaticStatuses).toBe(0);
    expect(summary.byClass.benson.total).toBe(4);
    expect(summary.byClass.tactical.total).toBe(4);
    expect(summary.byClass['local-life-death'].total).toBe(1);
    expect(summary.byClass.connection.total).toBe(2);
    expect(summary.byClass.semeai.total).toBe(3);
    expect(summary.byClass.seki.total).toBe(3);
    expect(summary.byTopology.torus.total).toBe(4);
    expect(summary.byTopology.cube.total).toBe(3);
    expect(summary.byTopology.arbitrary.total).toBe(10);
    expect(summary.unresolved.missedResolvableCase).toBeGreaterThanOrEqual(1);

    // This log is an intentional deterministic CI acceptance artifact. It is
    // the measured result, not a hand-maintained target percentage.
    console.info('WORK9_ACCEPTANCE_SUMMARY', JSON.stringify(summary));
    console.info('WORK9_SHADOW_RECORDS', JSON.stringify(records));
  });

  it('keeps the tactical known-answer reader corpus stable for immediate capture, ladder, net, snapback, counter-capture and open boundary', () => {
    const immediate = immediateCaptureFixture();
    const immediateProof = verifyTacticalDead(
      targetAt(immediate.state, immediate.topology, '0,0'),
      immediate.state,
      immediate.topology,
    );
    expect(immediateProof.proven).toBe(true);
    if (immediateProof.proven) expect(immediateProof.evidence.algorithm).toBe(TACTICAL_READER_ALGORITHM);

    const forced = forcedCaptureFixture();
    expect(
      verifyTacticalDead(
        targetAt(forced.state, forced.topology, '0,0'),
        forced.state,
        forced.topology,
      ).proven,
    ).toBe(true);

    const { ladderTopology, ladder, netTopology, net, snapbackTopology, snapback } =
      tacticalReaderFixtures();
    const ladderRead = readTacticalCapture(
      targetAt(ladder, ladderTopology, '1,1'),
      ladder,
      ladderTopology,
      { firstPlayer: 'attacker' },
    );
    expect(ladderRead.outcome).toBe('proved-kill');
    expect(ladderRead.principalVariation).toEqual([
      '1,2',
      '2,1',
      '2,2',
      '3,1',
      '3,2',
      '4,1',
      '4,2',
    ]);

    const netRead = readTacticalCapture(targetAt(net, netTopology, '2,0'), net, netTopology, {
      firstPlayer: 'attacker',
    });
    expect(netRead.outcome).toBe('proved-kill');
    expect(netRead.principalVariation[0]).toBe('0,2');

    const snapbackRead = readTacticalCapture(
      targetAt(snapback, snapbackTopology, '0,3'),
      snapback,
      snapbackTopology,
      { firstPlayer: 'attacker' },
    );
    expect(snapbackRead.outcome).toBe('proved-kill');
    expect(snapbackRead.principalVariation).toEqual(['0,2', '1,2', '0,2']);

    const counter = counterCaptureFixture();
    const counterRead = readTacticalCapture(
      targetAt(counter.state, counter.topology, '2,2'),
      counter.state,
      counter.topology,
      { firstPlayer: 'defender' },
    );
    expect(counterRead.outcome).not.toBe('proved-kill');
    expect(counterRead.principalVariation[0]).toBe('1,3');

    const open = openBoundaryFixture();
    expect(
      readTacticalCapture(
        targetAt(open.state, open.topology, '2,2'),
        open.state,
        open.topology,
        { firstPlayer: 'attacker' },
      ).outcome,
    ).toBe('unknown-boundary');
  });

  it('keeps enclosed/nakade-like L&D, safe connection and cut proofs independent from aggregate classifier metrics', () => {
    for (const libertyCount of [2, 3, 4] as const) {
      const fixture = enclosedLifeDeath(libertyCount);
      const result = readLocalLifeDeath(
        targetAt(fixture.state, fixture.topology, 't'),
        fixture.state,
        fixture.topology,
        { maxNodes: 512 },
      );
      expect(result.algorithm).toBe(LOCAL_LIFE_DEATH_ALGORITHM);
      expect(result.outcome).toBe('proved-dead');
      expect(result.attackerFirst.outcome).toBe('proved-dead');
      expect(result.defenderFirst.outcome).toBe('proved-dead');
    }

    const connection = safeConnectionFixture();
    const connectionResult = proveSafeConnectionToBenson(
      targetAt(connection.state, connection.topology, 't'),
      connection.state.board,
      connection.topology,
    );
    expect(connectionResult.outcome).toBe('proven');
    if (connectionResult.outcome === 'proven') {
      expect(connectionResult.evidence.algorithm).toBe(SAFE_CONNECTION_ALGORITHM);
    }

    const cut = cutFixture();
    const cutResult = proveSimpleCutFromBenson(
      targetAt(cut.state, cut.topology, 't'),
      cut.state.board,
      cut.topology,
    );
    expect(cutResult.outcome).toBe('proven');
    if (cutResult.outcome === 'proven') expect(cutResult.evidence.algorithm).toBe(SIMPLE_CUT_ALGORITHM);
  });

  it('measures simple semeai, shared-liberty semeai, basic seki and ko without integrating Work 7D', () => {
    const simple = simpleSemeaiFixture(2, 1);
    const simpleResult = analyzeSimpleSemeai(
      targetAt(simple.state, simple.topology, 'L'),
      targetAt(simple.state, simple.topology, 'R'),
      simple.state,
      simple.topology,
    );
    expect(simpleResult.algorithm).toBe(SIMPLE_SEMEAI_ALGORITHM);
    expect(simpleResult.outcome).toBe('left-wins');
    expect(simpleResult.leftFirst?.outcome).toBe('left-wins');
    expect(simpleResult.rightFirst?.outcome).toBe('left-wins');

    const shared = sharedSemeaiFixture();
    const sharedResult = analyzeBoundedSemeai(
      targetAt(shared.state, shared.topology, 'L'),
      targetAt(shared.state, shared.topology, 'R'),
      shared.state,
      shared.topology,
    );
    expect(sharedResult.algorithm).toBe(BOUNDED_SEMEAI_ALGORITHM);
    expect(sharedResult.outcome).toBe('left-wins');
    expect(sharedResult.leftFirst.outcome).toBe('left-wins');
    expect(sharedResult.rightFirst.outcome).toBe('left-wins');

    const seki = basicSekiFixture();
    const sekiResult = analyzeBasicSeki(
      targetAt(seki.state, seki.topology, 'L'),
      targetAt(seki.state, seki.topology, 'R'),
      seki.state,
      seki.topology,
    );
    expect(sekiResult.algorithm).toBe(BASIC_SEKI_ALGORITHM);
    expect(sekiResult.outcome).toBe('seki');
    expect(sekiResult.leftInitiation.outcome).toBe('all-local-initiations-lose');
    expect(sekiResult.rightInitiation.outcome).toBe('all-local-initiations-lose');

    const ko = koSemeaiFixture();
    const koResult = analyzeSimpleSemeai(
      targetAt(ko.state, ko.topology, 'L'),
      targetAt(ko.state, ko.topology, 'R'),
      ko.state,
      ko.topology,
    );
    expect(koResult.outcome).toBe('ko-dependent');
  });

  it('runs a semantics-compatible pinned goscorer differential and classifies the result as a match', () => {
    const boardRows = Object.freeze([
      '......x..',
      '.xx.x.x..',
      '......x..',
      '......x..',
      'oooooox..',
      '.....oxxx',
      '.....o.o.',
      '...o.o..o',
      '.....o...',
    ]);
    const oracleRows = Object.freeze([
      '......xzz',
      '.xx.x.xzz',
      '......xzz',
      '......xzz',
      'ooooooxzz',
      'aaaaaoxxx',
      'aaaaao.o.',
      'aaaoao..o',
      'aaaaao...',
    ]);
    const { topology, state } = stateFromPlanarRows(boardRows);
    const resolution = resolveTerritory(state, Object.freeze([]), topology);
    const counts = { BLACK: 0, WHITE: 0, NEUTRAL: 0 };

    for (let row = 0; row < boardRows.length; row += 1) {
      for (let column = 0; column < boardRows[row]!.length; column += 1) {
        if (boardRows[row]![column] !== '.') continue;
        const oracleCell = oracleRows[row]![column];
        const expected = oracleCell === 'z' ? 'BLACK' : oracleCell === 'a' ? 'WHITE' : 'NEUTRAL';
        expect(territoryOwnerAt(resolution, GridTopology.point(row, column))).toBe(expected);
        counts[expected] += 1;
      }
    }

    expect(GOSCORER_COMMIT).toBe('0ac5f59962a9e40f39f4667645335ba5068acf86');
    expect(counts).toEqual({ BLACK: 10, WHITE: 19, NEUTRAL: 28 });
    console.info(
      'WORK9_ORACLE_DIFFERENTIAL',
      JSON.stringify({
        oracle: 'lightvector/goscorer',
        revision: GOSCORER_COMMIT,
        semantics: 'ordinary planar territory without seki/false-eye overrides',
        status: 'match',
        discrepancy: 'none',
        counts,
      }),
    );
  });

  it('keeps fixed-seed generated near-endgame stress deterministic without treating generator output as truth', async () => {
    const lab = new EndgameTestLab();
    const classifier = new AssistedEndgameClassifier();
    const requests = [
      ...['work9-stress-torus-01', 'work9-stress-torus-02', 'work9-stress-torus-03'].map(
        (seed) =>
          Object.freeze({
            kind: 'endgame-position' as const,
            topology: new TorusTopology(9),
            seed,
            maxMoves: 54,
          }),
      ),
      ...['work9-stress-cube-01', 'work9-stress-cube-02', 'work9-stress-cube-03'].map(
        (seed) =>
          Object.freeze({
            kind: 'endgame-position' as const,
            topology: new CubeTopology(5),
            seed,
            maxMoves: 72,
          }),
      ),
    ];

    for (const request of requests) {
      const firstFixture = lab.generate(request);
      const secondFixture = lab.generate(request);
      expect(secondFixture).toEqual(firstFixture);

      const first = await lab.analyze(firstFixture, classifier);
      const second = await lab.analyze(secondFixture, classifier);
      expect(proposalSignature(second)).toEqual(proposalSignature(first));
    }
  });

  it('preserves topology metamorphic conservative outcomes on Torus seam, Cube edge and Cube physical corner stress placements', async () => {
    const lab = new EndgameTestLab();
    const classifier = new AssistedEndgameClassifier();
    const fixtures = [
      lab.generate({
        kind: 'topology-stress',
        topology: new TorusTopology(9),
        seed: 'work9-metamorphic-seam',
        mode: 'torus-seam',
        pattern: 'shared-liberties',
      }),
      lab.generate({
        kind: 'topology-stress',
        topology: new CubeTopology(5),
        seed: 'work9-metamorphic-edge',
        mode: 'cube-edge',
        pattern: 'shared-liberties',
      }),
      lab.generate({
        kind: 'topology-stress',
        topology: new CubeTopology(5),
        seed: 'work9-metamorphic-corner',
        mode: 'cube-corner',
        pattern: 'shared-liberties',
      }),
    ];

    const signatures = [];
    for (const fixture of fixtures) {
      const proposal = await lab.analyze(fixture, classifier);
      expect(proposal.length).toBeGreaterThan(0);
      expect(proposal.every((group) => group.status === 'unresolved')).toBe(true);
      signatures.push(Object.freeze(proposal.map((group) => group.status).sort()));
    }
    expect(signatures.every((signature) => signature.every((status) => status === 'unresolved'))).toBe(true);
  });

  it('runs a composite classification -> TerritoryResolver -> Chinese/Japanese scoring handoff with dead, seki and dame at once', async () => {
    const topology = new GraphTopology('work9-full-pipeline', [
      ['t', 'a'],
      ['a', 'B'],
      ['t', 'b'],
      ['b', 'B'],
      ['t', 'c'],
      ['c', 'B'],
      ['t', 'B'],
      ['B', 'be1'],
      ['B', 'be2'],
      ['B', 'outside'],
      ['outside', 'far'],
      ['L', 's1'],
      ['R', 's1'],
      ['L', 's2'],
      ['R', 's2'],
      ['d1', 'd2'],
    ]);
    const state = makeState(topology, {
      t: 'white',
      B: 'black',
      L: 'black',
      R: 'white',
    });
    const graph = buildEndgameGraph(state.board, topology);
    const proposal = await new AssistedEndgameClassifier().analyze({
      state,
      topology,
      groups: Object.freeze(graph.strings.map((group) => group.points)),
    });

    const byPoint = (point: PointId): EndgameProposalStatus => {
      const group = proposal.find((candidate) => candidate.points.includes(point));
      if (!group) throw new Error(`No proposal for ${point}`);
      return group.status;
    };
    expect(byPoint('t')).toBe('dead');
    expect(byPoint('B')).toBe('alive');
    expect(byPoint('L')).toBe('seki');
    expect(byPoint('R')).toBe('seki');

    const classification = asClassification(proposal);
    const beforeBoard = state.board;
    const resolution = resolveTerritory(state, classification, topology);
    expect(state.board).toBe(beforeBoard);
    expect(state.board.t).toBe('white');

    const sekiRegions = resolution.regions.filter((region) => region.touchesSeki);
    expect(sekiRegions.length).toBeGreaterThan(0);
    expect(sekiRegions.every((region) => region.owner === 'NEUTRAL')).toBe(true);
    const dame = resolution.regions.find((region) => region.points.includes('d1'));
    expect(dame).toMatchObject({ owner: 'NEUTRAL', touchesSeki: false });

    const chinese = new ChineseScoring(topology).score(state, classification, 0);
    const japanese = new JapaneseScoring(topology).score(state, classification, 0);
    expect(chinese.territory).toEqual(japanese.territory);
    expect(chinese.territory.seki).toBeGreaterThan(0);
    expect(chinese.territory.neutral).toBeGreaterThan(0);
  });

  it('uses deterministic algorithmic performance gates instead of wall-clock correctness thresholds', () => {
    const local = enclosedLifeDeath(4);
    const localTarget = targetAt(local.state, local.topology, 't');
    const firstLocal = readLocalLifeDeath(localTarget, local.state, local.topology, {
      maxNodes: 512,
    });
    const secondLocal = readLocalLifeDeath(localTarget, local.state, local.topology, {
      maxNodes: 512,
    });
    expect(secondLocal).toEqual(firstLocal);
    for (const nodes of [
      firstLocal.attackerFirst.search?.exploredNodes ?? 0,
      firstLocal.defenderFirst.search?.exploredNodes ?? 0,
    ]) {
      expect(nodes).toBeLessThan(512);
    }

    const shared = sharedSemeaiFixture();
    const left = targetAt(shared.state, shared.topology, 'L');
    const right = targetAt(shared.state, shared.topology, 'R');
    const firstSemeai = analyzeBoundedSemeai(left, right, shared.state, shared.topology);
    const secondSemeai = analyzeBoundedSemeai(left, right, shared.state, shared.topology);
    expect(secondSemeai).toEqual(firstSemeai);
    for (const nodes of [
      firstSemeai.leftFirst.search?.exploredNodes ?? 0,
      firstSemeai.rightFirst.search?.exploredNodes ?? 0,
    ]) {
      expect(nodes).toBeLessThan(20_000);
    }

    const cube = new CubeTopology(9);
    const counting = new CountingTopology(cube);
    const state = makeFilledState(counting, (point) => {
      const code = [...point].reduce((total, character) => total + character.charCodeAt(0), 0);
      if (code % 7 === 0) return 'empty';
      return code % 2 === 0 ? 'black' : 'white';
    });
    const logicalPointCount = counting.points().length;
    const resolution = resolveTerritory(state, Object.freeze([]), counting);
    expect(resolution.regions.length).toBeGreaterThan(0);
    expect(counting.neighborCalls).toBeLessThanOrEqual(logicalPointCount * 6);
  });
});
