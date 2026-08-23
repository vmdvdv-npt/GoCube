export type ReuseSpikeReferenceStatus = 'alive' | 'dead' | 'seki' | 'unknown';

export interface ReuseSpikePlanarStone {
  readonly row: number;
  readonly column: number;
  readonly color: 'black' | 'white';
}

export interface ReuseSpikeSourcePosition {
  readonly boardSize: number;
  readonly currentPlayer: 'black' | 'white';
  readonly stones: readonly ReuseSpikePlanarStone[];
  readonly targetCoordinates: readonly Readonly<{ row: number; column: number }>[];
}

export interface ReuseSpikeCorpusCase {
  readonly id: string;
  readonly sourceStatus: ReuseSpikeReferenceStatus;
  readonly position: ReuseSpikeSourcePosition;
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
  position: ReuseSpikeSourcePosition,
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
  currentPlayer: ReuseSpikeSourcePosition['currentPlayer'],
  stones: readonly ReuseSpikePlanarStone[],
  targetCoordinates: readonly Readonly<{ row: number; column: number }>[],
): ReuseSpikeSourcePosition =>
  Object.freeze({
    boardSize: 9,
    currentPlayer,
    stones: Object.freeze(stones.map((stone) => Object.freeze({ ...stone }))),
    targetCoordinates: Object.freeze(
      targetCoordinates.map((target) => Object.freeze({ ...target })),
    ),
  });

const forcedCapturePosition = (): ReuseSpikeSourcePosition =>
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

const twoEyeAlivePosition = (): ReuseSpikeSourcePosition => {
  const stones: ReuseSpikePlanarStone[] = [];

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
  sourceStatus: 'alive' | 'dead',
  position: ReuseSpikeSourcePosition,
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
 * Returns the small independent Work 1 known-answer corpus used by the reuse
 * spike benchmark. The obsolete interactive external-corpus/Test-ID catalog is
 * deliberately not part of this automated benchmark corpus.
 */
export const buildReuseSpikeCorpus = (): readonly ReuseSpikeCorpusCase[] => WORK1_KNOWN_CASES;
