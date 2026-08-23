import { AssistedEndgameClassifier } from '../AssistedEndgameClassifier';
import { endgameGroupId } from '../EndgameGroupIdentity';
import { GameEngine } from '../../game/GameEngine';
import type {
  BoardOccupancy,
  GameState,
  PointOccupancy,
  StoneColor,
} from '../../game/types';
import {
  CUBE_FACES,
  CubeTopology,
  cubePointId,
  type CubeFace,
} from '../../topology/CubeTopology';
import type { PointId, Topology } from '../../topology/Topology';
import { TorusTopology } from '../../topology/TorusTopology';
import { DeterministicRandom } from './DeterministicRandom';
import { generateLiveTestCase } from './LiveTestGenerators';
import type {
  ReplayableTestCase,
  TestCaseIdentity,
} from './TestCase';

export const CONTROLLED_ENDGAME_GENERATOR_VERSION = 1 as const;

export type ControlledExpectedStatus = 'alive' | 'dead' | 'seki' | 'unresolved';
export type ControlledExpectedRole =
  | 'control-alive'
  | 'mandatory-dead'
  | 'control-seki'
  | 'intentional-unresolved';

export interface ControlledExpectedGroup {
  readonly role: ControlledExpectedRole;
  readonly expected: ControlledExpectedStatus;
  readonly points: readonly PointId[];
}

export type ControlledEndgameTestCase = ReplayableTestCase & Readonly<{
  expectedGroups: readonly ControlledExpectedGroup[];
}>;

interface DeadControl {
  readonly point: PointId;
  readonly liberty: PointId;
}

interface UnresolvedControl {
  readonly point: PointId;
  readonly liberties: readonly [PointId, PointId];
}

interface ControlLayout {
  readonly patch: ReadonlySet<PointId>;
  readonly eyes: readonly [PointId, PointId];
  readonly dead: readonly DeadControl[];
  readonly unresolved: readonly UnresolvedControl[];
  readonly scaffoldColor: StoneColor;
  readonly controlColor: StoneColor;
  readonly protectedPoints: ReadonlySet<PointId>;
}

interface SekiEmbedding {
  readonly placements: readonly Readonly<{ point: PointId; occupancy: PointOccupancy }>[];
  readonly blackGroup: readonly PointId[];
  readonly whiteGroup: readonly PointId[];
}

const oppositeColor = (color: StoneColor): StoneColor =>
  color === 'black' ? 'white' : 'black';

const sorted = (points: readonly PointId[]): readonly PointId[] =>
  Object.freeze([...points].sort());

const bfsBall = (
  topology: Topology,
  center: PointId,
  radius: number,
): ReadonlySet<PointId> => {
  const distances = new Map<PointId, number>([[center, 0]]);
  const pending: PointId[] = [center];

  while (pending.length > 0) {
    const point = pending.shift()!;
    const distance = distances.get(point)!;
    if (distance >= radius) continue;
    for (const neighbor of topology.neighbors(point)) {
      if (distances.has(neighbor)) continue;
      distances.set(neighbor, distance + 1);
      pending.push(neighbor);
    }
  }

  return new Set(distances.keys());
};

const topologySpecificAnchors = (topology: Topology): readonly PointId[] => {
  if (topology instanceof TorusTopology) {
    return Object.freeze(
      topology.points().filter((point) => {
        const [xText, yText] = point.split(',');
        return Number(xText) === 0 || Number(yText) === 0;
      }),
    );
  }

  if (topology instanceof CubeTopology) {
    return Object.freeze(
      topology.points().filter((point) => {
        const face = point.split(':')[0];
        return topology.neighbors(point).some((neighbor) => neighbor.split(':')[0] !== face);
      }),
    );
  }

  return topology.points();
};

const occupancyForLayout = (
  point: PointId,
  layout: Pick<ControlLayout, 'eyes' | 'dead' | 'unresolved' | 'scaffoldColor' | 'controlColor'>,
): PointOccupancy => {
  if (layout.eyes.includes(point)) return 'empty';
  for (const control of layout.dead) {
    if (control.point === point) return layout.controlColor;
    if (control.liberty === point) return 'empty';
  }
  for (const control of layout.unresolved) {
    if (control.point === point) return layout.controlColor;
    if (control.liberties.includes(point)) return 'empty';
  }
  return layout.scaffoldColor;
};

