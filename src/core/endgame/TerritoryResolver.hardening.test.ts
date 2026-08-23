import { describe, expect, it } from 'vitest';
import type { EndgameClassification, GroupStatus } from './EndgameClassifier';
import { resolveTerritory, type TerritoryResolution } from './TerritoryResolver';
import type { GameState, PointOccupancy } from '../game/types';
import { ChineseScoring } from '../scoring/ChineseScoring';
import { JapaneseScoring } from '../scoring/JapaneseScoring';
import { CubeTopology, cubePointId, cubeStepPoint } from '../topology/CubeTopology';
import type { PointId, Topology } from '../topology/Topology';
import { TorusTopology } from '../topology/TorusTopology';

const GOSCORER_COMMIT = '0ac5f59962a9e40f39f4667645335ba5068acf86';

class GridTopology implements Topology {
  readonly id: string;
  private readonly allPoints: readonly PointId[];
  private readonly pointSet: ReadonlySet<PointId>;

  constructor(
    readonly rows: number,
    readonly columns: number,
  ) {
    this.id = `planar-grid-${rows}x${columns}`;
    this.allPoints = Object.freeze(
      Array.from({ length: rows * columns }, (_, index) =>
        GridTopology.point(Math.floor(index / columns), index % columns),
      ),
    );
    this.pointSet = new Set(this.allPoints);
  }

  static point(row: number, column: number): PointId {
    return `${row}:${column}`;
  }

  points(): readonly PointId[] {
    return this.allPoints;
  }

  has(point: PointId): boolean {
    return this.pointSet.has(point);
  }

