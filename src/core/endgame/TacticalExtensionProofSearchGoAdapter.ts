import type { StoneColor } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import type {
  DeterministicProofSearchAdapter,
  ProofSearchExpansion,
} from './DeterministicAndOrProofSearch';
import {
  buildEndgameGraph,
  type EndgameGraph,
  type EndgameStoneString,
} from './EndgameGraphCore';
import {
  transitionEndgameProofSearchMove,
  type EndgameProofSearchMove,
  type EndgameProofSearchNode,
} from './EndgameProofSearchGoAdapter';
import { createFourLibertyProofSearchGoAdapter } from './FourLibertyProofSearchGoAdapter';

export const TACTICAL_EXTENSION_GO_ADAPTER_ALGORITHM =
  'endgame-go-tactical-extension-adapter-v1';
export const TACTICAL_EXTENSION_MOVE_GENERATION_BOUNDARY =
  'e2-8-tactical-candidates-are-not-proof-complete';
export const TACTICAL_EXTENSION_UNKNOWN_ROOT_KO_BOUNDARY =
  'e2-8-tactical-unknown-root-ko-branch';
export const TACTICAL_EXTENSION_PASS_ALIVE_REASON = 'e2-8-target-pass-alive';

export type TacticalExtensionReason =
  | 'connection'
  | 'cut'
  | 'counter-capture'
  | 'ladder-step'
  | 'net-step'
  | 'snapback'
  | 'sacrifice'
  | 'preparation';

export interface TacticalExtensionMoveCandidate {
  readonly point: PointId;
  readonly reasons: readonly TacticalExtensionReason[];
  readonly captured: readonly PointId[];
  readonly resultingOwnLiberties: number;
}

export interface TacticalExtensionMoveAnalysis {
  readonly algorithm: typeof TACTICAL_EXTENSION_GO_ADAPTER_ALGORITHM;
  readonly mover: StoneColor;
  readonly candidates: readonly TacticalExtensionMoveCandidate[];
  readonly koDependentPoints: readonly PointId[];
  readonly examinedEmptyPoints: number;
}

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const uniqueSorted = <T extends string>(values: Iterable<T>): readonly T[] =>
  Object.freeze([...new Set(values)].sort(compareStrings));

const opponentOf = (color: StoneColor): StoneColor =>
  color === 'black' ? 'white' : 'black';

const moverForNode = (node: EndgameProofSearchNode): StoneColor =>
  node.role === 'defender' ? node.targetColor : opponentOf(node.targetColor);

const survivingTargetGroup = (
  node: EndgameProofSearchNode,
  graph: EndgameGraph,
): EndgameStoneString | null => {
  const owners = new Set<string>();
  let surviving = 0;
  for (const point of node.crucialStones) {
    if (node.state.board[point] !== node.targetColor) continue;
    surviving += 1;
    const owner = graph.pointOwner.get(point);
    if (!owner) return null;
    owners.add(owner);
  }
  if (surviving === 0 || owners.size !== 1) return null;
  const target = graph.groups.get([...owners][0]!);
  return target?.color === node.targetColor ? target : null;
};

const capturedBetween = (
  before: EndgameProofSearchNode,
  after: EndgameProofSearchNode,
  color: StoneColor,
  topology: Topology,
): readonly PointId[] =>
  Object.freeze(
    [...topology.points()]
      .filter(
        (point) =>
          before.state.board[point] === color && after.state.board[point] === 'empty',
      )
      .sort(compareStrings),
  );

const postGroupForPreGroup = (
  group: EndgameStoneString,
  graph: EndgameGraph,
  node: EndgameProofSearchNode,
): EndgameStoneString | null => {
  const survivingPoint = group.points.find(
    (point) => node.state.board[point] === group.color,
  );
  if (!survivingPoint) return null;
  const key = graph.pointOwner.get(survivingPoint);
  return key ? graph.groups.get(key) ?? null : null;
};