const unique = (points: readonly PointId[]): boolean =>
  new Set(points).size === points.length;

const buildControlLayout = (
  topology: Topology,
  patch: ReadonlySet<PointId>,
  scaffoldColor: StoneColor,
  deadCount: number,
  random: DeterministicRandom,
): ControlLayout | null => {
  const deep = [...patch]
    .filter((point) => topology.neighbors(point).every((neighbor) => patch.has(neighbor)))
    .sort();
  const deadCenters = deep.filter((point) =>
    topology.neighbors(point).some((neighbor) => deep.includes(neighbor)),
  );
  const unresolvedCenters = deep.filter((point) =>
    topology.neighbors(point).filter((neighbor) => deep.includes(neighbor)).length >= 2,
  );
  if (deep.length < 8 || deadCenters.length === 0 || unresolvedCenters.length === 0) return null;

  const controlColor = oppositeColor(scaffoldColor);

  for (let attempt = 0; attempt < 1_024; attempt += 1) {
    const eyeCandidates = random.shuffle(deep).slice(0, 2);
    if (eyeCandidates.length !== 2) return null;
    const eyes = Object.freeze([eyeCandidates[0]!, eyeCandidates[1]!] as const);

    const dead: DeadControl[] = [];
    for (let index = 0; index < deadCount; index += 1) {
      const point = random.pick(deadCenters);
      const liberty = random.pick(topology.neighbors(point).filter((neighbor) => deep.includes(neighbor)));
      dead.push(Object.freeze({ point, liberty }));
    }

    const unresolved: UnresolvedControl[] = [];
    for (let index = 0; index < 2; index += 1) {
      const point = random.pick(unresolvedCenters);
      const libertyCandidates = random.shuffle(
        topology.neighbors(point).filter((neighbor) => deep.includes(neighbor)),
      ).slice(0, 2);
      if (libertyCandidates.length !== 2) break;
      const liberties = Object.freeze([libertyCandidates[0]!, libertyCandidates[1]!] as const);
      unresolved.push(Object.freeze({ point, liberties }));
    }
    if (unresolved.length !== 2) continue;

    const corePoints = [
      ...eyes,
      ...dead.flatMap((control) => [control.point, control.liberty]),
      ...unresolved.flatMap((control) => [control.point, ...control.liberties]),
    ];
    if (!unique(corePoints)) continue;

    const draft = Object.freeze({
      eyes,
      dead: Object.freeze(dead),
      unresolved: Object.freeze(unresolved),
      scaffoldColor,
      controlColor,
    });

    const occupancy = (point: PointId): PointOccupancy =>
      patch.has(point) ? occupancyForLayout(point, draft) : 'empty';

    const eyesValid = eyes.every((eye) =>
      topology.neighbors(eye).every((neighbor) => occupancy(neighbor) === scaffoldColor),
    );
    if (!eyesValid) continue;

    const deadValid = dead.every((control) => {
      const liberties = topology.neighbors(control.point).filter((neighbor) => occupancy(neighbor) === 'empty');
      if (liberties.length !== 1 || liberties[0] !== control.liberty) return false;
      if (topology.neighbors(control.point).some((neighbor) => occupancy(neighbor) === controlColor)) return false;
      return topology.neighbors(control.liberty).every(
        (neighbor) => neighbor === control.point || occupancy(neighbor) === scaffoldColor,
      );
    });
    if (!deadValid) continue;

    const unresolvedValid = unresolved.every((control) => {
      const liberties = topology.neighbors(control.point)
        .filter((neighbor) => occupancy(neighbor) === 'empty')
        .sort();
      if (liberties.length !== 2 || liberties.join('|') !== [...control.liberties].sort().join('|')) return false;
      return !topology.neighbors(control.point).some((neighbor) => occupancy(neighbor) === controlColor);
    });
    if (!unresolvedValid) continue;

    const scaffoldPoints = [...patch].filter((point) => occupancy(point) === scaffoldColor);
    if (scaffoldPoints.length === 0) continue;
    const visited = new Set<PointId>([scaffoldPoints[0]!]);
    const pending: PointId[] = [scaffoldPoints[0]!];
    while (pending.length > 0) {
      const point = pending.pop()!;
      for (const neighbor of topology.neighbors(point)) {
        if (!patch.has(neighbor) || occupancy(neighbor) !== scaffoldColor || visited.has(neighbor)) continue;
        visited.add(neighbor);
        pending.push(neighbor);
      }
    }
    if (visited.size !== scaffoldPoints.length) continue;

    const protectedPoints = new Set<PointId>();
    for (const point of corePoints) {
      protectedPoints.add(point);
      for (const neighbor of topology.neighbors(point)) protectedPoints.add(neighbor);
    }

    return Object.freeze({
      patch,
      eyes,
      dead: Object.freeze(dead),
      unresolved: Object.freeze(unresolved),
      scaffoldColor,
      controlColor,
      protectedPoints,
    });
  }

  return null;
};

