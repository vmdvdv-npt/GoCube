import { GameEngine } from '../../game/GameEngine';
import type { BoardOccupancy, GameState, PointOccupancy, StoneColor } from '../../game/types';
import {
  CUBE_FACES,
  CubeTopology,
  cubePointId,
  type CubeFace,
} from '../../topology/CubeTopology';
import type { PointId, Topology } from '../../topology/Topology';
import { TorusTopology } from '../../topology/TorusTopology';
import {
  type ReferenceStatus,
  type TestCaseDiagnostics,
  type TestCaseIdentity,
  type TestCasePlanarStone,
  type TestCaseSourcePosition,
} from './TestCase';

interface CorpusRecord {
  readonly sourceId: string;
  readonly sourceTitle: string;
  readonly sourceBoardSize: number;
  readonly currentPlayer: StoneColor;
  readonly black: readonly string[];
  readonly white: readonly string[];
  readonly targets: readonly string[];
  readonly sourceAnswer?: string;
  readonly sourceStatus: ReferenceStatus;
  /**
   * The imported problem is allowed only when its complete relevant shape is
   * separated from every ordinary planar edge by this many source-board rows/
   * columns. This prevents a standard Go edge from ever becoming a Cube edge
   * or Torus seam during import.
   */
  readonly minimumSourceEdgeMargin: number;
}

/**
 * Public-domain classical positions only. The source dataset explicitly lists
 * Xuanxuan Qijing (~1347) as public domain and distributes positions without
 * modern solution trees. Catalog order is append-only because Test ID payload
 * stores the stable zero-based index.
 *
 * Source: akitaonrails/frank_go data/tsumego/collections/xxqj.sgf,
 * Xuanxuan Qijing problem 1: White to play.
 */
const CORPUS: readonly CorpusRecord[] = Object.freeze([
  Object.freeze({
    sourceId: 'xuanxuan-qijing:1',
    sourceTitle: 'Xuanxuan Qijing problem 1',
    sourceBoardSize: 19,
    currentPlayer: 'white',
    black: Object.freeze(['kj', 'ik', 'kh', 'ih', 'hj']),
    white: Object.freeze(['ji']),
    targets: Object.freeze(['ji']),
    sourceStatus: 'unknown',
    minimumSourceEdgeMargin: 2,
  }),
]);

const sgfCoordinate = (coordinate: string): Readonly<{ row: number; column: number }> => {
  if (!/^[a-s]{2}$/.test(coordinate)) {
    throw new Error(`Unsupported corpus SGF coordinate: ${coordinate}`);
  }
  return Object.freeze({
    column: coordinate.charCodeAt(0) - 97,
    row: coordinate.charCodeAt(1) - 97,
  });
};

const sourcePosition = (record: CorpusRecord): TestCaseSourcePosition => {
  const stones: TestCasePlanarStone[] = [
    ...record.black.map((coordinate) => Object.freeze({ ...sgfCoordinate(coordinate), color: 'black' as const })),
    ...record.white.map((coordinate) => Object.freeze({ ...sgfCoordinate(coordinate), color: 'white' as const })),
  ];
  return Object.freeze({
    boardSize: record.sourceBoardSize,
    currentPlayer: record.currentPlayer,
    stones: Object.freeze(stones),
    targetCoordinates: Object.freeze(record.targets.map(sgfCoordinate)),
  });
};

const sourceBounds = (
  position: TestCaseSourcePosition,
): Readonly<{ minRow: number; maxRow: number; minColumn: number; maxColumn: number }> => {
  const coordinates = [
    ...position.stones.map(({ row, column }) => ({ row, column })),
    ...position.targetCoordinates,
  ];
  if (coordinates.length === 0) throw new Error('Corpus record has no relevant coordinates');
  return Object.freeze({
    minRow: Math.min(...coordinates.map(({ row }) => row)),
    maxRow: Math.max(...coordinates.map(({ row }) => row)),
    minColumn: Math.min(...coordinates.map(({ column }) => column)),
    maxColumn: Math.max(...coordinates.map(({ column }) => column)),
  });
};