const directPreparationSeeds = (
  graph: EndgameGraph,
  target: EndgameStoneString | null,
): ReadonlySet<PointId> => {
  const seeds = new Set<PointId>(target?.liberties ?? []);
  for (const connection of graph.friendlyConnections) seeds.add(connection.point);
  for (const group of graph.groups.values()) {
    if (group.liberties.length <= 3) {
      for (const liberty of group.liberties) seeds.add(liberty);
    }
  }
  return seeds;
};

const preparationPoints = (
  node: EndgameProofSearchNode,
  topology: Topology,
  seeds: ReadonlySet<PointId>,
): ReadonlySet<PointId> => {
  const points = new Set<PointId>();
  for (const seed of seeds) {
    for (const neighbor of topology.neighbors(seed)) {
      if (node.state.board[neighbor] === 'empty' && !seeds.has(neighbor)) {
        points.add(neighbor);
      }
    }
  }
  return points;
};

const isImmediateConnection = (
  point: PointId,
  mover: StoneColor,
  before: EndgameGraph,
  after: EndgameGraph,
): boolean => {
  const candidate = before.friendlyConnections.find(
    (connection) => connection.point === point && connection.color === mover,
  );
  if (!candidate) return false;
  const postOwner = after.pointOwner.get(point);
  if (!postOwner) return false;

  let connectedGroups = 0;
  for (const groupKey of candidate.groupKeys) {
    const group = before.groups.get(groupKey);
    if (!group) continue;
    if (group.points.some((groupPoint) => after.pointOwner.get(groupPoint) === postOwner)) {
      connectedGroups += 1;
    }
  }
  return connectedGroups >= 2;
};

const isCutCandidate = (
  point: PointId,
  opponent: StoneColor,
  graph: EndgameGraph,
): boolean =>
  graph.friendlyConnections.some(
    (connection) => connection.point === point && connection.color === opponent,
  );

const pressureReasons = (
  point: PointId,
  mover: StoneColor,
  before: EndgameGraph,
  after: EndgameGraph,
  afterNode: EndgameProofSearchNode,
): readonly TacticalExtensionReason[] => {
  const opponent = opponentOf(mover);
  const reasons = new Set<TacticalExtensionReason>();

  for (const group of before.groups.values()) {
    if (group.color !== opponent || !group.liberties.includes(point)) continue;
    const postGroup = postGroupForPreGroup(group, after, afterNode);
    if (!postGroup) continue;
    if (group.liberties.length === 2 && postGroup.liberties.length === 1) {
      reasons.add('ladder-step');
    }
    if (group.liberties.length >= 3 && postGroup.liberties.length === 2) {
      reasons.add('net-step');
    }
  }

  return uniqueSorted(reasons);
};

const isSnapbackSequence = (
  node: EndgameProofSearchNode,
  topology: Topology,
  point: PointId,
  firstChild: EndgameProofSearchNode,
): boolean => {
  const mover = moverForNode(node);
  const firstGraph = buildEndgameGraph(firstChild.state, topology);
  const ownGroupKey = firstGraph.pointOwner.get(point);
  if (!ownGroupKey) return false;
  const ownGroup = firstGraph.groups.get(ownGroupKey);
  if (!ownGroup || ownGroup.color !== mover || ownGroup.liberties.length !== 1) {
    return false;
  }

  const reply = transitionEndgameProofSearchMove(
    firstChild,
    topology,
    Object.freeze({ kind: 'place' as const, point: ownGroup.liberties[0]! }),
  );
  if (reply.result !== 'accepted') return false;
  if (ownGroup.points.some((ownPoint) => reply.node.state.board[ownPoint] === mover)) {
    return false;
  }
  if (reply.node.state.board[point] !== 'empty') return false;

  const recapture = transitionEndgameProofSearchMove(
    reply.node,
    topology,
    Object.freeze({ kind: 'place' as const, point }),
  );
  if (recapture.result !== 'accepted') return false;

  return capturedBetween(
    reply.node,
    recapture.node,
    opponentOf(mover),
    topology,
  ).length >= 2;
};