const SEKI_PATTERN = Object.freeze([
  'BWBBW',
  'WBEWB',
  'WBEWB',
  'BWBBW',
  'WWWBW',
] as const);

const torusSekiEmbeddings = (
  topology: TorusTopology,
  random: DeterministicRandom,
): readonly SekiEmbedding[] => {
  if (topology.size < 5) return Object.freeze([]);
  const embeddings: SekiEmbedding[] = [];
  for (let anchorY = 0; anchorY <= topology.size - 5; anchorY += 1) {
    for (let anchorX = 0; anchorX <= topology.size - 5; anchorX += 1) {
      const pointAt = (row: number, column: number): PointId => `${String(anchorX + column)},${String(anchorY + row)}`;
      const placements = SEKI_PATTERN.flatMap((line, row) =>
        [...line].map((cell, column) => Object.freeze({
          point: pointAt(row, column),
          occupancy: cell === 'B' ? 'black' as const : cell === 'W' ? 'white' as const : 'empty' as const,
        })),
      );
      embeddings.push(Object.freeze({
        placements: Object.freeze(placements),
        blackGroup: sorted([pointAt(1, 1), pointAt(2, 1)]),
        whiteGroup: sorted([pointAt(1, 3), pointAt(2, 3)]),
      }));
    }
  }
  return random.shuffle(embeddings);
};

const cubeSekiEmbeddings = (
  topology: CubeTopology,
  random: DeterministicRandom,
): readonly SekiEmbedding[] => {
  if (topology.size < 6) return Object.freeze([]);
  const embeddings: SekiEmbedding[] = [];
  for (const face of random.shuffle(CUBE_FACES)) {
    for (let anchorRow = 0; anchorRow <= topology.size - 5; anchorRow += 1) {
      for (let anchorColumn = 0; anchorColumn <= topology.size - 5; anchorColumn += 1) {
        if (
          anchorRow === 0 ||
          anchorColumn === 0 ||
          anchorRow + 5 === topology.size ||
          anchorColumn + 5 === topology.size
        ) continue;
        const pointAt = (row: number, column: number): PointId =>
          cubePointId(face as CubeFace, anchorRow + row, anchorColumn + column);
        const placements = SEKI_PATTERN.flatMap((line, row) =>
          [...line].map((cell, column) => Object.freeze({
            point: pointAt(row, column),
            occupancy: cell === 'B' ? 'black' as const : cell === 'W' ? 'white' as const : 'empty' as const,
          })),
        );
        embeddings.push(Object.freeze({
          placements: Object.freeze(placements),
          blackGroup: sorted([pointAt(1, 1), pointAt(2, 1)]),
          whiteGroup: sorted([pointAt(1, 3), pointAt(2, 3)]),
        }));
      }
    }
  }
  return Object.freeze(embeddings);
};

const selectSekiEmbedding = (
  topology: Topology,
  layout: ControlLayout,
  random: DeterministicRandom,
): SekiEmbedding | null => {
  const embeddings = topology instanceof TorusTopology
    ? torusSekiEmbeddings(topology, random)
    : topology instanceof CubeTopology
      ? cubeSekiEmbeddings(topology, random)
      : Object.freeze([]);

  for (const embedding of embeddings) {
    const placementPoints = new Set(embedding.placements.map((placement) => placement.point));
    if ([...layout.protectedPoints].some((point) => placementPoints.has(point))) continue;
    return embedding;
  }
  return null;
};

