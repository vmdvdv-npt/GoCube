import { describe, expect, it } from 'vitest';
import {
  DETERMINISTIC_AND_OR_PROOF_SEARCH_ALGORITHM,
  searchDeterministicAndOrProof,
  type DeterministicProofSearchAdapter,
  type ProofSearchMoveSetCompleteness,
  type ProofSearchRole,
  type ProofSearchTerminal,
} from './DeterministicAndOrProofSearch';

interface ToyNode {
  readonly key: string;
  readonly role: ProofSearchRole;
  readonly terminal?: ProofSearchTerminal;
  readonly completeness?: ProofSearchMoveSetCompleteness;
  readonly moves?: readonly Readonly<{ readonly key: string; readonly child: ToyNode }>[];
}

type ToyMove = Readonly<{ readonly key: string; readonly child: ToyNode }>;

const terminal = (
  key: string,
  outcome: ProofSearchTerminal['outcome'],
): ToyNode =>
  Object.freeze({
    key,
    role: 'attacker' as const,
    terminal: Object.freeze({ outcome }),
  });

const adapter: DeterministicProofSearchAdapter<ToyNode, ToyMove> = Object.freeze({
  nodeKey: (node) => node.key,
  role: (node) => node.role,
  terminal: (node) => node.terminal ?? null,
  expand: (node) =>
    Object.freeze({
      moves: node.moves ?? Object.freeze([] as ToyMove[]),
      completeness:
        node.completeness ?? Object.freeze({ kind: 'complete' as const }),
    }),
  apply: (_node, move) => move.child,
  moveKey: (move) => move.key,
});

const move = (key: string, child: ToyNode): ToyMove => Object.freeze({ key, child });

const branch = (
  key: string,
  role: ProofSearchRole,
  moves: readonly ToyMove[],
  completeness: ProofSearchMoveSetCompleteness = Object.freeze({
    kind: 'complete' as const,
  }),
): ToyNode => Object.freeze({ key, role, moves: Object.freeze([...moves]), completeness });

