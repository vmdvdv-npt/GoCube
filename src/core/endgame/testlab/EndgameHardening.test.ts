import { describe, expect, it } from 'vitest';
import { analyzeFinalGroupJudge } from '../AssistedEndgameClassifier';
import type {
  EndgameAnalysisContext,
  EndgameClassification,
  EndgameClassifier,
  EndgameProposal,
  GroupStatus,
} from '../EndgameClassifier';
import { ChineseScoring } from '../../scoring/ChineseScoring';
import { JapaneseScoring } from '../../scoring/JapaneseScoring';
import { CubeTopology } from '../../topology/CubeTopology';
import type { PointId, Topology } from '../../topology/Topology';
import { TorusTopology } from '../../topology/TorusTopology';
import type {
  DifferentialOracleAdapter,
  PlanarOraclePosition,
} from './DifferentialOracle';
import type { EndgameTestFixture } from './EndgameFixture';
import {
  EndgameTestLab,
  endgameTestLabSeeds,
} from './EndgameTestLab';

const AUTOMATIC_ALGORITHMS = new Set([
  'benson-pass-alive-v1',
  'sealed-single-liberty-dead-v1',
  'closed-mutual-two-liberties-seki-v1',
]);
const FALLBACK_STATUSES: readonly GroupStatus[] = Object.freeze(['alive', 'dead', 'seki']);
const STATIC_CLASSIFIER: EndgameClassifier = Object.freeze({
  async analyze(context: EndgameAnalysisContext): Promise<EndgameProposal> {
    return (await analyzeFinalGroupJudge(context)).proposal;
  },
});

const occupiedPoints = (
  fixture: EndgameTestFixture,
  topology: Topology,
): readonly PointId[] =>
  Object.freeze(
    [...topology.points()]
      .filter((point) => fixture.state.board[point] === 'black' || fixture.state.board[point] === 'white')
      .sort(),
  );

const expectSafeProposalShape = (
  fixture: EndgameTestFixture,
  topology: Topology,
  proposal: EndgameProposal,
): void => {
  const proposedPoints = proposal.flatMap((group) => group.points).sort();
  expect(proposedPoints).toEqual(occupiedPoints(fixture, topology));
  expect(new Set(proposedPoints).size).toBe(proposedPoints.length);

  for (const group of proposal) {
    expect(group.points.length).toBeGreaterThan(0);
    expect([...group.points].sort()).toEqual(group.points);

    if (group.status === 'unresolved') {
      expect(group.source).toBeUndefined();
      expect(group.evidence).toBeUndefined();
      continue;
    }

    expect(group.source).toBe('automatic');
    const algorithm = group.evidence?.algorithm;
    expect(typeof algorithm).toBe('string');
    expect(AUTOMATIC_ALGORITHMS.has(String(algorithm))).toBe(true);
  }
};

const completeClassification = (
  proposal: EndgameProposal,
): EndgameClassification =>
  Object.freeze(
    proposal.map((group, index) =>
      Object.freeze({
        points: group.points,
        status:
          group.status === 'unresolved'
            ? FALLBACK_STATUSES[index % FALLBACK_STATUSES.length]!
            : group.status,
        source: group.source === 'automatic' ? ('automatic' as const) : ('user' as const),
      }),
    ),
  );

const manualizeClassification = (
  classification: EndgameClassification,
): EndgameClassification =>
  Object.freeze(
    [...classification]
      .reverse()
      .map((group) => Object.freeze({ ...group, source: 'user' as const })),
  );

const coordinateKey = (row: number, column: number): string => `${row},${column}`;

const planarNeighbors = (
  boardSize: number,
  row: number,
  column: number,
): readonly Readonly<{ row: number; column: number }>[] =>
  Object.freeze(
    [
      [row - 1, column],
      [row, column + 1],
      [row + 1, column],
      [row, column - 1],
    ]
      .filter(([nextRow, nextColumn]) =>
        nextRow >= 0 && nextRow < boardSize && nextColumn >= 0 && nextColumn < boardSize,
      )
      .map(([nextRow, nextColumn]) => Object.freeze({ row: nextRow!, column: nextColumn! })),
  );

type StructuralReferenceResult = Readonly<{
  status: 'alive' | 'unknown';
  eyeCount: number;
}>;

