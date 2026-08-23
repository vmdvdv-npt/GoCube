import { describe, expect, it } from 'vitest';
import { externalCorpusCaseCount } from './ExternalCorpusImporter';
import {
  buildReuseSpikeCorpus,
  reuseSpikeKnownCaseCount,
  serializeReuseSpikePositionAsSgf,
} from './ReuseSpikeCorpus';

describe('ReuseSpikeCorpus', () => {
  it('exports every external and known-answer record exactly once and deterministically', () => {
    const first = buildReuseSpikeCorpus();
    const second = buildReuseSpikeCorpus();

    expect(first).toEqual(second);
    expect(first).toHaveLength(externalCorpusCaseCount() + reuseSpikeKnownCaseCount());
    expect(new Set(first.map(({ id }) => id)).size).toBe(first.length);
  });

  it('serializes the source position without Cube/Torus embedding', () => {
    const [problem] = buildReuseSpikeCorpus();

    expect(problem?.id).toBe('xuanxuan-qijing:1');
    expect(problem?.sourceStatus).toBe('unknown');
    expect(problem?.sgf).toBe(
      '(;FF[4]GM[1]SZ[19]PL[W]AB[kj][ik][kh][ih][hj]AW[ji]MA[ji])',
    );
  });

  it('appends a deterministic forced-capture known-answer case', () => {
    const forcedCapture = buildReuseSpikeCorpus().find(
      ({ id }) => id === 'work1:forced-capture',
    );

    expect(forcedCapture).toMatchObject({
      sourceStatus: 'dead',
      sgf: '(;FF[4]GM[1]SZ[9]PL[W]AB[ee]AW[ed][de][fe]MA[ee])',
    });
  });

  it('appends a two-eye group with exactly two protected internal liberties', () => {
    const alive = buildReuseSpikeCorpus().find(({ id }) => id === 'work1:two-eye-alive');
    expect(alive?.sourceStatus).toBe('alive');
    expect(alive?.position.currentPlayer).toBe('white');

    const black = new Set(
      alive?.position.stones
        .filter(({ color }) => color === 'black')
        .map(({ row, column }) => `${String(row)},${String(column)}`),
    );
    const white = new Set(
      alive?.position.stones
        .filter(({ color }) => color === 'white')
        .map(({ row, column }) => `${String(row)},${String(column)}`),
    );
    const liberties = new Set<string>();

    for (const key of black) {
      const [rowText, columnText] = key.split(',');
      const row = Number(rowText);
      const column = Number(columnText);
      for (const [nextRow, nextColumn] of [
        [row - 1, column],
        [row + 1, column],
        [row, column - 1],
        [row, column + 1],
      ]) {
        const neighbor = `${String(nextRow)},${String(nextColumn)}`;
        if (!black.has(neighbor) && !white.has(neighbor)) liberties.add(neighbor);
      }
    }

    expect(black.size).toBe(13);
    expect(liberties).toEqual(new Set(['3,3', '3,5']));
    expect(alive?.position.targetCoordinates).toEqual([{ row: 2, column: 2 }]);
  });

  it('keeps SGF output stable for a handcrafted source position', () => {
    expect(
      serializeReuseSpikePositionAsSgf({
        boardSize: 9,
        currentPlayer: 'black',
        stones: [
          { row: 1, column: 2, color: 'black' },
          { row: 3, column: 4, color: 'white' },
        ],
        targetCoordinates: [{ row: 3, column: 4 }],
      }),
    ).toBe('(;FF[4]GM[1]SZ[9]PL[B]AB[cb]AW[ed]MA[ed])');
  });
});
