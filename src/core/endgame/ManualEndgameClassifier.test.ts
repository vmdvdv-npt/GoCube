import { describe, expect, it } from 'vitest';
import { ChineseScoring } from '../scoring/ChineseScoring';
import { JapaneseScoring } from '../scoring/JapaneseScoring';
import type { GameState, PointOccupancy } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import { TorusTopology } from '../topology/TorusTopology';
import {
  ManualEndgameClassifier,
  type ManualGroupDecision,
} from './ManualEndgameClassifier';

const makeState = (
  topology: Topology,
  stones: Readonly<Partial<Record<PointId, PointOccupancy>>> = {},
): GameState => {
  const board: Record<PointId, PointOccupancy> = {};
  for (const point of topology.points()) board[point] = stones[point] ?? 'empty';

  return Object.freeze({
    board: Object.freeze(board),
    currentPlayer: 'black',
    moveNumber: 0,
    consecutivePasses: 0,
    phase: 'endgame',
    captures: Object.freeze({ black: 0, white: 0 }),
  });
};

const classifySingle = async (
  status: 'alive' | 'dead' | 'seki',
): Promise<Awaited<ReturnType<ManualEndgameClassifier['classify']>>> => {
  const topology = new TorusTopology(9);
  const state = makeState(topology, { '4,4': 'black' });
  const points = ['4,4'] as const;
  const classifier = new ManualEndgameClassifier(state, topology, [{ points, status }]);
  return classifier.classify([points]);
};