const targetPreparation = (
  point: PointId,
  targetBefore: EndgameStoneString | null,
  targetAfter: EndgameStoneString | null,
): boolean =>
  Boolean(
    targetBefore &&
      targetAfter &&
      targetBefore.liberties.length > 4 &&
      targetBefore.liberties.includes(point) &&
      targetAfter.liberties.length < targetBefore.liberties.length,
  );

const isTargetPassAlive = (
  node: EndgameProofSearchNode,
  topology: Topology,
): boolean => {
  const graph = buildEndgameGraph(node.state, topology);
  const target = survivingTargetGroup(node, graph);
  if (!target) return false;

  const remainingGroups = new Set(
    [...graph.groups.values()]
      .filter((group) => group.color === target.color)
      .map((group) => group.key),
  );
  const candidateRegions = new Map(
    graph.emptyRegions
      .filter(
        (region) =>
          region.boundaryGroups.length > 0 &&
          region.boundaryGroups.every(
            (groupKey) => graph.groups.get(groupKey)?.color === target.color,
          ),
      )
      .map((region) => [region.key, region] as const),
  );
  const remainingRegions = new Set(candidateRegions.keys());

  while (true) {
    const groupsToRemove = [...remainingGroups].filter((groupKey) => {
      let vitalRegionCount = 0;
      for (const regionKey of remainingRegions) {
        if (candidateRegions.get(regionKey)!.vitalGroups.includes(groupKey)) {
          vitalRegionCount += 1;
        }
      }
      return vitalRegionCount < 2;
    });
    for (const groupKey of groupsToRemove) remainingGroups.delete(groupKey);

    const regionsToRemove = [...remainingRegions].filter((regionKey) =>
      candidateRegions
        .get(regionKey)!
        .boundaryGroups.some((groupKey) => !remainingGroups.has(groupKey)),
    );
    for (const regionKey of regionsToRemove) remainingRegions.delete(regionKey);

    if (groupsToRemove.length === 0 && regionsToRemove.length === 0) break;
  }

  return remainingGroups.has(target.key);
};

/**
 * Graph-native E2-8 tactical candidate analysis.
 *
 * Every returned move has already passed the shared authoritative Go transition
 * helper. Tactical labels are candidate/ordering evidence, not fate proofs.
 */
export const analyzeTacticalExtensionMoves = (
  node: EndgameProofSearchNode,
  topology: Topology,
): TacticalExtensionMoveAnalysis => {
  const mover = moverForNode(node);
  const opponent = opponentOf(mover);
  const before = buildEndgameGraph(node.state, topology);
  const targetBefore = survivingTargetGroup(node, before);
  const prepPoints = preparationPoints(
    node,
    topology,
    directPreparationSeeds(before, targetBefore),
  );
  const candidates: TacticalExtensionMoveCandidate[] = [];
  const koDependentPoints: PointId[] = [];
  const emptyPoints = [...topology.points()]
    .filter((point) => node.state.board[point] === 'empty')
    .sort(compareStrings);

  for (const point of emptyPoints) {
    const transition = transitionEndgameProofSearchMove(
      node,
      topology,
      Object.freeze({ kind: 'place' as const, point }),
    );
    if (transition.result === 'ko-dependent') {
      koDependentPoints.push(point);
      continue;
    }
    if (transition.result !== 'accepted') continue;

    const after = buildEndgameGraph(transition.node.state, topology);
    const reasons = new Set<TacticalExtensionReason>();
    const captured = capturedBetween(node, transition.node, opponent, topology);

    if (isImmediateConnection(point, mover, before, after)) reasons.add('connection');
    if (isCutCandidate(point, opponent, before)) reasons.add('cut');
    if (captured.length > 0) reasons.add('counter-capture');
    for (const reason of pressureReasons(point, mover, before, after, transition.node)) {
      reasons.add(reason);
    }

    const targetAfter = survivingTargetGroup(transition.node, after);
    if (targetPreparation(point, targetBefore, targetAfter)) reasons.add('preparation');

    const ownGroupKey = after.pointOwner.get(point);
    const ownGroup = ownGroupKey ? after.groups.get(ownGroupKey) : undefined;
    if (
      ownGroup?.color === mover &&
      ownGroup.liberties.length === 1 &&
      isSnapbackSequence(node, topology, point, transition.node)
    ) {
      reasons.add('snapback');
    }
    if (
      ownGroup?.color === mover &&
      ownGroup.liberties.length === 1 &&
      reasons.size > 0
    ) {
      reasons.add('sacrifice');
    }

    if (reasons.size === 0 && prepPoints.has(point)) reasons.add('preparation');
    if (reasons.size === 0) continue;

    candidates.push(
      Object.freeze({
        point,
        reasons: uniqueSorted(reasons),
        captured,
        resultingOwnLiberties: ownGroup?.color === mover ? ownGroup.liberties.length : 0,
      }),
    );
  }

  return Object.freeze({
    algorithm: TACTICAL_EXTENSION_GO_ADAPTER_ALGORITHM,
    mover,
    candidates: Object.freeze(candidates),
    koDependentPoints: Object.freeze(koDependentPoints.sort(compareStrings)),
    examinedEmptyPoints: emptyPoints.length,
  });
};