const structuralTwoEyeReference = (
  position: PlanarOraclePosition,
): StructuralReferenceResult => {
  const stones = new Map(
    position.stones.map((stone) => [coordinateKey(stone.row, stone.column), stone.color] as const),
  );
  const target = position.targetCoordinates[0];
  if (!target) return Object.freeze({ status: 'unknown', eyeCount: 0 });
  const targetColor = stones.get(coordinateKey(target.row, target.column));
  if (!targetColor) return Object.freeze({ status: 'unknown', eyeCount: 0 });

  const group = new Set<string>();
  const groupQueue = [target];
  group.add(coordinateKey(target.row, target.column));
  for (let index = 0; index < groupQueue.length; index += 1) {
    const point = groupQueue[index]!;
    for (const neighbor of planarNeighbors(position.boardSize, point.row, point.column)) {
      const key = coordinateKey(neighbor.row, neighbor.column);
      if (group.has(key) || stones.get(key) !== targetColor) continue;
      group.add(key);
      groupQueue.push(neighbor);
    }
  }

  const visitedEmpty = new Set<string>();
  let eyeCount = 0;
  for (const groupKey of group) {
    const [rowText, columnText] = groupKey.split(',');
    const row = Number(rowText);
    const column = Number(columnText);
    for (const neighbor of planarNeighbors(position.boardSize, row, column)) {
      const startKey = coordinateKey(neighbor.row, neighbor.column);
      if (stones.has(startKey) || visitedEmpty.has(startKey)) continue;

      const region = [neighbor];
      const regionKeys = new Set<string>([startKey]);
      visitedEmpty.add(startKey);
      let touchesBoardEdge = false;
      let boundaryOnlyTargetColor = true;

      for (let index = 0; index < region.length; index += 1) {
        const point = region[index]!;
        if (
          point.row === 0 ||
          point.column === 0 ||
          point.row === position.boardSize - 1 ||
          point.column === position.boardSize - 1
        ) {
          touchesBoardEdge = true;
        }

        for (const next of planarNeighbors(position.boardSize, point.row, point.column)) {
          const key = coordinateKey(next.row, next.column);
          const occupancy = stones.get(key);
          if (!occupancy) {
            if (!regionKeys.has(key)) {
              regionKeys.add(key);
              visitedEmpty.add(key);
              region.push(next);
            }
            continue;
          }
          if (occupancy !== targetColor || !group.has(key)) boundaryOnlyTargetColor = false;
        }
      }

      if (!touchesBoardEdge && boundaryOnlyTargetColor) eyeCount += 1;
    }
  }

  return Object.freeze({
    status: eyeCount >= 2 ? 'alive' : 'unknown',
    eyeCount,
  });
};

const structuralReferenceAdapter: DifferentialOracleAdapter<StructuralReferenceResult> = {
  id: 'independent-planar-two-eye-reference-v1',
  async availability() {
    return { available: true, version: '1' };
  },
  async analyze(position) {
    return structuralTwoEyeReference(position);
  },
};

const centralPatternTarget = (fixture: EndgameTestFixture): PointId => {
  if (fixture.topology.kind === 'torus') {
    const coordinates = fixture.placements.map((placement) =>
      placement.point.split(',').map(Number),
    );
    const xs = coordinates.map(([x]) => x!);
    const ys = coordinates.map(([, y]) => y!);
    return `${Math.floor((Math.min(...xs) + Math.max(...xs)) / 2)},${Math.floor(
      (Math.min(...ys) + Math.max(...ys)) / 2,
    )}`;
  }

  const parsed = fixture.placements.map((placement) => {
    const [face, rowText, columnText] = placement.point.split(':');
    return { face: face!, row: Number(rowText), column: Number(columnText) };
  });
  const rows = parsed.map(({ row }) => row);
  const columns = parsed.map(({ column }) => column);
  return `${parsed[0]!.face}:${Math.floor((Math.min(...rows) + Math.max(...rows)) / 2)}:${Math.floor(
    (Math.min(...columns) + Math.max(...columns)) / 2,
  )}`;
};

const firstBlackPoint = (fixture: EndgameTestFixture): PointId => {
  const point = fixture.placements.find((placement) => placement.color === 'black')?.point;
  if (!point) throw new Error(`Fixture has no black stone: ${fixture.fixtureId}`);
  return point;
};