  neighbors(point: PointId): readonly PointId[] {
    if (!this.has(point)) throw new Error(`Unknown grid point: ${point}`);
    const [rowText, columnText] = point.split(':');
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

class GraphTopology implements Topology {
  readonly id = 'work8c-isomorphic-graph';
  private readonly allPoints: readonly PointId[];

  constructor(
    private readonly adjacency: Readonly<Record<PointId, readonly PointId[]>>,
    reverseIteration = false,
  ) {
    const points = Object.keys(adjacency);
    this.allPoints = Object.freeze(reverseIteration ? points.reverse() : points);
    this.reverseIteration = reverseIteration;
  }

  private readonly reverseIteration: boolean;

  points(): readonly PointId[] {
    return this.allPoints;
  }

  has(point: PointId): boolean {
    return Object.prototype.hasOwnProperty.call(this.adjacency, point);
  }

  neighbors(point: PointId): readonly PointId[] {
    const neighbors = this.adjacency[point];
    if (!neighbors) throw new Error(`Unknown graph point: ${point}`);
    return this.reverseIteration ? Object.freeze([...neighbors].reverse()) : neighbors;
  }
}

class CountingTopology implements Topology {
  readonly id: string;
  neighborCalls = 0;

  constructor(private readonly inner: Topology) {
    this.id = `counting:${inner.id}`;
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
  fill: PointOccupancy,
  overrides: Readonly<Record<PointId, PointOccupancy>> = {},
  captures: Readonly<{ black: number; white: number }> = { black: 0, white: 0 },
): GameState => {
  const board: Record<PointId, PointOccupancy> = {};
  for (const point of topology.points()) board[point] = fill;
  Object.assign(board, overrides);

  return Object.freeze({
    board: Object.freeze(board),
    currentPlayer: 'black',
    moveNumber: 0,
    consecutivePasses: 2,
    phase: 'endgame',
    captures: Object.freeze({ ...captures }),
  });
};

const makeClassification = (
  entries: readonly Readonly<{ points: readonly PointId[]; status: GroupStatus }>[],
): EndgameClassification =>
  Object.freeze(
    entries.map((entry) =>
      Object.freeze({
        points: Object.freeze([...entry.points]),
        status: entry.status,
        source: 'user' as const,
      }),
    ),
  );

const ownerAt = (resolution: TerritoryResolution, point: PointId) => {
  const regionKey = resolution.regionByPoint.get(point);
  if (!regionKey) throw new Error(`Point is not in resolved territory: ${point}`);
  const region = resolution.regions.find((candidate) => candidate.key === regionKey);
  if (!region) throw new Error(`Missing resolved region: ${regionKey}`);
  return region.owner;
};

const canonicalFacts = (
  resolution: TerritoryResolution,
  canonicalPoint: (point: PointId) => string = (point) => point,
) =>
  resolution.regions
    .map((region) =>
      Object.freeze({
        points: Object.freeze(region.points.map(canonicalPoint).sort()),
        borderingColors: Object.freeze([...region.borderingColors]),
        borderingGroupCount: region.borderingGroups.length,
        touchesSeki: region.touchesSeki,
        owner: region.owner,
      }),
    )
    .sort((left, right) => JSON.stringify(left.points).localeCompare(JSON.stringify(right.points)));

const stateFromPlanarRows = (rows: readonly string[]) => {
  const topology = new GridTopology(rows.length, rows[0]?.length ?? 0);
  const overrides: Record<PointId, PointOccupancy> = {};
  for (let row = 0; row < rows.length; row += 1) {
    for (let column = 0; column < rows[row]!.length; column += 1) {
      const point = GridTopology.point(row, column);
      const cell = rows[row]![column];
      if (cell === 'x') overrides[point] = 'black';
      else if (cell === 'o') overrides[point] = 'white';
      else if (cell === '.') overrides[point] = 'empty';
      else throw new Error(`Unsupported planar fixture cell: ${String(cell)}`);
    }
  }
  return Object.freeze({ topology, state: makeState(topology, 'empty', overrides) });
};

describe('TerritoryResolver Work 8C hardening + differential', () => {
  it('matches the pinned goscorer planar basic territory map where seki/false-eye semantics are absent', () => {
    // Pinned oracle: lightvector/goscorer @ GOSCORER_COMMIT,
    // python/expected_test_output/test_basic.txt. This upstream fixture has no
    // detected seki or false-eye overrides, so ordinary empty-region ownership
    // is a semantics-compatible differential for TerritoryResolver.
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
    const goscorerTerritoryRows = Object.freeze([
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
    const expected = { BLACK: 0, WHITE: 0, NEUTRAL: 0 };

    for (let row = 0; row < boardRows.length; row += 1) {
      for (let column = 0; column < boardRows[row]!.length; column += 1) {
        if (boardRows[row]![column] !== '.') continue;
        const oracleCell = goscorerTerritoryRows[row]![column];
        const oracleOwner = oracleCell === 'z' ? 'BLACK' : oracleCell === 'a' ? 'WHITE' : 'NEUTRAL';
        expect(ownerAt(resolution, GridTopology.point(row, column))).toBe(oracleOwner);
        expected[oracleOwner] += 1;
      }
    }

    expect(GOSCORER_COMMIT).toBe('0ac5f59962a9e40f39f4667645335ba5068acf86');
    expect(expected).toEqual({ BLACK: 10, WHITE: 19, NEUTRAL: 28 });

    const chinese = new ChineseScoring(topology).score(state, Object.freeze([]), 0);
    const japanese = new JapaneseScoring(topology).score(state, Object.freeze([]), 0);
    for (const score of [chinese, japanese]) {
      expect(score.territory).toEqual({ black: 10, white: 19, neutral: 28, seki: 0 });
    }
  });

  it('preserves the same territory facts across an interior Torus region and the wraparound seam', () => {
    const topology = new TorusTopology(9);
    const interior = makeState(topology, 'black', { '4,4': 'empty', '5,4': 'empty' });
    const seam = makeState(topology, 'black', { '0,4': 'empty', '8,4': 'empty' });

    const [interiorRegion] = resolveTerritory(interior, Object.freeze([]), topology).regions;
    const [seamRegion] = resolveTerritory(seam, Object.freeze([]), topology).regions;

    expect(interiorRegion).toMatchObject({
      borderingColors: ['black'],
      touchesSeki: false,
      owner: 'BLACK',
    });
    expect(seamRegion).toMatchObject({
      borderingColors: ['black'],
      touchesSeki: false,
      owner: 'BLACK',
    });
    expect(interiorRegion.points).toHaveLength(2);
    expect(seamRegion.points).toHaveLength(2);

    expect(new ChineseScoring(topology).score(interior, Object.freeze([]), 0).black).toBe(
      new ChineseScoring(topology).score(seam, Object.freeze([]), 0).black,
    );
    expect(new JapaneseScoring(topology).score(interior, Object.freeze([]), 0).black).toBe(
      new JapaneseScoring(topology).score(seam, Object.freeze([]), 0).black,
    );
  });

  it('resolves empty regions across a Cube face edge and a three-face physical corner', () => {
    const topology = new CubeTopology(5);
    const edgeStart = cubePointId('front', 2, 0);
    const edgePeer = cubeStepPoint(5, edgeStart, 'left');
    const edgeState = makeState(topology, 'black', {
      [edgeStart]: 'empty',
      [edgePeer]: 'empty',
    });
    const [edgeRegion] = resolveTerritory(edgeState, Object.freeze([]), topology).regions;

    expect(edgePeer.startsWith('left:')).toBe(true);
    expect(edgeRegion.points).toEqual(expect.arrayContaining([edgeStart, edgePeer]));
    expect(edgeRegion.points).toHaveLength(2);
    expect(edgeRegion).toMatchObject({
      borderingColors: ['black'],
      touchesSeki: false,
      owner: 'BLACK',
    });

    const corner = cubePointId('front', 0, 0);
    const topPeer = cubeStepPoint(5, corner, 'top');
    const leftPeer = cubeStepPoint(5, corner, 'left');
    const cornerState = makeState(topology, 'black', {
      [corner]: 'empty',
      [topPeer]: 'empty',
      [leftPeer]: 'empty',
    });
    const [cornerRegion] = resolveTerritory(cornerState, Object.freeze([]), topology).regions;

    expect(new Set([corner.split(':')[0], topPeer.split(':')[0], leftPeer.split(':')[0]]).size).toBe(3);
    expect(cornerRegion.points).toEqual(expect.arrayContaining([corner, topPeer, leftPeer]));
    expect(cornerRegion.points).toHaveLength(3);
    expect(cornerRegion).toMatchObject({
      borderingColors: ['black'],
      touchesSeki: false,
      owner: 'BLACK',
    });
  });

  it('is invariant under graph isomorphism, point-order reversal, neighbor-order reversal and classification permutation', () => {
    const sourceAdjacency = Object.freeze({
      b1: Object.freeze(['e1']),
      e1: Object.freeze(['b1', 'dw']),
      dw: Object.freeze(['e1', 'e2']),
      e2: Object.freeze(['dw', 'b2', 'sb']),
      b2: Object.freeze(['e2']),
      sb: Object.freeze(['e2']),
    });
    const sourceTopology = new GraphTopology(sourceAdjacency);
    const sourceState = makeState(sourceTopology, 'empty', {
      b1: 'black',
      e1: 'empty',
      dw: 'white',
      e2: 'empty',
      b2: 'black',
      sb: 'black',
    });
    const sourceClassification = makeClassification([
      { points: ['dw'], status: 'dead' },
      { points: ['sb'], status: 'seki' },
      { points: ['b1', 'b2'], status: 'alive' },
    ]);

    const rename = Object.freeze({
      b1: 'omega',
      e1: 'portal-z',
      dw: 'captured',
      e2: 'portal-a',
      b2: 'alpha',
      sb: 'seki-node',
    } as const);
    const renamedAdjacency: Record<PointId, readonly PointId[]> = {};
    for (const [point, neighbors] of Object.entries(sourceAdjacency)) {
      renamedAdjacency[rename[point as keyof typeof rename]] = Object.freeze(
        neighbors.map((neighbor) => rename[neighbor as keyof typeof rename]),
      );
    }
    const renamedTopology = new GraphTopology(renamedAdjacency, true);
    const renamedState = makeState(renamedTopology, 'empty', {
      omega: 'black',
      'portal-z': 'empty',
      captured: 'white',
      'portal-a': 'empty',
      alpha: 'black',
      'seki-node': 'black',
    });
    const renamedClassification = makeClassification([
      { points: ['alpha', 'omega'], status: 'alive' },
      { points: ['seki-node'], status: 'seki' },
      { points: ['captured'], status: 'dead' },
    ]);
    const reverseRename = new Map(
      Object.entries(rename).map(([source, target]) => [target, source] as const),
    );

    const source = resolveTerritory(sourceState, sourceClassification, sourceTopology);
    const renamed = resolveTerritory(renamedState, renamedClassification, renamedTopology);

    expect(canonicalFacts(renamed, (point) => reverseRename.get(point) ?? point)).toEqual(
      canonicalFacts(source),
    );
    expect(canonicalFacts(source)).toEqual([
      {
        points: ['dw', 'e1', 'e2'],
        borderingColors: ['black'],
        borderingGroupCount: 3,
        touchesSeki: true,
        owner: 'NEUTRAL',
      },
    ]);
  });

  it('returns deterministic Resolver and scoring results across repeated runs', () => {
    const topology = new TorusTopology(9);
    const state = makeState(
      topology,
      'black',
      {
        '0,4': 'empty',
        '8,4': 'empty',
        '4,4': 'white',
        '2,2': 'empty',
        '2,1': 'white',
      },
      { black: 2, white: 1 },
    );
    const classification = makeClassification([
      { points: ['4,4'], status: 'dead' },
      { points: ['0,3'], status: 'seki' },
    ]);

    const expectedResolution = canonicalFacts(resolveTerritory(state, classification, topology));
    const expectedChinese = new ChineseScoring(topology).score(state, classification, 0.5);
    const expectedJapanese = new JapaneseScoring(topology).score(state, classification, 0.5);

    for (let iteration = 0; iteration < 25; iteration += 1) {
      expect(canonicalFacts(resolveTerritory(state, classification, topology))).toEqual(
        expectedResolution,
      );
      expect(new ChineseScoring(topology).score(state, classification, 0.5)).toEqual(
        expectedChinese,
      );
      expect(new JapaneseScoring(topology).score(state, classification, 0.5)).toEqual(
        expectedJapanese,
      );
    }
  });

  it('hardens the complete classification -> TerritoryResolver -> Chinese/Japanese scoring handoff', () => {
    const topology = new TorusTopology(9);
    const state = makeState(
      topology,
      'black',
      {
        '4,4': 'white',
        '0,4': 'empty',
        '2,2': 'empty',
        '2,1': 'white',
      },
      { black: 2, white: 1 },
    );
    const classification = makeClassification([
      { points: ['4,4'], status: 'dead' },
      { points: ['0,3'], status: 'seki' },
    ]);

    const resolution = resolveTerritory(state, classification, topology);
    expect(ownerAt(resolution, '4,4')).toBe('BLACK');
    expect(ownerAt(resolution, '0,4')).toBe('NEUTRAL');
    expect(ownerAt(resolution, '2,2')).toBe('NEUTRAL');
    expect(resolution.regions.find((region) => region.points.includes('0,4'))?.touchesSeki).toBe(
      true,
    );
    expect(resolution.regions.find((region) => region.points.includes('2,2'))?.touchesSeki).toBe(
      false,
    );

    const chinese = new ChineseScoring(topology).score(state, classification, 0.5);
    const japanese = new JapaneseScoring(topology).score(state, classification, 0.5);

    for (const score of [chinese, japanese]) {
      expect(score.territory).toEqual({ black: 1, white: 0, neutral: 1, seki: 1 });
      expect(score.territoryPoints.black).toEqual(['4,4']);
      expect(score.territoryPoints.neutral).toEqual(['2,2']);
      expect(score.territoryPoints.seki).toEqual(['0,4']);
      expect(score.deadStones).toEqual({ black: 0, white: 1 });
      expect(score.captures).toEqual({ black: 2, white: 1 });
    }

    expect(chinese.stonesOnBoard).toEqual({ black: 77, white: 1 });
    expect(chinese.black).toBe(78);
    expect(chinese.white).toBe(1.5);
    expect(chinese.prisoners).toBeNull();

    expect(japanese.prisoners).toEqual({ black: 3, white: 1 });
    expect(japanese.black).toBe(4);
    expect(japanese.white).toBe(1.5);
  });

  it('stays within a linear topology-neighbor acceptance budget on a 9x9 Cube surface', () => {
    const base = new CubeTopology(9);
    const topology = new CountingTopology(base);
    const overrides: Record<PointId, PointOccupancy> = {};
    base.points().forEach((point, index) => {
      overrides[point] = index % 7 === 0 ? 'empty' : index % 2 === 0 ? 'black' : 'white';
    });
    const state = makeState(topology, 'empty', overrides);

    const resolution = resolveTerritory(state, Object.freeze([]), topology);

    expect(resolution.regions.length).toBeGreaterThan(0);
    expect(topology.neighborCalls).toBeLessThanOrEqual(base.points().length * 6);
  });
});
