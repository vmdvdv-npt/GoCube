export const DETERMINISTIC_AND_OR_PROOF_SEARCH_ALGORITHM =
  'deterministic-and-or-proof-search-v1';
export const DETERMINISTIC_AND_OR_TRANSPOSITION_POLICY =
  'node-key-complete-frame-cache-v1';
export const DEFAULT_PROOF_SEARCH_NODE_BUDGET = 2048;

export type ProofSearchRole = 'attacker' | 'defender';

export type ProofSearchOutcome =
  | 'proven-kill'
  | 'proven-survival'
  | 'ko-dependent'
  | 'budget-exhausted'
  | 'unresolved';

export type ProofSearchTerminalOutcome = Exclude<
  ProofSearchOutcome,
  'budget-exhausted'
>;

export type ProofSearchMoveSetCompleteness =
  | Readonly<{ readonly kind: 'complete' }>
  | Readonly<{
      readonly kind: 'proof-safe-pruned';
      readonly certificate: string;
    }>
  | Readonly<{
      readonly kind: 'incomplete';
      readonly reason: string;
    }>;

export interface ProofSearchTerminal {
  readonly outcome: ProofSearchTerminalOutcome;
  readonly reason?: string;
}

export interface ProofSearchExpansion<Move> {
  readonly moves: readonly Move[];
  readonly completeness: ProofSearchMoveSetCompleteness;
}

export interface DeterministicProofSearchAdapter<Node, Move> {
  /**
   * Canonical semantic identity for a proof node. E2-10 transposition reuse
   * requires equal keys to imply equal proof-relevant state, including role,
   * target identity and any ko/history context used by the adapter.
   */
  readonly nodeKey: (node: Node) => string;
  readonly role: (node: Node) => ProofSearchRole;
  readonly terminal: (node: Node) => ProofSearchTerminal | null;
  readonly expand: (node: Node) => ProofSearchExpansion<Move>;
  readonly apply: (node: Node, move: Move) => Node;
  readonly moveKey: (move: Move) => string;
}

export interface DeterministicProofSearchOptions {
  readonly nodeBudget?: number;
  /** Defaults to true. Disable only for differential/performance diagnostics. */
  readonly useTranspositions?: boolean;
}

export interface DeterministicProofSearchResult {
  readonly algorithm: typeof DETERMINISTIC_AND_OR_PROOF_SEARCH_ALGORITHM;
  readonly rootNodeKey: string;
  readonly outcome: ProofSearchOutcome;
  readonly reason: string;
  /** Nodes charged against the budget. Cache hits are not charged. */
  readonly exploredNodes: number;
  readonly maxDepth: number;
  readonly nodeBudget: number;
  readonly principalVariation: readonly string[];
  readonly proofSafePruningCertificates: readonly string[];
  readonly transpositionsEnabled: boolean;
  readonly transpositionPolicy:
    | typeof DETERMINISTIC_AND_OR_TRANSPOSITION_POLICY
    | null;
  readonly transpositionHits: number;
  readonly transpositionEntries: number;
}

interface FrameResult {
  readonly outcome: ProofSearchOutcome;
  readonly reason: string;
  readonly principalVariation: readonly string[];
  /** Maximum logical depth below this frame, including the frame itself. */
  readonly maxRelativeDepth: number;
}

interface ChildResult {
  readonly moveKey: string;
  readonly frame: FrameResult;
}

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const withMove = (moveKey: string, child: FrameResult): readonly string[] =>
  Object.freeze([moveKey, ...child.principalVariation]);

const firstChildWithOutcome = (
  children: readonly ChildResult[],
  outcome: ProofSearchOutcome,
): ChildResult | undefined => children.find((child) => child.frame.outcome === outcome);

const firstChildPrincipalVariation = (
  children: readonly ChildResult[],
): readonly string[] => {
  const first = children[0];
  return first ? withMove(first.moveKey, first.frame) : Object.freeze([] as string[]);
};

const maxChildRelativeDepth = (children: readonly ChildResult[]): number => {
  let max = 0;
  for (const child of children) max = Math.max(max, child.frame.maxRelativeDepth);
  return max;
};

const isProofComplete = (completeness: ProofSearchMoveSetCompleteness): boolean =>
  completeness.kind === 'complete' ||
  (completeness.kind === 'proof-safe-pruned' &&
    completeness.certificate.trim().length > 0);