const collectGroups = (
  state: GameState,
  topology: Topology,
): readonly (readonly PointId[])[] => {
  const engine = new GameEngine(topology);
  const visited = new Set<PointId>();
  const groups: (readonly PointId[])[] = [];
  for (const point of [...topology.points()].sort()) {
    if (visited.has(point) || state.board[point] === 'empty') continue;
    const group = engine.groupAt(state, point);
    if (!group) continue;
    const points = sorted(group.points);
    for (const member of points) visited.add(member);
    groups.push(points);
  }
  return Object.freeze(groups);
};

const hasZeroLibertyGroup = (state: GameState, topology: Topology): boolean => {
  const engine = new GameEngine(topology);
  for (const group of collectGroups(state, topology)) {
    const resolved = engine.groupAt(state, group[0]!);
    if (!resolved || resolved.liberties.length === 0) return true;
  }
  return false;
};

const topologySpecificContact = (state: GameState, topology: Topology): boolean => {
  for (const point of topology.points()) {
    if (state.board[point] === 'empty') continue;
    for (const neighbor of topology.neighbors(point)) {
      if (state.board[neighbor] === 'empty') continue;
      if (topology instanceof TorusTopology) {
        const [x1, y1] = point.split(',').map(Number);
        const [x2, y2] = neighbor.split(',').map(Number);
        if (Math.abs(x1 - x2) === topology.size - 1 || Math.abs(y1 - y2) === topology.size - 1) return true;
      } else if (topology instanceof CubeTopology && point.split(':')[0] !== neighbor.split(':')[0]) {
        return true;
      }
    }
  }
  return false;
};

const finishTwoPasses = (state: GameState, topology: Topology): GameState => {
  const engine = new GameEngine(topology);
  const first = engine.pass(state);
  if (!first.ok) throw new Error('Controlled endgame rejected first Pass');
  const second = engine.pass(first.state);
  if (!second.ok) throw new Error('Controlled endgame rejected second Pass');
  return second.state;
};

const verifyExpectedGroups = async (
  state: GameState,
  topology: Topology,
  expectedGroups: readonly ControlledExpectedGroup[],
): Promise<boolean> => {
  const endgameState = finishTwoPasses(state, topology);
  const proposal = await new AssistedEndgameClassifier().analyze(Object.freeze({
    state: endgameState,
    topology,
    groups: collectGroups(endgameState, topology),
  }));
  const statuses = new Map(
    proposal.map((group) => [endgameGroupId(group.points), group.status] as const),
  );
  return expectedGroups.every((expected) =>
    statuses.get(endgameGroupId(expected.points)) === expected.expected,
  );
};

const expectedGroupsFor = (
  state: GameState,
  topology: Topology,
  layout: ControlLayout,
  seki: SekiEmbedding | null,
): readonly ControlledExpectedGroup[] | null => {
  const engine = new GameEngine(topology);
  const firstEyeNeighbor = topology.neighbors(layout.eyes[0])[0];
  if (!firstEyeNeighbor || state.board[firstEyeNeighbor] !== layout.scaffoldColor) return null;
  const scaffold = engine.groupAt(state, firstEyeNeighbor);
  if (!scaffold) return null;
  const scaffoldSet = new Set(scaffold.points);
  if (!layout.eyes.every((eye) => topology.neighbors(eye).every((neighbor) => scaffoldSet.has(neighbor)))) {
    return null;
  }

  const expected: ControlledExpectedGroup[] = [
    Object.freeze({ role: 'control-alive', expected: 'alive', points: sorted(scaffold.points) }),
  ];

  for (const control of layout.dead) {
    const group = engine.groupAt(state, control.point);
    if (!group || group.points.length !== 1 || group.points[0] !== control.point) return null;
    expected.push(Object.freeze({ role: 'mandatory-dead', expected: 'dead', points: sorted(group.points) }));
  }
  for (const control of layout.unresolved) {
    const group = engine.groupAt(state, control.point);
    if (!group || group.points.length !== 1 || group.points[0] !== control.point) return null;
    expected.push(Object.freeze({ role: 'intentional-unresolved', expected: 'unresolved', points: sorted(group.points) }));
  }

  if (seki) {
    const black = engine.groupAt(state, seki.blackGroup[0]!);
    const white = engine.groupAt(state, seki.whiteGroup[0]!);
    if (!black || !white) return null;
    if (endgameGroupId(black.points) !== endgameGroupId(seki.blackGroup)) return null;
    if (endgameGroupId(white.points) !== endgameGroupId(seki.whiteGroup)) return null;
    expected.push(
      Object.freeze({ role: 'control-seki', expected: 'seki', points: sorted(black.points) }),
      Object.freeze({ role: 'control-seki', expected: 'seki', points: sorted(white.points) }),
    );
  }

  return Object.freeze(expected);
};