export const assertCentralPlanarCorpusRecord = (recordIndex: number): void => {
  const record = CORPUS[recordIndex];
  if (!record) throw new Error(`Unknown external corpus case index: ${String(recordIndex)}`);
  const position = sourcePosition(record);
  const bounds = sourceBounds(position);
  const last = record.sourceBoardSize - 1;
  const margin = record.minimumSourceEdgeMargin;
  if (
    bounds.minRow < margin ||
    bounds.minColumn < margin ||
    last - bounds.maxRow < margin ||
    last - bounds.maxColumn < margin
  ) {
    throw new Error(
      `${record.sourceId} is edge-dependent and is forbidden by the central planar corpus gate`,
    );
  }
};

const normalize = (
  position: TestCaseSourcePosition,
): Readonly<{
  width: number;
  height: number;
  stones: readonly TestCasePlanarStone[];
  targets: readonly Readonly<{ row: number; column: number }>[];
}> => {
  const bounds = sourceBounds(position);
  return Object.freeze({
    width: bounds.maxColumn - bounds.minColumn + 1,
    height: bounds.maxRow - bounds.minRow + 1,
    stones: Object.freeze(
      position.stones.map((stone) =>
        Object.freeze({
          ...stone,
          row: stone.row - bounds.minRow,
          column: stone.column - bounds.minColumn,
        }),
      ),
    ),
    targets: Object.freeze(
      position.targetCoordinates.map(({ row, column }) =>
        Object.freeze({ row: row - bounds.minRow, column: column - bounds.minColumn }),
      ),
    ),
  });
};

const transformCoordinate = (
  row: number,
  column: number,
  width: number,
  height: number,
  symmetry: number,
): Readonly<{ row: number; column: number; width: number; height: number }> => {
  if (!Number.isSafeInteger(symmetry) || symmetry < 0 || symmetry > 7) {
    throw new Error(`Corpus symmetry must be 0..7, got ${String(symmetry)}`);
  }

  let x = column;
  let y = row;
  let w = width;
  let h = height;
  const mirrored = symmetry >= 4;
  const rotation = symmetry % 4;
  if (mirrored) x = w - 1 - x;

  for (let step = 0; step < rotation; step += 1) {
    const nextX = h - 1 - y;
    const nextY = x;
    x = nextX;
    y = nextY;
    [w, h] = [h, w];
  }

  return Object.freeze({ row: y, column: x, width: w, height: h });
};

const transformedShape = (
  record: CorpusRecord,
  symmetry: number,
) => {
  const normalized = normalize(sourcePosition(record));
  const transformStone = (stone: TestCasePlanarStone): TestCasePlanarStone => {
    const transformed = transformCoordinate(
      stone.row,
      stone.column,
      normalized.width,
      normalized.height,
      symmetry,
    );
    return Object.freeze({ row: transformed.row, column: transformed.column, color: stone.color });
  };
  const transformTarget = (target: Readonly<{ row: number; column: number }>) => {
    const transformed = transformCoordinate(
      target.row,
      target.column,
      normalized.width,
      normalized.height,
      symmetry,
    );
    return Object.freeze({ row: transformed.row, column: transformed.column });
  };
  const extent = transformCoordinate(0, 0, normalized.width, normalized.height, symmetry);
  return Object.freeze({
    width: extent.width,
    height: extent.height,
    stones: Object.freeze(normalized.stones.map(transformStone)),
    targets: Object.freeze(normalized.targets.map(transformTarget)),
  });
};

const freezeBoard = (
  topology: Topology,
  placements: ReadonlyArray<Readonly<{ point: PointId; color: StoneColor }>>,
): BoardOccupancy => {
  const board: Record<PointId, PointOccupancy> = {};
  for (const point of topology.points()) board[point] = 'empty';
  for (const placement of placements) {
    if (!topology.has(placement.point)) {
      throw new Error(`Corpus importer mapped to unknown point: ${placement.point}`);
    }
    if (board[placement.point] !== 'empty') {
      throw new Error(`Corpus importer produced duplicate point: ${placement.point}`);
    }
    board[placement.point] = placement.color;
  }
  return Object.freeze(board);
};

const validatePlayableGroups = (topology: Topology, state: GameState): void => {
  const engine = new GameEngine(topology);
  const visited = new Set<PointId>();
  for (const point of topology.points()) {
    if (visited.has(point) || state.board[point] === 'empty') continue;
    const group = engine.groupAt(state, point);
    if (!group) throw new Error(`Corpus importer could not collect group at ${point}`);
    for (const groupPoint of group.points) visited.add(groupPoint);
    if (group.liberties.length === 0) {
      throw new Error(`Corpus importer produced a zero-liberty group at ${point}`);
    }
  }
};

