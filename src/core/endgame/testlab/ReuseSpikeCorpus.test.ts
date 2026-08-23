import { describe, expect, it } from 'vitest';
import { externalCorpusCaseCount } from './ExternalCorpusImporter';
import {
  buildReuseSpikeCorpus,
  serializeReuseSpikePositionAsSgf,
} from './ReuseSpikeCorpus';

describe('ReuseSpikeCorpus', () => {
  it('exports every external corpus record exactly once and deterministically', () => {
    const first = buildReuseSpikeCorpus();
    const second = buildReuseSpikeCorpus();

    expect(first).toEqual(second);
    expect(first).toHaveLength(externalCorpusCaseCount());
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
