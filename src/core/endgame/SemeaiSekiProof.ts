import type { BoardOccupancy, GameState, StoneColor } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import {
  searchDeterministicAndOrProof,
  type DeterministicProofSearchResult,
  type ProofSearchRole,
} from './DeterministicAndOrProofSearch';
import {
  buildEndgameGraph,
  type EndgameGraph,
  type EndgameStoneString,
} from './EndgameGraphCore';
import {
  createEndgameProofSearchNode,
  transitionEndgameProofSearchMove,
} from './EndgameProofSearchGoAdapter';
import { analyzeSmallEyeSpace } from './SmallEyeSpaceAnalyzer';
import { createTacticalExtensionProofSearchGoAdapter } from './TacticalExtensionProofSearchGoAdapter';

export const SEMEAI_SEKI_ALGORITHM = 'semeai-seki-proof-v1';
export const SEMEAI_SEKI_CLOSED_MUTUAL_CAPTURE_CERTIFICATE =
  'e2-9-closed-two-shared-liberties-authoritative-mutual-capture';

export interface SemeaiSekiOptions {
  readonly previousBoard?: BoardOccupancy;
  readonly nodeBudget?: number;
  readonly includeKillProofs?: boolean;
}

export interface SemeaiEyeSummary {
  readonly minEyes: number;
  readonly maxEyes: number;
  readonly complete: boolean;
  readonly koDependent: boolean;
  readonly strictRegionCount: number;
}

export interface SemeaiGroupSummary {
  readonly key: string;
  readonly color: StoneColor;
  readonly points: readonly PointId[];
  readonly liberties: readonly PointId[];
  readonly exclusiveLiberties: readonly PointId[];
  readonly approachPoints: readonly PointId[];
  readonly eyes: SemeaiEyeSummary;
}

export interface SemeaiKillProof {
  readonly targetGroupKey: string;
  readonly targetColor: StoneColor;
  readonly sideToMove: StoneColor;
  readonly rootRole: ProofSearchRole;
  readonly result: DeterministicProofSearchResult;
}

export interface SekiInitiationEvidence {
  readonly initiator: StoneColor;
  readonly point: PointId;
  readonly result: 'illegal-initiation' | 'refuted-by-capture';
  readonly replyPoint?: PointId;
}

export interface ProvenSekiEvidence {
  readonly certificate: typeof SEMEAI_SEKI_CLOSED_MUTUAL_CAPTURE_CERTIFICATE;
  readonly groupKeys: readonly [string, string];
  readonly sharedLiberties: readonly [PointId, PointId];
  readonly initiations: readonly SekiInitiationEvidence[];
}

export type SekiProofResult =
  | Readonly<{
      readonly status: 'proven-seki';
      readonly reason: 'closed-mutual-capture';
      readonly evidence: ProvenSekiEvidence;
    }>
  | Readonly<{
      readonly status: 'ko-dependent';
      readonly reason: 'unknown-root-simple-ko';
    }>
  | Readonly<{
      readonly status: 'unresolved';
      readonly reason:
        | 'not-exactly-two-shared-liberties'
        | 'exclusive-liberties-present'
        | 'open-empty-boundary'
        | 'third-group-boundary'
        | 'shared-liberty-not-mutual'
        | 'initiating-capture-available'
        | 'initiating-move-not-refuted';
    }>;

export interface SemeaiSekiAnalysis {
  readonly algorithm: typeof SEMEAI_SEKI_ALGORITHM;
  readonly groupKeys: readonly [string, string];
  readonly sideToMove: StoneColor;
  readonly sharedLiberties: readonly PointId[];
  readonly groups: readonly [SemeaiGroupSummary, SemeaiGroupSummary];
  readonly seki: SekiProofResult;
  readonly killProofs: readonly SemeaiKillProof[];
  readonly killProofsExamined: boolean;
}

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const uniqueSorted = <T extends string>(values: Iterable<T>): readonly T[] =>
  Object.freeze([...new Set(values)].sort(compareStrings));

const sharedLibertiesFor = (
  left: EndgameStoneString,
  right: EndgameStoneString,
): readonly PointId[] => {
  const rightLiberties = new Set(right.liberties);
  return Object.freeze(left.liberties.filter((point) => rightLiberties.has(point)));
};

const approachPointsFor = (
  state: GameState,
  topology: Topology,
  group: EndgameStoneString,
  exclusiveLiberties: readonly PointId[],
): readonly PointId[] => {
  const directLiberties = new Set(group.liberties);
  const approach = new Set<PointId>();
  for (const liberty of exclusiveLiberties) {
    for (const neighbor of topology.neighbors(liberty)) {
      if (state.board[neighbor] === 'empty' && !directLiberties.has(neighbor)) {
        approach.add(neighbor);
      }
    }
  }
  return uniqueSorted(approach);
};

