import {
  externalCorpusCaseCount,
  importExternalCorpusCase,
} from './ExternalCorpusImporter';
import {
  makeTestCaseIdentity,
  type ReferenceStatus,
  type TestCasePlanarStone,
  type TestCaseSourcePosition,
} from './TestCase';

export interface ReuseSpikeCorpusCase {
  readonly id: string;
  readonly sourceStatus: ReferenceStatus;
  readonly position: TestCaseSourcePosition;
  readonly sgf: string;
}

const sgfCoordinate = (row: number, column: number): string => {
  if (
    !Number.isSafeInteger(row) ||
    !Number.isSafeInteger(column) ||
    row < 0 ||
    column < 0 ||
    row >= 26 ||
    column >= 26
  ) {
    throw new Error(`Reuse-spike SGF coordinate is out of range: ${String(column)},${String(row)}`);
  }

  return `${String.fromCharCode(97 + column)}${String.fromCharCode(97 + row)}`;
};

const sgfPointList = (
  coordinates: readonly Readonly<{ row: number; column: number }>[],
): string => coordinates.map(({ row, column }) => `[${sgfCoordinate(row, column)}]`).join('');

export const serializeReuseSpikePositionAsSgf = (
  position: TestCaseSourcePosition,
): string => {
  const black = position.stones
    .filter(({ color }) => color === 'black')
    .map(({ row, column }) => ({ row, column }));
  const white = position.stones
    .filter(({ color }) => color === 'white')
    .map(({ row, column }) => ({ row, column }));
  const player = position.currentPlayer === 'black' ? 'B' : 'W';

  return [
    '(;FF[4]',
    'GM[1]',
    `SZ[${String(position.boardSize)}]`,
    `PL[${player}]`,
    black.length > 0 ? `AB${sgfPointList(black)}` : '',
    white.length > 0 ? `AW${sgfPointList(white)}` : '',
    position.targetCoordinates.length > 0
      ? `MA${sgfPointList(position.targetCoordinates)}`
      : '',
    ')',
  ].join('');
};

const freezePosition = (
  currentPlayer: TestCaseSourcePosition['currentPlayer'],
  stones: readonly TestCasePlanarStone[],
  targetCoordinates: readonly Readonly<{ row: number; column: number }>[],
): TestCaseSourcePosition =>
  Object.freeze({
    boardSize: 9,
    currentPlayer,
    stones: Object.freeze(stones.map((stone) => Object.freeze({ ...stone }))),
    targetCoordinates: Object.freeze(
      targetCoordinates.map((target) => Object.freeze({ ...target })),
    ),
  });

const forcedCapturePosition = (): TestCaseSourcePosition =>
  freezePosition(
    'white',
    [
      { row: 4, column: 4, color: 'black' },
      { row: 3, column: 4, color: 'white' },
      { row: 4, column: 3, color: 'white' },
      { row: 4, column: 5, color: 'white' },
    ],
    [{ row: 4, column: 4 }],
  );

const twoEyeAlivePosition = (): TestCaseSourcePosition => {
  const stones: TestCasePlanarStone[] = [];

  // Connected 3x5 black block with two one-point internal eyes.
  for (let row = 2; row <= 4; row += 1) {
    for (let column = 2; column <= 6; column += 1) {
      const isEye = row === 3 && (column === 3 || column === 5);
      if (!isEye) stones.push({ row, column, color: 'black' });
    }
  }

  // White surround removes every exterior liberty while leaving the two eyes.
  for (let column = 2; column <= 6; column += 1) {
    stones.push({ row: 1, column, color: 'white' });
    stones.push({ row: 5, column, color: 'white' });
  }
  for (let row = 2; row <= 4; row += 1) {
    stones.push({ row, column: 1, color: 'white' });
    stones.push({ row, column: 7, color: 'white' });
  }

  return freezePosition('white', stones, [{ row: 2, column: 2 }]);
};

const knownCase = (
  id: string,
  sourceStatus: Extract<ReferenceStatus, 'alive' | 'dead'>,
  position: TestCaseSourcePosition,
): ReuseSpikeCorpusCase =>
  Object.freeze({
    id,
    sourceStatus,
    position,
    sgf: serializeReuseSpikePositionAsSgf(position),
  });

const WORK1_KNOWN_CASES: readonly ReuseSpikeCorpusCase[] = Object.freeze([
  knownCase('work1:forced-capture', 'dead', forcedCapturePosition()),
  knownCase('work1:two-eye-alive', 'alive', twoEyeAlivePosition()),
]);

export const reuseSpikeKnownCaseCount = (): number => WORK1_KNOWN_CASES.length;

/**
 * Returns a stable planar corpus for Work 1 external-solver comparison.
 *
 * The external catalog positions are exported in their original planar form,
 * not embedded into Cube/Torus. Two tiny hand-authored known-answer sanity
 * fixtures are appended so the same run has at least a minimal accuracy signal
 * in addition to performance measurements. Topology-specific comparison happens
 * later through metamorphic tests of the graph-native GoCube engine, not by
 * pretending that conventional SGF can encode Cube/Torus adjacency.
 */
export const buildReuseSpikeCorpus = (): readonly ReuseSpikeCorpusCase[] => {
  const externalCases = Array.from(
    { length: externalCorpusCaseCount() },
    (_, payload) => {
      const imported = importExternalCorpusCase(
        makeTestCaseIdentity({
          source: 'corpus',
          topology: 'torus',
          size: 19,
          variant: 0,
          transform: 0,
          payload,
        }),
      );
      const diagnostics = imported.diagnostics;
      const position = diagnostics.sourcePosition;

      return Object.freeze({
        id: diagnostics.sourceId,
        sourceStatus: diagnostics.sourceStatus,
        position,
        sgf: serializeReuseSpikePositionAsSgf(position),
      });
    },
  );

  return Object.freeze([...externalCases, ...WORK1_KNOWN_CASES]);
};