const mergeExpansion = (
  base: ProofSearchExpansion<EndgameProofSearchMove>,
  analysis: TacticalExtensionMoveAnalysis,
): ProofSearchExpansion<EndgameProofSearchMove> => {
  if (base.completeness.kind === 'complete') return base;

  const moves = [...base.moves];
  const seen = new Set(
    base.moves.map((move) =>
      move.kind === 'pass' ? 'pass' : `place:${move.point}`,
    ),
  );
  for (const candidate of analysis.candidates) {
    const key = `place:${candidate.point}`;
    if (seen.has(key)) continue;
    seen.add(key);
    moves.push(Object.freeze({ kind: 'place' as const, point: candidate.point }));
  }

  const inheritedReason =
    base.completeness.kind === 'incomplete'
      ? base.completeness.reason
      : 'e2-8-does-not-inherit-proof-safe-pruned-universal-authority';
  const reasons = [inheritedReason, TACTICAL_EXTENSION_MOVE_GENERATION_BOUNDARY];
  if (analysis.koDependentPoints.length > 0) {
    reasons.push(TACTICAL_EXTENSION_UNKNOWN_ROOT_KO_BOUNDARY);
  }

  return Object.freeze({
    moves: Object.freeze(moves),
    completeness: Object.freeze({
      kind: 'incomplete' as const,
      reason: reasons.join('; '),
    }),
  });
};

/**
 * E2-8 extends the exact 3/4-liberty adapter with graph-native tactical
 * candidates. Complete defender sets stay unchanged; every other augmented
 * move set stays explicitly incomplete. A connection is a survival proof only
 * after the connected target actually satisfies Benson/pass-alive.
 */
export const createTacticalExtensionProofSearchGoAdapter = (
  topology: Topology,
): DeterministicProofSearchAdapter<EndgameProofSearchNode, EndgameProofSearchMove> => {
  const base = createFourLibertyProofSearchGoAdapter(topology);

  return Object.freeze({
    nodeKey: (node: EndgameProofSearchNode): string =>
      `${TACTICAL_EXTENSION_GO_ADAPTER_ALGORITHM}|${base.nodeKey(node)}`,
    role: base.role,
    terminal: (node: EndgameProofSearchNode) => {
      const terminal = base.terminal(node);
      if (terminal) return terminal;
      return isTargetPassAlive(node, topology)
        ? Object.freeze({
            outcome: 'proven-survival' as const,
            reason: TACTICAL_EXTENSION_PASS_ALIVE_REASON,
          })
        : null;
    },
    expand: (node: EndgameProofSearchNode): ProofSearchExpansion<EndgameProofSearchMove> => {
      const expansion = base.expand(node);
      if (expansion.completeness.kind === 'complete') return expansion;
      return mergeExpansion(expansion, analyzeTacticalExtensionMoves(node, topology));
    },
    apply: base.apply,
    moveKey: base.moveKey,
  });
};
