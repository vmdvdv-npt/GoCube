import {
  externalCorpusCaseCount,
  importExternalCorpusCase,
} from './ExternalCorpusImporter';
import {
  makeTestCaseIdentity,
  type ReferenceStatus,
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

/**
 * Returns a stable planar corpus for Work 1 external-solver comparison.
 *
 * The canonical source positions already live in ExternalCorpusImporter. We
 * intentionally export those original planar positions rather than a Cube or
 * Torus embedding, so every external solver receives exactly the same Go
 * problem. The topology-specific comparison happens later through metamorphic
 * tests of the graph-native GoCube engine, not by pretending that conventional
 * SGF can encode Cube/Torus adjacency.
 */
export const buildReuseSpikeCorpus = (): readonly ReuseSpikeCorpusCase[] =>
  Object.freeze(
    Array.from({ length: externalCorpusCaseCount() }, (_, payload) => {
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
    }),
  );