describe('0.3.08 stress / differential hardening', () => {
  it('runs a Full deterministic endgame sweep on Torus and Cube with replay, proposal and scoring invariants', async () => {
    const lab = new EndgameTestLab();
    const classifier = STATIC_CLASSIFIER;
    const seeds = endgameTestLabSeeds('0.3.08-full-endgame', 'Full');

    for (const seed of seeds) {
      for (const topology of [new TorusTopology(9), new CubeTopology(5)] as const) {
        const fixture = lab.generate({
          kind: 'endgame-position',
          topology,
          seed,
          maxMoves: 72,
        });
        expect(lab.replay(fixture)).toEqual(fixture);
        expect(lab.replayState(fixture)).toEqual(fixture.state);

        const proposal = await lab.analyze(fixture, classifier);
        const repeated = await lab.analyze(lab.replay(fixture), classifier);
        expect(repeated).toEqual(proposal);
        expectSafeProposalShape(fixture, topology, proposal);

        const assisted = completeClassification(proposal);
        const manual = manualizeClassification(assisted);
        expect(
          new ChineseScoring(topology).score(fixture.state, assisted, 7.5),
        ).toEqual(new ChineseScoring(topology).score(fixture.state, manual, 7.5));
        expect(
          new JapaneseScoring(topology).score(fixture.state, assisted, 7.5),
        ).toEqual(new JapaneseScoring(topology).score(fixture.state, manual, 7.5));
      }
    }
  }, 30_000);

  it('keeps a permanent fixed-seed corpus for proven and fallback classifier boundaries', async () => {
    const lab = new EndgameTestLab();
    const classifier = STATIC_CLASSIFIER;

    for (const topology of [new TorusTopology(9), new CubeTopology(5)] as const) {
      const provenAlive = lab.generate({
        kind: 'life-death-pattern',
        topology,
        seed: `regression-two-eyes-${topology.id}`,
        pattern: 'two-eyes',
      });
      const aliveProposal = await lab.analyze(provenAlive, classifier);
      expect(aliveProposal).toHaveLength(1);
      expect(aliveProposal[0]).toMatchObject({
        status: 'alive',
        source: 'automatic',
        evidence: { algorithm: 'benson-pass-alive-v1' },
      });

      for (const pattern of ['single-eye', 'false-eye', 'atari-group'] as const) {
        const fixture = lab.generate({
          kind: 'life-death-pattern',
          topology,
          seed: `regression-${pattern}-${topology.id}`,
          pattern,
        });
        const proposal = await lab.analyze(fixture, classifier);
        expect(proposal.length).toBeGreaterThan(0);
        expect(proposal.every((group) => group.status === 'unresolved')).toBe(true);
      }

      for (const pattern of ['shared-liberties', 'ambiguous-contact'] as const) {
        const fixture = lab.generate({
          kind: 'seki-pattern',
          topology,
          seed: `regression-${pattern}-${topology.id}`,
          pattern,
        });
        const proposal = await lab.analyze(fixture, classifier);
        expect(proposal.length).toBeGreaterThan(0);
        expect(proposal.every((group) => group.status === 'unresolved')).toBe(true);
      }
    }
  });

  it('stress-checks conservative fallback across Torus seams and Cube edges/corners', async () => {
    const lab = new EndgameTestLab();
    const classifier = STATIC_CLASSIFIER;
    const seeds = endgameTestLabSeeds('0.3.08-topology-stress', 'Full');

    for (const seed of seeds) {
      for (const pattern of ['single-eye', 'false-eye', 'shared-liberties'] as const) {
        const torusFixture = lab.generate({
          kind: 'topology-stress',
          topology: new TorusTopology(9),
          seed,
          mode: 'torus-seam',
          pattern,
        });
        const torusProposal = await lab.analyze(torusFixture, classifier);
        expectSafeProposalShape(torusFixture, new TorusTopology(9), torusProposal);
        expect(torusProposal.every((group) => group.status === 'unresolved')).toBe(true);

        for (const mode of ['cube-edge', 'cube-corner'] as const) {
          const cubeFixture = lab.generate({
            kind: 'topology-stress',
            topology: new CubeTopology(5),
            seed,
            mode,
            pattern,
          });
          const cubeProposal = await lab.analyze(cubeFixture, classifier);
          expectSafeProposalShape(cubeFixture, new CubeTopology(5), cubeProposal);
          expect(cubeProposal.every((group) => group.status === 'unresolved')).toBe(true);
        }
      }
    }
  }, 30_000);

  it('differentially checks applicable planar Torus and Cube patterns with an independent structural eye oracle', async () => {
    const lab = new EndgameTestLab();
    const classifier = STATIC_CLASSIFIER;
    const matchedByTopology = new Map<'torus' | 'cube', number>([
      ['torus', 0],
      ['cube', 0],
    ]);

    for (const seed of endgameTestLabSeeds('0.3.08-differential', 'Quick')) {
      for (const topology of [new TorusTopology(9), new CubeTopology(9)] as const) {
        for (const pattern of ['two-eyes', 'single-eye', 'false-eye'] as const) {
          const fixture = lab.generate({
            kind: 'life-death-pattern',
            topology,
            seed: `${seed}:${pattern}`,
            pattern,
          });
          const targetPoints = [
            pattern === 'two-eyes' ? centralPatternTarget(fixture) : firstBlackPoint(fixture),
          ];
          const result = await lab.compareWithOracle(
            fixture,
            classifier,
            structuralReferenceAdapter,
            (internal, oracle) => {
              const automatic = internal.filter((group) => group.source === 'automatic');
              if (oracle.status === 'alive') {
                return automatic.length === 1 && automatic[0]?.status === 'alive';
              }
              return automatic.length === 0;
            },
            { targetPoints, radius: 3, boardSize: 19, margin: 4 },
          );

          expect(result.status).not.toBe('mismatch');
          expect(result.status).not.toBe('error');
          expect(result.status).not.toBe('unavailable');
          if (result.status === 'match') {
            matchedByTopology.set(
              fixture.topology.kind,
              (matchedByTopology.get(fixture.topology.kind) ?? 0) + 1,
            );
          }
        }
      }
    }

    expect(matchedByTopology.get('torus')).toBeGreaterThan(0);
    expect(matchedByTopology.get('cube')).toBeGreaterThan(0);
  }, 20_000);
});