const eyeSummaryFor = (
  state: GameState,
  topology: Topology,
  group: EndgameStoneString,
  previousBoard?: BoardOccupancy,
): SemeaiEyeSummary => {
  const analysis = analyzeSmallEyeSpace(
    state,
    topology,
    group.key,
    previousBoard ? Object.freeze({ previousBoard }) : undefined,
  );
  if (!analysis) {
    return Object.freeze({
      minEyes: 0,
      maxEyes: 0,
      complete: false,
      koDependent: false,
      strictRegionCount: 0,
    });
  }

  return Object.freeze({
    minEyes: analysis.minEyes,
    maxEyes: analysis.maxEyes,
    complete: analysis.complete,
    koDependent: analysis.koDependent,
    strictRegionCount: analysis.regions.filter(
      (region) => region.boundary === 'strict-target-boundary',
    ).length,
  });
};

const summarizeGroup = (
  state: GameState,
  topology: Topology,
  group: EndgameStoneString,
  shared: ReadonlySet<PointId>,
  previousBoard?: BoardOccupancy,
): SemeaiGroupSummary => {
  const exclusiveLiberties = Object.freeze(
    group.liberties.filter((point) => !shared.has(point)).sort(compareStrings),
  );
  return Object.freeze({
    key: group.key,
    color: group.color,
    points: group.points,
    liberties: group.liberties,
    exclusiveLiberties,
    approachPoints: approachPointsFor(state, topology, group, exclusiveLiberties),
    eyes: eyeSummaryFor(state, topology, group, previousBoard),
  });
};

const sekiUnresolved = (reason: Extract<SekiProofResult, { status: 'unresolved' }>['reason']): SekiProofResult =>
  Object.freeze({ status: 'unresolved' as const, reason });

const groupHasThirdStoneBoundary = (
  group: EndgameStoneString,
  state: GameState,
  topology: Topology,
  graph: EndgameGraph,
  pairKeys: ReadonlySet<string>,
): boolean => {
  for (const point of group.points) {
    for (const neighbor of topology.neighbors(point)) {
      if (state.board[neighbor] === 'empty') continue;
      const owner = graph.pointOwner.get(neighbor);
      if (!owner || !pairKeys.has(owner)) return true;
    }
  }
  return false;
};

const verifySharedLibertyClosure = (
  sharedLiberties: readonly PointId[],
  state: GameState,
  topology: Topology,
  graph: EndgameGraph,
  pairKeys: ReadonlySet<string>,
): SekiProofResult | null => {
  const sharedSet = new Set(sharedLiberties);
  for (const liberty of sharedLiberties) {
    const adjacentOwners = new Set<string>();
    for (const neighbor of topology.neighbors(liberty)) {
      if (state.board[neighbor] === 'empty') {
        if (!sharedSet.has(neighbor)) return sekiUnresolved('open-empty-boundary');
        continue;
      }
      const owner = graph.pointOwner.get(neighbor);
      if (!owner || !pairKeys.has(owner)) return sekiUnresolved('third-group-boundary');
      adjacentOwners.add(owner);
    }
    if ([...pairKeys].some((groupKey) => !adjacentOwners.has(groupKey))) {
      return sekiUnresolved('shared-liberty-not-mutual');
    }
  }
  return null;
};

const groupCaptured = (
  state: GameState,
  group: EndgameStoneString,
): boolean => group.points.every((point) => state.board[point] !== group.color);

const verifyClosedMutualCaptureSeki = (
  state: GameState,
  topology: Topology,
  graph: EndgameGraph,
  left: EndgameStoneString,
  right: EndgameStoneString,
  sharedLiberties: readonly PointId[],
  previousBoard?: BoardOccupancy,
): SekiProofResult => {
  if (sharedLiberties.length !== 2) {
    return sekiUnresolved('not-exactly-two-shared-liberties');
  }
  const sharedSet = new Set(sharedLiberties);
  if (
    left.liberties.some((point) => !sharedSet.has(point)) ||
    right.liberties.some((point) => !sharedSet.has(point))
  ) {
    return sekiUnresolved('exclusive-liberties-present');
  }

  const pairKeys = new Set([left.key, right.key]);
  if (
    groupHasThirdStoneBoundary(left, state, topology, graph, pairKeys) ||
    groupHasThirdStoneBoundary(right, state, topology, graph, pairKeys)
  ) {
    return sekiUnresolved('third-group-boundary');
  }

  const closureFailure = verifySharedLibertyClosure(
    sharedLiberties,
    state,
    topology,
    graph,
    pairKeys,
  );
  if (closureFailure) return closureFailure;

  const initiations: SekiInitiationEvidence[] = [];
  for (const initiator of [left, right] as const) {
    const opponent = initiator.key === left.key ? right : left;
    for (const point of sharedLiberties) {
      const root = createEndgameProofSearchNode(
        topology,
        state,
        initiator.color,
        initiator.points,
        'defender',
        previousBoard,
      );
      const first = transitionEndgameProofSearchMove(
        root,
        topology,
        Object.freeze({ kind: 'place' as const, point }),
      );
      if (first.result === 'ko-dependent') {
        return Object.freeze({
          status: 'ko-dependent' as const,
          reason: 'unknown-root-simple-ko' as const,
        });
      }
      if (first.result === 'illegal') {
        initiations.push(
          Object.freeze({
            initiator: initiator.color,
            point,
            result: 'illegal-initiation' as const,
          }),
        );
        continue;
      }
      if (groupCaptured(first.node.state, opponent)) {
        return sekiUnresolved('initiating-capture-available');
      }

      const replyPoint = sharedLiberties.find((candidate) => candidate !== point)!;
      const reply = transitionEndgameProofSearchMove(
        first.node,
        topology,
        Object.freeze({ kind: 'place' as const, point: replyPoint }),
      );
      if (reply.result === 'ko-dependent') {
        return Object.freeze({
          status: 'ko-dependent' as const,
          reason: 'unknown-root-simple-ko' as const,
        });
      }
      if (reply.result !== 'accepted' || !groupCaptured(reply.node.state, initiator)) {
        return sekiUnresolved('initiating-move-not-refuted');
      }

      initiations.push(
        Object.freeze({
          initiator: initiator.color,
          point,
          result: 'refuted-by-capture' as const,
          replyPoint,
        }),
      );
    }
  }

  const orderedShared = Object.freeze([...sharedLiberties].sort(compareStrings)) as readonly [
    PointId,
    PointId,
  ];
  return Object.freeze({
    status: 'proven-seki' as const,
    reason: 'closed-mutual-capture' as const,
    evidence: Object.freeze({
      certificate: SEMEAI_SEKI_CLOSED_MUTUAL_CAPTURE_CERTIFICATE,
      groupKeys: Object.freeze([left.key, right.key]) as readonly [string, string],
      sharedLiberties: orderedShared,
      initiations: Object.freeze(initiations),
    }),
  });
};

