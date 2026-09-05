import { describe, expect, it } from 'vitest';
import {
  AND_OR_SEARCH_ALGORITHM,
  runAndOrSearch,
  type AndOrNodeType,
  type AndOrResolvedOutcome,
  type AndOrSearchAdapter,
} from './AndOrSearchCore';

interface GraphNode {
  readonly type: AndOrNodeType;
  readonly terminal?: AndOrResolvedOutcome;
  readonly complete?: boolean;
  readonly children?: readonly (readonly [move: string, state: string])[];
}

const adapterFor = (
  graph: Readonly<Record<string, GraphNode>>,
): AndOrSearchAdapter<string> =>
  Object.freeze({
    stateKey: (state: string): string => state,
    nodeType: (state: string): AndOrNodeType => graph[state]!.type,
    terminal: (state: string): AndOrResolvedOutcome | null => graph[state]!.terminal ?? null,
    expand: (state: string) => {
      const node = graph[state]!;
      return Object.freeze({
        complete: node.complete ?? true,
        children: Object.freeze(
          (node.children ?? []).map(([move, child]) => Object.freeze({ move, state: child })),
        ),
      });
    },
  });

describe('AndOrSearchCore', () => {
  it('uses deterministic OR DFS ordering and returns a stable proof trace', () => {
    const adapter = adapterFor({
      root: { type: 'or', children: [['try-a', 'loss'], ['try-b', 'win'], ['must-not-run', 'unused']] },
      loss: { type: 'and', terminal: 'refuted' },
      win: { type: 'and', terminal: 'proved' },
      unused: { type: 'and', terminal: 'proved' },
    });
    const first = runAndOrSearch('root', adapter, { maxNodes: 10 });
    const second = runAndOrSearch('root', adapter, { maxNodes: 10 });
    expect(first).toEqual(second);
    expect(first.algorithm).toBe(AND_OR_SEARCH_ALGORITHM);
    expect(first.outcome).toBe('proved');
    expect(first.unknownReason).toBeNull();
    expect(first.exploredNodes).toBe(3);
    expect(first.trace.children.map((child) => child.move)).toEqual(['try-a', 'try-b']);
  });

  it('requires every AND continuation and reuses resolved transpositions', () => {
    const result = runAndOrSearch('root', adapterFor({
      root: { type: 'and', children: [['left-defense', 'left'], ['right-defense', 'right']] },
      left: { type: 'or', children: [['force', 'shared']] },
      right: { type: 'or', children: [['force', 'shared']] },
      shared: { type: 'and', terminal: 'proved' },
    }), { maxNodes: 10 });
    expect(result.outcome).toBe('proved');
    expect(result.exploredNodes).toBe(4);
    expect(result.transpositionHits).toBe(1);
    expect(result.trace.children[1]!.trace.children[0]!.trace.source).toBe('transposition');
  });

  it('fails closed when move generation is incomplete', () => {
    const incompleteAnd = runAndOrSearch('root', adapterFor({
      root: { type: 'and', complete: false, children: [['known-defense', 'proved']] },
      proved: { type: 'or', terminal: 'proved' },
    }), { maxNodes: 10 });
    const incompleteOr = runAndOrSearch('root', adapterFor({
      root: { type: 'or', complete: false, children: [['known-attack', 'refuted']] },
      refuted: { type: 'and', terminal: 'refuted' },
    }), { maxNodes: 10 });
    expect(incompleteAnd).toMatchObject({ outcome: 'unknown', unknownReason: 'incomplete' });
    expect(incompleteOr).toMatchObject({ outcome: 'unknown', unknownReason: 'incomplete' });
  });

  it('still permits one-sided proofs that do not depend on omitted continuations', () => {
    expect(runAndOrSearch('root', adapterFor({
      root: { type: 'or', complete: false, children: [['winning-attack', 'proved']] },
      proved: { type: 'and', terminal: 'proved' },
    }), { maxNodes: 10 }).outcome).toBe('proved');
    expect(runAndOrSearch('root', adapterFor({
      root: { type: 'and', complete: false, children: [['saving-defense', 'refuted']] },
      refuted: { type: 'or', terminal: 'refuted' },
    }), { maxNodes: 10 }).outcome).toBe('refuted');
  });

  it('returns UNKNOWN deterministically at the exact node budget', () => {
    const adapter = adapterFor({
      root: { type: 'and', children: [['first-defense', 'first'], ['second-defense', 'second']] },
      first: { type: 'or', terminal: 'proved' },
      second: { type: 'or', terminal: 'proved' },
    });
    const first = runAndOrSearch('root', adapter, { maxNodes: 2 });
    expect(first).toEqual(runAndOrSearch('root', adapter, { maxNodes: 2 }));
    expect(first).toMatchObject({ outcome: 'unknown', unknownReason: 'budget', exploredNodes: 2 });
    expect(first.trace.children[1]!.trace.source).toBe('budget');
  });

  it('treats an external wall-clock/resource stop exactly like budget exhaustion', () => {
    const result = runAndOrSearch('root', adapterFor({
      root: { type: 'and', children: [['defense', 'child']] },
      child: { type: 'or', terminal: 'proved' },
    }), { maxNodes: 10, shouldStop: () => true });
    expect(result).toMatchObject({ outcome: 'unknown', unknownReason: 'budget', exploredNodes: 0 });
    expect(result.trace.source).toBe('budget');
  });

  it('returns UNKNOWN for an unresolved cycle instead of guessing a fixed point', () => {
    const result = runAndOrSearch('root', adapterFor({ root: { type: 'or', children: [['repeat', 'root']] } }), { maxNodes: 10 });
    expect(result).toMatchObject({ outcome: 'unknown', unknownReason: 'cycle', exploredNodes: 1 });
    expect(result.trace.children[0]!.trace.source).toBe('cycle');
  });

  it('rejects invalid node budgets', () => {
    const adapter = adapterFor({ root: { type: 'or', terminal: 'proved' } });
    expect(() => runAndOrSearch('root', adapter, { maxNodes: -1 })).toThrow(RangeError);
    expect(() => runAndOrSearch('root', adapter, { maxNodes: 1.5 })).toThrow(RangeError);
  });
});