const centeredOffset = (container: number, extent: number): number =>
  Math.floor((container - extent) / 2);

export interface ImportedCorpusCase {
  readonly state: GameState;
  readonly topology: Topology;
  readonly targetPoints: readonly PointId[];
  readonly diagnostics: TestCaseDiagnostics;
  readonly scenario: string;
  readonly tags: readonly string[];
}

export const externalCorpusCaseCount = (): number => CORPUS.length;

/**
 * Import only a catalog record that passed the source-board central gate, then
 * embed its full relevant shape into a planar-equivalent interior region. Cube
 * cases stay entirely on one face; Torus cases stay clear of wrap seams.
 */
export const importExternalCorpusCase = (identity: TestCaseIdentity): ImportedCorpusCase => {
  if (identity.source !== 'corpus') throw new Error('ExternalCorpusImporter requires a corpus Test ID');
  const record = CORPUS[identity.payload];
  if (!record) throw new Error(`Unknown external corpus case index: ${String(identity.payload)}`);
  assertCentralPlanarCorpusRecord(identity.payload);

  const original = sourcePosition(record);
  let topology: Topology;
  let symmetry: number;
  let pointFor: (row: number, column: number) => PointId;

  if (identity.topology === 'torus') {
    topology = new TorusTopology(identity.size as 9 | 13 | 19);
    if (identity.transform < 0 || identity.transform > 7) {
      throw new Error('Torus corpus transform must encode one planar symmetry (0..7)');
    }
    symmetry = identity.transform;
    const shape = transformedShape(record, symmetry);
    if (shape.width + 2 > identity.size || shape.height + 2 > identity.size) {
      throw new Error(`${record.sourceId} cannot fit inside Torus ${identity.size} with seam safety margin`);
    }
    const offsetColumn = centeredOffset(identity.size, shape.width);
    const offsetRow = centeredOffset(identity.size, shape.height);
    if (offsetColumn < 1 || offsetRow < 1) {
      throw new Error('Corpus Torus placement would touch a wrap seam');
    }
    pointFor = (row, column) => `${offsetColumn + column},${offsetRow + row}`;
  } else {
    topology = new CubeTopology(identity.size);
    if (identity.transform < 0 || identity.transform >= CUBE_FACES.length * 8) {
      throw new Error('Cube corpus transform must encode face + symmetry (0..47)');
    }
    const face = CUBE_FACES[Math.floor(identity.transform / 8)] as CubeFace;
    symmetry = identity.transform % 8;
    const shape = transformedShape(record, symmetry);
    if (shape.width + 2 > identity.size || shape.height + 2 > identity.size) {
      throw new Error(`${record.sourceId} cannot fit inside Cube ${identity.size} face with edge safety margin`);
    }
    const offsetColumn = centeredOffset(identity.size, shape.width);
    const offsetRow = centeredOffset(identity.size, shape.height);
    if (offsetColumn < 1 || offsetRow < 1) {
      throw new Error('Corpus Cube placement would touch a face edge');
    }
    pointFor = (row, column) => cubePointId(face, offsetRow + row, offsetColumn + column);
  }

  const shape = transformedShape(record, symmetry);
  const placements = shape.stones.map((stone) =>
    Object.freeze({ point: pointFor(stone.row, stone.column), color: stone.color }),
  );
  const targetPoints = Object.freeze(shape.targets.map((target) => pointFor(target.row, target.column)));
  const state: GameState = Object.freeze({
    board: freezeBoard(topology, placements),
    currentPlayer: record.currentPlayer,
    moveNumber: 0,
    consecutivePasses: 0,
    phase: 'playing',
    captures: Object.freeze({ black: 0, white: 0 }),
  });
  validatePlayableGroups(topology, state);

  return Object.freeze({
    state,
    topology,
    targetPoints,
    diagnostics: Object.freeze({
      sourceId: record.sourceId,
      ...(record.sourceAnswer ? { sourceAnswer: record.sourceAnswer } : {}),
      sourceStatus: record.sourceStatus,
      kataGoStatus: 'unavailable',
      cubeGoStatus: 'unresolved',
      attention: true,
      attentionReason: 'KataGo and Cube Go diagnostics have not been evaluated yet.',
      sourcePosition: original,
    }),
    scenario: record.sourceTitle,
    tags: Object.freeze(['external-corpus', 'central-planar-equivalent', record.sourceId]),
  });
};