const killProofFor = (
  state: GameState,
  topology: Topology,
  target: EndgameStoneString,
  previousBoard: BoardOccupancy | undefined,
  nodeBudget: number | undefined,
): SemeaiKillProof => {
  const sideToMove = state.currentPlayer;
  const rootRole: ProofSearchRole = sideToMove === target.color ? 'defender' : 'attacker';
  const root = createEndgameProofSearchNode(
    topology,
    state,
    target.color,
    target.points,
    rootRole,
    previousBoard,
  );
  const result = searchDeterministicAndOrProof(
    root,
    createTacticalExtensionProofSearchGoAdapter(topology),
    nodeBudget === undefined ? undefined : Object.freeze({ nodeBudget }),
  );
  return Object.freeze({
    targetGroupKey: target.key,
    targetColor: target.color,
    sideToMove,
    rootRole,
    result,
  });
};

/**
 * E2-9 semeai/seki analysis.
 *
 * Semeai kill/survival facts come only from the existing authoritative E2-8
 * AND/OR proof stack. Failure to prove either side is never converted to seki.
 * Seki has a separate positive certificate: a closed pair of opposing strings
 * with exactly the same two liberties, no exclusive liberties or third-group
 * boundary, where every legal initiation is authoritatively refuted by the
 * opponent capturing on the other shared liberty. Unknown-root ko fails closed.
 */
export const analyzeSemeaiSeki = (
  state: GameState,
  topology: Topology,
  leftGroupKey: string,
  rightGroupKey: string,
  options: SemeaiSekiOptions = Object.freeze({}),
): SemeaiSekiAnalysis | null => {
  const graph = buildEndgameGraph(state, topology);
  const left = graph.groups.get(leftGroupKey);
  const right = graph.groups.get(rightGroupKey);
  if (!left || !right || left.color === right.color) return null;

  const sharedLiberties = sharedLibertiesFor(left, right);
  if (sharedLiberties.length === 0) return null;
  const sharedSet = new Set(sharedLiberties);
  const leftSummary = summarizeGroup(
    state,
    topology,
    left,
    sharedSet,
    options.previousBoard,
  );
  const rightSummary = summarizeGroup(
    state,
    topology,
    right,
    sharedSet,
    options.previousBoard,
  );
  const seki = verifyClosedMutualCaptureSeki(
    state,
    topology,
    graph,
    left,
    right,
    sharedLiberties,
    options.previousBoard,
  );

  const includeKillProofs = options.includeKillProofs ?? true;
  const killProofs =
    includeKillProofs && seki.status !== 'proven-seki'
      ? Object.freeze([
          killProofFor(
            state,
            topology,
            left,
            options.previousBoard,
            options.nodeBudget,
          ),
          killProofFor(
            state,
            topology,
            right,
            options.previousBoard,
            options.nodeBudget,
          ),
        ])
      : Object.freeze([] as SemeaiKillProof[]);

  return Object.freeze({
    algorithm: SEMEAI_SEKI_ALGORITHM,
    groupKeys: Object.freeze([left.key, right.key]) as readonly [string, string],
    sideToMove: state.currentPlayer,
    sharedLiberties,
    groups: Object.freeze([leftSummary, rightSummary]) as readonly [
      SemeaiGroupSummary,
      SemeaiGroupSummary,
    ],
    seki,
    killProofs,
    killProofsExamined: includeKillProofs && seki.status !== 'proven-seki',
  });
};