describe('DeterministicAndOrProofSearch', () => {
  it('treats attacker nodes as OR and can prove kill from an incomplete move set', () => {
    const root = branch(
      'root',
      'attacker',
      Object.freeze([
        move('z-kill', terminal('kill', 'proven-kill')),
        move('a-live', terminal('live', 'proven-survival')),
      ]),
      Object.freeze({ kind: 'incomplete', reason: 'candidate attacks only' }),
    );

    const result = searchDeterministicAndOrProof(root, adapter);

    expect(result.algorithm).toBe(DETERMINISTIC_AND_OR_PROOF_SEARCH_ALGORITHM);
    expect(result.outcome).toBe('proven-kill');
    expect(result.reason).toBe('attacker-winning-branch');
    expect(result.principalVariation).toEqual(['z-kill']);
    expect(result.exploredNodes).toBe(3);
    expect(result.maxDepth).toBe(2);
  });

  it('does not prove attacker-side survival from an incomplete attack set', () => {
    const root = branch(
      'root',
      'attacker',
      Object.freeze([move('only-known-attack', terminal('live', 'proven-survival'))]),
      Object.freeze({ kind: 'incomplete', reason: 'not all attacks enumerated' }),
    );

    const result = searchDeterministicAndOrProof(root, adapter);

    expect(result.outcome).toBe('unresolved');
    expect(result.reason).toBe('attacker-move-set-incomplete: not all attacks enumerated');
  });

  it('treats defender nodes as AND and proves kill only when every complete defense loses', () => {
    const root = branch(
      'root',
      'defender',
      Object.freeze([
        move('b-defense', terminal('b-dead', 'proven-kill')),
        move('a-defense', terminal('a-dead', 'proven-kill')),
      ]),
    );

    const result = searchDeterministicAndOrProof(root, adapter);

    expect(result.outcome).toBe('proven-kill');
    expect(result.reason).toBe('all-proof-complete-defenses-proven-kill');
    expect(result.principalVariation).toEqual(['a-defense']);
  });

  it('does not prove defender AND kill from an incomplete defense set', () => {
    const root = branch(
      'root',
      'defender',
      Object.freeze([move('known-defense', terminal('dead', 'proven-kill'))]),
      Object.freeze({ kind: 'incomplete', reason: 'remote defenses unknown' }),
    );

    const result = searchDeterministicAndOrProof(root, adapter);

    expect(result.outcome).toBe('unresolved');
    expect(result.reason).toBe('defender-move-set-incomplete: remote defenses unknown');
  });

  it('can prove survival existentially when an incomplete defender set contains an escape', () => {
    const root = branch(
      'root',
      'defender',
      Object.freeze([move('escape', terminal('alive', 'proven-survival'))]),
      Object.freeze({ kind: 'incomplete', reason: 'other defenses omitted' }),
    );

    const result = searchDeterministicAndOrProof(root, adapter);

    expect(result.outcome).toBe('proven-survival');
    expect(result.reason).toBe('defender-survival-branch');
    expect(result.principalVariation).toEqual(['escape']);
  });

  it('accepts an explicit proof-safe pruning certificate as an AND completeness boundary', () => {
    const root = branch(
      'root',
      'defender',
      Object.freeze([
        move('local-a', terminal('a-dead', 'proven-kill')),
        move('local-b', terminal('b-dead', 'proven-kill')),
      ]),
      Object.freeze({
        kind: 'proof-safe-pruned',
        certificate: 'outside-certified-causal-cone',
      }),
    );

    const result = searchDeterministicAndOrProof(root, adapter);

    expect(result.outcome).toBe('proven-kill');
    expect(result.proofSafePruningCertificates).toEqual([
      'outside-certified-causal-cone',
    ]);
  });

  it('fails closed when proof-safe pruning has an empty certificate', () => {
    const root = branch(
      'root',
      'defender',
      Object.freeze([move('local', terminal('dead', 'proven-kill'))]),
      Object.freeze({ kind: 'proof-safe-pruned', certificate: '' }),
    );

    const result = searchDeterministicAndOrProof(root, adapter);

    expect(result.outcome).toBe('unresolved');
    expect(result.reason).toBe('defender-move-set-missing-pruning-certificate');
    expect(result.proofSafePruningCertificates).toEqual([]);
  });

  it('propagates budget exhaustion instead of guessing a later attacker win', () => {
    const root = branch(
      'root',
      'attacker',
      Object.freeze([
        move('z-kill', terminal('kill', 'proven-kill')),
        move('a-live', terminal('live', 'proven-survival')),
      ]),
    );

    const result = searchDeterministicAndOrProof(
      root,
      adapter,
      Object.freeze({ nodeBudget: 2 }),
    );

    expect(result.outcome).toBe('budget-exhausted');
    expect(result.reason).toBe('node-budget-exhausted');
    expect(result.exploredNodes).toBe(2);
    expect(result.principalVariation).toEqual(['z-kill']);
  });

  it('reports ko dependency only when no unresolved branch already blocks the universal proof', () => {
    const koRoot = branch(
      'ko-root',
      'attacker',
      Object.freeze([
        move('a-live', terminal('live', 'proven-survival')),
        move('b-ko', terminal('ko', 'ko-dependent')),
      ]),
    );
    const unresolvedRoot = branch(
      'unresolved-root',
      'attacker',
      Object.freeze([
        move('a-ko', terminal('ko', 'ko-dependent')),
        move('b-unknown', terminal('unknown', 'unresolved')),
      ]),
    );

    expect(searchDeterministicAndOrProof(koRoot, adapter).outcome).toBe('ko-dependent');
    expect(searchDeterministicAndOrProof(unresolvedRoot, adapter).outcome).toBe('unresolved');
  });

  it('composes alternating attacker OR and defender AND nodes recursively', () => {
    const defense = branch(
      'defense',
      'defender',
      Object.freeze([
        move('d2', terminal('d2-dead', 'proven-kill')),
        move('d1', terminal('d1-dead', 'proven-kill')),
      ]),
    );
    const root = branch(
      'root',
      'attacker',
      Object.freeze([move('attack', defense)]),
    );

    const result = searchDeterministicAndOrProof(root, adapter);

    expect(result.outcome).toBe('proven-kill');
    expect(result.principalVariation).toEqual(['attack', 'd1']);
    expect(result.exploredNodes).toBe(4);
    expect(result.maxDepth).toBe(3);
  });

  it('uses proof-complete empty move sets as the correct AND/OR identities', () => {
    const noAttacks = branch('no-attacks', 'attacker', Object.freeze([]));
    const noDefenses = branch('no-defenses', 'defender', Object.freeze([]));

    expect(searchDeterministicAndOrProof(noAttacks, adapter).outcome).toBe(
      'proven-survival',
    );
    expect(searchDeterministicAndOrProof(noDefenses, adapter).outcome).toBe(
      'proven-kill',
    );
  });

  it('orders moves by stable move key and returns identical results across runs', () => {
    const root = branch(
      'root',
      'attacker',
      Object.freeze([
        move('c', terminal('c-live', 'proven-survival')),
        move('a', terminal('a-live', 'proven-survival')),
        move('b', terminal('b-live', 'proven-survival')),
      ]),
    );

    const first = searchDeterministicAndOrProof(root, adapter);
    const second = searchDeterministicAndOrProof(root, adapter);

    expect(second).toEqual(first);
    expect(first.outcome).toBe('proven-survival');
    expect(first.principalVariation).toEqual(['a']);
  });

  it('rejects duplicate move keys because they break deterministic branch identity', () => {
    const root = branch(
      'root',
      'attacker',
      Object.freeze([
        move('same', terminal('a', 'proven-survival')),
        move('same', terminal('b', 'proven-survival')),
      ]),
    );

    expect(() => searchDeterministicAndOrProof(root, adapter)).toThrow(
      "Duplicate proof-search move key 'same' at node 'root'",
    );
  });

  it('requires a positive integer node budget', () => {
    const root = branch('root', 'attacker', Object.freeze([]));

    expect(() =>
      searchDeterministicAndOrProof(root, adapter, Object.freeze({ nodeBudget: 0 })),
    ).toThrow('nodeBudget must be a positive integer');
  });
});
