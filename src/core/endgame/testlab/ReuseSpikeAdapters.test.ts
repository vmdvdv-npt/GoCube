import { describe, expect, it } from 'vitest';
import {
  createCameronMartinReuseSpikeAdapter,
  createDarkforestReuseSpikeAdapter,
  createRelevanceZoneReuseSpikeAdapter,
  createTsumegoJsReuseSpikeAdapter,
} from './ReuseSpikeAdapters';
import type { ReuseSpikeCorpusCase } from './ReuseSpikeCorpus';

const problem = (
  currentPlayer: 'black' | 'white' = 'black',
  targetColor: 'black' | 'white' = 'black',
): ReuseSpikeCorpusCase =>
  Object.freeze({
    id: 'fixture',
    sourceStatus: 'unknown',
    position: Object.freeze({
      boardSize: 9,
      currentPlayer,
      stones: Object.freeze([{ row: 1, column: 1, color: targetColor }]),
      targetCoordinates: Object.freeze([{ row: 1, column: 1 }]),
    }),
    sgf: `(;FF[4]GM[1]SZ[9]PL[${currentPlayer === 'black' ? 'B' : 'W'}]${
      targetColor === 'black' ? 'AB' : 'AW'
    }[bb]MA[bb])`,
  });

describe('ReuseSpikeAdapters', () => {
  it('normalizes tsumego.js attacker and defender solutions conservatively', async () => {
    const calls: string[] = [];
    const adapter = createTsumegoJsReuseSpikeAdapter('1.1.0', () => ({
      solve(player) {
        calls.push(player);
        return player === 'W' ? 'W[aa]' : '';
      },
    }));

    await expect(adapter.solve(problem('black', 'black'))).resolves.toMatchObject({
      outcome: 'target-captured',
      move: 'W[aa]',
    });
    expect(calls).toEqual(['W', 'B']);
  });

  it('does not guess when tsumego.js gives ambiguous answers', async () => {
    const adapter = createTsumegoJsReuseSpikeAdapter('1.1.0', () => ({
      solve(player) {
        return `${player}[]`;
      },
    }));

    await expect(adapter.solve(problem())).resolves.toMatchObject({
      outcome: 'unknown',
      detail: 'attacker and defender both report a solution',
    });
  });

  it('maps Cameron-Martin proof/disproof relative to target color and side to move', async () => {
    const attackerAdapter = createCameronMartinReuseSpikeAdapter('fixture', async () => ({
      solved: true,
      proved: true,
      nodes: 42,
    }));
    const defenderAdapter = createCameronMartinReuseSpikeAdapter('fixture', async () => ({
      solved: true,
      proved: true,
    }));

    await expect(attackerAdapter.solve(problem('white', 'black'))).resolves.toMatchObject({
      outcome: 'target-captured',
      nodes: 42,
    });
    await expect(defenderAdapter.solve(problem('black', 'black'))).resolves.toMatchObject({
      outcome: 'target-survives',
    });
  });

  it('preserves RZ ko dependence instead of forcing life or death', async () => {
    const adapter = createRelevanceZoneReuseSpikeAdapter('fixture', async () => ({
      winner: 'black',
      koDependent: true,
      nodes: 123,
    }));

    await expect(adapter.solve(problem())).resolves.toMatchObject({
      outcome: 'ko-dependent',
      nodes: 123,
    });
  });

  it('maps complete Darkforest target fate and keeps incomplete search unknown', async () => {
    const complete = createDarkforestReuseSpikeAdapter('fixture', async () => ({
      complete: true,
      targetLives: false,
      nodes: 8,
    }));
    const incomplete = createDarkforestReuseSpikeAdapter('fixture', async () => ({
      complete: false,
      targetLives: false,
    }));

    await expect(complete.solve(problem())).resolves.toMatchObject({
      outcome: 'target-captured',
      nodes: 8,
    });
    await expect(incomplete.solve(problem())).resolves.toMatchObject({
      outcome: 'unknown',
    });
  });

  it('rejects empty marked targets for every adapter', async () => {
    const empty = Object.freeze({
      ...problem(),
      position: Object.freeze({ ...problem().position, targetCoordinates: Object.freeze([]) }),
    });

    const adapters = [
      createTsumegoJsReuseSpikeAdapter('x', () => ({ solve: () => '' })),
      createCameronMartinReuseSpikeAdapter('x', async () => ({ solved: false })),
      createRelevanceZoneReuseSpikeAdapter('x', async () => ({})),
      createDarkforestReuseSpikeAdapter('x', async () => ({ complete: false })),
    ];

    for (const adapter of adapters) {
      await expect(adapter.solve(empty)).resolves.toMatchObject({ outcome: 'unsupported' });
    }
  });
});