export const controlledExpectedGroups = (
  testCase: ReplayableTestCase,
): readonly ControlledExpectedGroup[] => {
  const value = (testCase as Partial<ControlledEndgameTestCase>).expectedGroups;
  return value ?? Object.freeze([]);
};

export const generateControlledEndgameTestCase = async (
  identity: TestCaseIdentity,
  topology: Topology,
  testId: string,
): Promise<ControlledEndgameTestCase> => {
  const seed = String(identity.payload);
  const allPoints = topology.points();
  const pointCount = allPoints.length;
  const deadCount = pointCount >= 90 || topology instanceof TorusTopology ? 2 : 1;
  const radius = deadCount >= 2 ? 5 : 4;
  const requestSeki = identity.size >= 5 && new DeterministicRandom(
    `controlled-endgame-seki-v${String(CONTROLLED_ENDGAME_GENERATOR_VERSION)}:${identity.topology}:${identity.size}:${seed}`,
  ).integer(3) === 0;
  const background = generateLiveTestCase({
    generator: 'game-like',
    topology: identity.topology,
    size: identity.size,
    seed: `${seed}:controlled-background`,
  });

  for (let outerAttempt = 0; outerAttempt < 48; outerAttempt += 1) {
    const attemptSeed = `${seed}:controlled:${String(outerAttempt)}`;
    const random = new DeterministicRandom(
      `controlled-endgame-v${String(CONTROLLED_ENDGAME_GENERATOR_VERSION)}:${identity.topology}:${identity.size}:${attemptSeed}`,
    );
    const anchors = topologySpecificAnchors(topology);
    const anchor = random.pick(anchors.length > 0 ? anchors : allPoints);
    const patch = pointCount <= 24 ? new Set(allPoints) : bfsBall(topology, anchor, radius);
    const scaffoldColor: StoneColor = random.integer(2) === 0 ? 'black' : 'white';
    const layout = buildControlLayout(topology, patch, scaffoldColor, deadCount, random);
    if (!layout) continue;

    const board: Record<PointId, PointOccupancy> = { ...background.state.board };
    for (const point of layout.patch) board[point] = occupancyForLayout(point, layout);

    let seki: SekiEmbedding | null = null;
    if (requestSeki && outerAttempt < 8) {
      seki = selectSekiEmbedding(topology, layout, random);
      if (!seki) continue;
      for (const placement of seki.placements) board[placement.point] = placement.occupancy;
    }

    const state: GameState = Object.freeze({
      ...background.state,
      board: Object.freeze(board) as BoardOccupancy,
      consecutivePasses: 0,
      phase: 'playing',
    });
    if (hasZeroLibertyGroup(state, topology) || !topologySpecificContact(state, topology)) continue;

    const expectedGroups = expectedGroupsFor(state, topology, layout, seki);
    if (!expectedGroups) continue;
    if (!(await verifyExpectedGroups(state, topology, expectedGroups))) continue;

    const deadGroups = expectedGroups.filter((group) => group.role === 'mandatory-dead');
    const unresolvedGroups = expectedGroups.filter((group) => group.role === 'intentional-unresolved');
    if (deadGroups.length < 1 || unresolvedGroups.length < 2) continue;

    return Object.freeze({
      testId,
      identity,
      state,
      loadStrategy: 'snapshot',
      commands: Object.freeze([]),
      targetPoints: Object.freeze(deadGroups.flatMap((group) => group.points)),
      expectedGroups,
      scenario: 'controlled-mixed-endgame',
      tags: Object.freeze([
        'endgame',
        'full-position',
        'controlled-mix',
        'game-like-background',
        'control-alive',
        'mandatory-dead',
        'intentional-unresolved',
        'topology-specific-contact',
        ...(seki ? ['control-seki'] : []),
      ]),
    });
  }

  throw new Error(`Controlled endgame seed failed acceptance invariants: ${testId}`);
};