const incompleteReason = (
  role: ProofSearchRole,
  completeness: ProofSearchMoveSetCompleteness,
): string => {
  if (completeness.kind === 'proof-safe-pruned') {
    return `${role}-move-set-missing-pruning-certificate`;
  }
  if (completeness.kind === 'incomplete') {
    return `${role}-move-set-incomplete: ${completeness.reason}`;
  }
  return `${role}-move-set-incomplete`;
};

/**
 * Generic deterministic AND/OR proof engine.
 *
 * Outcomes are always from the attacker's perspective:
 * - attacker node = OR: one proven kill is sufficient;
 * - defender node = AND: every proof-complete defense must lose before kill is proven.
 *
 * A move set is proof-complete only when the adapter declares it `complete`,
 * or declares `proof-safe-pruned` with a non-empty explicit certificate.
 * `incomplete` move sets may still support existential proofs (attacker finds a
 * kill, defender finds a survival), but can never support the opposite
 * universal conclusion.
 *
 * E2-10 keeps the same stable move ordering and DFS proof semantics while
 * memoizing completed frames by the adapter's canonical node key. Cache hits
 * do not consume node budget. Budget-exhausted frames are never memoized, so a
 * partial search cannot become proof authority through reuse. The table is
 * per-search and bounded by the number of budget-charged nodes.
 */