describe('ManualEndgameClassifier', () => {
  it('classifies a group as alive using the exact user decision', async () => {
    await expect(classifySingle('alive')).resolves.toEqual([
      { points: ['4,4'], status: 'alive', source: 'user' },
    ]);
  });

  it('classifies a group as dead using the exact user decision', async () => {
    await expect(classifySingle('dead')).resolves.toEqual([
      { points: ['4,4'], status: 'dead', source: 'user' },
    ]);
  });

  it('classifies a group as seki using the exact user decision', async () => {
    await expect(classifySingle('seki')).resolves.toEqual([
      { points: ['4,4'], status: 'seki', source: 'user' },
    ]);
  });

  it('classifies multiple groups deterministically with different statuses', async () => {
    const topology = new TorusTopology(9);
    const state = makeState(topology, {
      '1,1': 'black',
      '4,4': 'white',
      '7,7': 'black',
    });
    const groups = [['7,7'], ['1,1'], ['4,4']] as const;
    const decisions = [
      { points: ['4,4'], status: 'dead' },
      { points: ['7,7'], status: 'seki' },
      { points: ['1,1'], status: 'alive' },
    ] as const;

    const first = await new ManualEndgameClassifier(state, topology, decisions).classify(groups);
    const second = await new ManualEndgameClassifier(
      state,
      topology,
      [...decisions].reverse(),
    ).classify([...groups].reverse());

    expect(first).toEqual([
      { points: ['1,1'], status: 'alive', source: 'user' },
      { points: ['4,4'], status: 'dead', source: 'user' },
      { points: ['7,7'], status: 'seki', source: 'user' },
    ]);
    expect(second).toEqual(first);
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
  });

  it('recognizes a complete group that crosses a torus wraparound seam', async () => {
    const topology = new TorusTopology(9);
    const state = makeState(topology, { '0,0': 'black', '8,0': 'black' });
    const classifier = new ManualEndgameClassifier(state, topology, [
      { points: ['8,0', '0,0'], status: 'alive' },
    ]);

    await expect(classifier.classify([['0,0', '8,0']])).resolves.toEqual([
      { points: ['0,0', '8,0'], status: 'alive', source: 'user' },
    ]);
  });

  it('produces one classification accepted unchanged by Chinese and Japanese scoring', async () => {
    const topology = new TorusTopology(9);
    const state = makeState(topology, { '0,0': 'black', '4,4': 'white' });
    const classifier = new ManualEndgameClassifier(state, topology, [
      { points: ['0,0'], status: 'alive' },
      { points: ['4,4'], status: 'dead' },
    ]);
    const classification = await classifier.classify([['0,0'], ['4,4']]);

    const chinese = new ChineseScoring(topology).score(state, classification, 0);
    const japanese = new JapaneseScoring(topology).score(state, classification, 0);

    expect(chinese.deadStones).toEqual({ black: 0, white: 1 });
    expect(japanese.deadStones).toEqual({ black: 0, white: 1 });
    expect(chinese.ruleSet).toBe('chinese');
    expect(japanese.ruleSet).toBe('japanese');
  });

  it('rejects conflicting, incomplete and invalid manual classification data predictably', async () => {
    const topology = new TorusTopology(9);
    const state = makeState(topology, { '0,0': 'black', '8,0': 'black' });
    const completeGroup = ['0,0', '8,0'] as const;

    const conflicting = new ManualEndgameClassifier(state, topology, [
      { points: completeGroup, status: 'alive' },
      { points: [...completeGroup].reverse(), status: 'dead' },
    ]);
    await expect(conflicting.classify([completeGroup])).rejects.toThrow(
      'Conflicting manual decisions for group',
    );

    const incomplete = new ManualEndgameClassifier(state, topology, [
      { points: ['0,0'], status: 'alive' },
    ]);
    await expect(incomplete.classify([['0,0']])).rejects.toThrow(
      'Requested group is not a complete stone group',
    );

    const invalidDecision = {
      points: completeGroup,
      status: 'unknown',
    } as unknown as ManualGroupDecision;
    const invalid = new ManualEndgameClassifier(state, topology, [invalidDecision]);
    await expect(invalid.classify([completeGroup])).rejects.toThrow('Invalid manual group status');
  });

  it('does not mutate GameState, board, requested groups or user decisions', async () => {
    const topology = new TorusTopology(9);
    const board: Record<PointId, PointOccupancy> = { ...makeState(topology).board };
    board['0,0'] = 'black';
    board['8,0'] = 'black';
    const state: GameState = {
      ...makeState(topology),
      board,
    };
    const group = ['8,0', '0,0'];
    const decisionPoints = ['0,0', '8,0'];
    const decisions: ManualGroupDecision[] = [{ points: decisionPoints, status: 'alive' }];
    const beforeState = JSON.stringify(state);
    const beforeGroup = JSON.stringify(group);
    const beforeDecisions = JSON.stringify(decisions);

    const result = await new ManualEndgameClassifier(state, topology, decisions).classify([group]);

    expect(JSON.stringify(state)).toBe(beforeState);
    expect(JSON.stringify(group)).toBe(beforeGroup);
    expect(JSON.stringify(decisions)).toBe(beforeDecisions);
    expect(result[0]?.points).not.toBe(group);
    expect(result[0]?.points).not.toBe(decisionPoints);
  });

  it('uses only abstract logical PointId and Topology connectivity', async () => {
    const points = ['alpha', 'beta', 'white-stone', 'void'] as const;
    const adjacency: Readonly<Record<string, readonly PointId[]>> = {
      alpha: ['beta', 'void'],
      beta: ['alpha', 'void'],
      'white-stone': ['void'],
      void: ['alpha', 'beta', 'white-stone'],
    };
    const topology: Topology = {
      id: 'abstract-test-topology',
      points: () => points,
      has: (point) => points.includes(point as (typeof points)[number]),
      neighbors: (point) => adjacency[point] ?? [],
    };
    const state = makeState(topology, {
      alpha: 'black',
      beta: 'black',
      'white-stone': 'white',
    });
    const classifier = new ManualEndgameClassifier(state, topology, [
      { points: ['beta', 'alpha'], status: 'seki' },
    ]);

    await expect(classifier.classify([['alpha', 'beta']])).resolves.toEqual([
      { points: ['alpha', 'beta'], status: 'seki', source: 'user' },
    ]);
  });
});
