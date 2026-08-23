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
  it('normalizes tsumego.js attacker-first and defender-first solutions', async () => {
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

  it('classifies both sides winning with first move as critical', async () => {
    const adapter = createTsumegoJsReuseSpikeAdapter('1.1.0', () => ({
      solve(player) {
        return `${player}[]`;
      },
    }));

    await expect(adapter.solve(problem())).resolves.toMatchObject({
      outcome: 'critical',
    });
  });

  it('asks Cameron-Martin the same attacker-first and defender-first questions', async () => {
    const calls: string[] = [];
    const adapter = createCameronMartinReuseSpikeAdapter('fixture', async (_input, firstPlayer) => {
      calls.push(firstPlayer);
      return firstPlayer === 'white'
        ? { solved: true, firstPlayerWins: true, nodes: 42, move: 'W[aa]' }
        : { solved: true, firstPlayerWins: false, nodes: 5 };
    });

    await expect(adapter.solve(problem('black', 'black'))).resolves.toMatchObject({
      outcome: 'target-captured',
      nodes: 47,
      move: 'W[aa]',
    });
    expect(calls).toEqual(['white', 'black']);
  });

  it('recognizes defender-first proof when attacker-first is disproved', async () => {
    const adapter = createCameronMartinReuseSpikeAdapter('fixture', async (_input, firstPlayer) => ({
      solved: true,
      firstPlayerWins: firstPlayer === 'black',
    }));

    await expect(adapter.solve(problem('white', 'black'))).resolves.toMatchObject({
      outcome: 'target-survives',
    });
  });

  it('preserves RZ ko dependence instead of forcing life or death', async () => {
    const adapter = createRelevanceZoneReuseSpikeAdapter('fixture', async (_input, firstPlayer) => ({
      solved: true,
      firstPlayerWins: true,
      koDependent: firstPlayer === 'white',
      nodes: firstPlayer === 'white' ? 100 : 23,
    }));

    await expect(adapter.solve(problem())).resolves.toMatchObject({
      outcome: 'ko-dependent',
      nodes: 123,
    });
  });

  it('keeps incomplete Darkforest proof pairs unknown', async () => {
    const complete = createDarkforestReuseSpikeAdapter('fixture', async (_input, firstPlayer) => ({
      solved: true,
      firstPlayerWins: firstPlayer === 'white',
      nodes: 4,
    }));
    const incomplete = createDarkforestReuseSpikeAdapter('fixture', async (_input, firstPlayer) =>
      firstPlayer === 'white'
        ? { solved: true, firstPlayerWins: true, nodes: 4 }
        : { solved: false, nodes: 3 },
    );

    await expect(complete.solve(problem())).resolves.toMatchObject({
      outcome: 'target-captured',
      nodes: 8,
    });
    await expect(incomplete.solve(problem())).resolves.toMatchObject({
      outcome: 'unknown',
      nodes: 7,
    });
  });

  it('never promotes neither-side proof to seki automatically', async () => {
    const adapter = createDarkforestReuseSpikeAdapter('fixture', async () => ({
      solved: true,
      firstPlayerWins: false,
    }));

    await expect(adapter.solve(problem())).resolves.toMatchObject({ outcome: 'unknown' });
  });

  it('rejects empty marked targets for every adapter', async () => {
    const empty = Object.freeze({
      ...problem(),
      position: Object.freeze({ ...problem().position, targetCoordinates: Object.freeze([]) }),
    });

    const adapters = [
      createTsumegoJsReuseSpikeAdapter('x', () => ({ solve: () => '' })),
      createCameronMartinReuseSpikeAdapter('x', async () => ({ solved: false })),
      createRelevanceZoneReuseSpikeAdapter('x', async () => ({ solved: false })),
      createDarkforestReuseSpikeAdapter('x', async () => ({ solved: false })),
    ];

    for (const adapter of adapters) {
      await expect(adapter.solve(empty)).resolves.toMatchObject({ outcome: 'unsupported' });
    }
  });
});