export const searchDeterministicAndOrProof = <Node, Move>(
  root: Node,
  adapter: DeterministicProofSearchAdapter<Node, Move>,
  options: DeterministicProofSearchOptions = Object.freeze({}),
): DeterministicProofSearchResult => {
  const nodeBudget = options.nodeBudget ?? DEFAULT_PROOF_SEARCH_NODE_BUDGET;
  if (!Number.isInteger(nodeBudget) || nodeBudget < 1) {
    throw new Error(`nodeBudget must be a positive integer, got ${nodeBudget}`);
  }

  const useTranspositions = options.useTranspositions ?? true;
  let exploredNodes = 0;
  let maxDepth = 0;
  let transpositionHits = 0;
  const proofSafePruningCertificates = new Set<string>();
  const transpositionTable = new Map<string, FrameResult>();

  const remember = (nodeKey: string, frame: FrameResult): FrameResult => {
    if (useTranspositions && frame.outcome !== 'budget-exhausted') {
      transpositionTable.set(nodeKey, frame);
    }
    return frame;
  };

  const visit = (node: Node, depth: number): FrameResult => {
    const nodeKey = adapter.nodeKey(node);

    if (useTranspositions) {
      const cached = transpositionTable.get(nodeKey);
      if (cached) {
        transpositionHits += 1;
        maxDepth = Math.max(maxDepth, depth + cached.maxRelativeDepth - 1);
        return cached;
      }
    }

    if (exploredNodes >= nodeBudget) {
      return Object.freeze({
        outcome: 'budget-exhausted' as const,
        reason: 'node-budget-exhausted',
        principalVariation: Object.freeze([] as string[]),
        maxRelativeDepth: 1,
      });
    }

    exploredNodes += 1;
    maxDepth = Math.max(maxDepth, depth);

    const terminal = adapter.terminal(node);
    if (terminal) {
      return remember(
        nodeKey,
        Object.freeze({
          outcome: terminal.outcome,
          reason: terminal.reason ?? `terminal-${terminal.outcome}`,
          principalVariation: Object.freeze([] as string[]),
          maxRelativeDepth: 1,
        }),
      );
    }

    const role = adapter.role(node);
    const expansion = adapter.expand(node);
    const orderedMoves = expansion.moves
      .map((move, originalIndex) =>
        Object.freeze({ move, moveKey: adapter.moveKey(move), originalIndex }),
      )
      .sort((left, right) =>
        compareStrings(left.moveKey, right.moveKey) || left.originalIndex - right.originalIndex,
      );

    const seenMoveKeys = new Set<string>();
    for (const move of orderedMoves) {
      if (seenMoveKeys.has(move.moveKey)) {
        throw new Error(
          `Duplicate proof-search move key '${move.moveKey}' at node '${nodeKey}'`,
        );
      }
      seenMoveKeys.add(move.moveKey);
    }

    if (
      expansion.completeness.kind === 'proof-safe-pruned' &&
      expansion.completeness.certificate.trim().length > 0
    ) {
      proofSafePruningCertificates.add(expansion.completeness.certificate);
    }

    const children: ChildResult[] = [];
    for (const orderedMove of orderedMoves) {
      const child = visit(adapter.apply(node, orderedMove.move), depth + 1);
      children.push(
        Object.freeze({
          moveKey: orderedMove.moveKey,
          frame: child,
        }),
      );

      const maxRelativeDepth = 1 + maxChildRelativeDepth(children);

      if (role === 'attacker' && child.outcome === 'proven-kill') {
        return remember(
          nodeKey,
          Object.freeze({
            outcome: 'proven-kill' as const,
            reason: 'attacker-winning-branch',
            principalVariation: withMove(orderedMove.moveKey, child),
            maxRelativeDepth,
          }),
        );
      }

      if (role === 'defender' && child.outcome === 'proven-survival') {
        return remember(
          nodeKey,
          Object.freeze({
            outcome: 'proven-survival' as const,
            reason: 'defender-survival-branch',
            principalVariation: withMove(orderedMove.moveKey, child),
            maxRelativeDepth,
          }),
        );
      }

      if (child.outcome === 'budget-exhausted') {
        return Object.freeze({
          outcome: 'budget-exhausted' as const,
          reason: child.reason,
          principalVariation: withMove(orderedMove.moveKey, child),
          maxRelativeDepth,
        });
      }
    }

    const frameMaxRelativeDepth = 1 + maxChildRelativeDepth(children);

    const unresolvedChild = firstChildWithOutcome(children, 'unresolved');
    if (unresolvedChild) {
      return remember(
        nodeKey,
        Object.freeze({
          outcome: 'unresolved' as const,
          reason: 'unresolved-child',
          principalVariation: withMove(unresolvedChild.moveKey, unresolvedChild.frame),
          maxRelativeDepth: frameMaxRelativeDepth,
        }),
      );
    }

    const koChild = firstChildWithOutcome(children, 'ko-dependent');
    if (koChild) {
      return remember(
        nodeKey,
        Object.freeze({
          outcome: 'ko-dependent' as const,
          reason: 'ko-dependent-child',
          principalVariation: withMove(koChild.moveKey, koChild.frame),
          maxRelativeDepth: frameMaxRelativeDepth,
        }),
      );
    }

    if (!isProofComplete(expansion.completeness)) {
      return remember(
        nodeKey,
        Object.freeze({
          outcome: 'unresolved' as const,
          reason: incompleteReason(role, expansion.completeness),
          principalVariation: firstChildPrincipalVariation(children),
          maxRelativeDepth: frameMaxRelativeDepth,
        }),
      );
    }

    if (role === 'attacker') {
      return remember(
        nodeKey,
        Object.freeze({
          outcome: 'proven-survival' as const,
          reason: 'all-proof-complete-attacks-proven-survival',
          principalVariation: firstChildPrincipalVariation(children),
          maxRelativeDepth: frameMaxRelativeDepth,
        }),
      );
    }

    return remember(
      nodeKey,
      Object.freeze({
        outcome: 'proven-kill' as const,
        reason: 'all-proof-complete-defenses-proven-kill',
        principalVariation: firstChildPrincipalVariation(children),
        maxRelativeDepth: frameMaxRelativeDepth,
      }),
    );
  };

  const rootNodeKey = adapter.nodeKey(root);
  const result = visit(root, 1);

  return Object.freeze({
    algorithm: DETERMINISTIC_AND_OR_PROOF_SEARCH_ALGORITHM,
    rootNodeKey,
    outcome: result.outcome,
    reason: result.reason,
    exploredNodes,
    maxDepth,
    nodeBudget,
    principalVariation: result.principalVariation,
    proofSafePruningCertificates: Object.freeze(
      [...proofSafePruningCertificates].sort(compareStrings),
    ),
    transpositionsEnabled: useTranspositions,
    transpositionPolicy: useTranspositions
      ? DETERMINISTIC_AND_OR_TRANSPOSITION_POLICY
      : null,
    transpositionHits,
    transpositionEntries: useTranspositions ? transpositionTable.size : 0,
  });
};
