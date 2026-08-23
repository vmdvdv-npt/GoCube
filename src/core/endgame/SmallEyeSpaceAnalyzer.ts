import { GameEngine } from '../game/GameEngine';
import type { BoardOccupancy, GameState, StoneColor } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import { buildEndgameGraph, type EndgameEmptyRegion, type EndgameStoneString } from './EndgameGraphCore';
import { isPotentialSimpleKoCapture } from './OneLibertyTacticalReader';

export const SMALL_EYE_SPACE_ALGORITHM = 'small-eye-space-exact-v1';
export const DEFAULT_SMALL_EYE_SPACE_MAX_POINTS = 6;
export const DEFAULT_SMALL_EYE_SPACE_NODE_BUDGET = 4096;

export type SmallEyeSpaceBoundary =
  | 'strict-target-boundary'
  | 'shared-space'
  | 'friendly-shared-boundary';

export type SmallEyeSpaceUnresolvedReason =
  | 'region-too-large'
  | 'shared-space'
  | 'friendly-shared-boundary'
  | 'unknown-root-simple-ko'
  | 'outside-region-capture'
  | 'search-cycle'
  | 'node-budget-exhausted';

export interface SmallEyeSpaceOptions {
  readonly maxRegionPoints?: number;
  readonly nodeBudget?: number;
  readonly previousBoard?: BoardOccupancy;
}

export interface SmallEyeSpaceRegionAnalysis {
  readonly regionKey: string;
  readonly points: readonly PointId[];
  readonly boundary: SmallEyeSpaceBoundary;
  /**
   * `minEyes` is the attacker-first lower bound. When `complete` is true it is
   * the exact attacker-first local eye count.
   */
  readonly minEyes: number;
  /**
   * `maxEyes` is the defender-first upper bound. When `complete` is true it is
   * the exact defender-first local eye count.
   */
  readonly maxEyes: number;
  readonly attackVitalPoints: readonly PointId[];
  readonly defenseVitalPoints: readonly PointId[];
  readonly complete: boolean;
  readonly koDependent: boolean;
  readonly exploredNodes: number;
  readonly maxDepth: number;
  readonly unresolvedReasons: readonly SmallEyeSpaceUnresolvedReason[];
}

export interface SmallEyeSpaceAnalysis {
  readonly algorithm: typeof SMALL_EYE_SPACE_ALGORITHM;
  readonly targetGroupKey: string;
  readonly minEyes: number;
  readonly maxEyes: number;
  readonly attackVitalPoints: readonly PointId[];
  readonly defenseVitalPoints: readonly PointId[];
  readonly regions: readonly SmallEyeSpaceRegionAnalysis[];
  readonly complete: boolean;
  readonly koDependent: boolean;
  readonly exploredNodes: number;
  readonly maxDepth: number;
  readonly unresolvedReasons: readonly SmallEyeSpaceUnresolvedReason[];
}

interface SearchNode {
  readonly state: GameState;
  readonly previousBoard?: BoardOccupancy;
}

interface SearchEvaluation {
  readonly lower: number;
  readonly upper: number;
  readonly complete: boolean;
  readonly unresolvedReasons: readonly SmallEyeSpaceUnresolvedReason[];
}

interface RootMoveEvaluation {
  readonly kind: 'place' | 'pass';
  readonly point?: PointId;
  readonly evaluation: SearchEvaluation;
}

interface SearchContext {
  readonly topology: Topology;
  readonly engine: GameEngine;
  readonly orderedTopologyPoints: readonly PointId[];
  readonly regionPoints: readonly PointId[];
  readonly regionPointSet: ReadonlySet<PointId>;
  readonly originalTargetPoints: readonly PointId[];
  readonly targetColor: StoneColor;
  readonly nodeBudget: number;
  readonly maxPossibleEyes: number;
  readonly memo: Map<string, SearchEvaluation>;
  readonly rootMoves: RootMoveEvaluation[];
  exploredNodes: number;
  maxDepth: number;
}

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const opponentOf = (color: StoneColor): StoneColor =>
  color === 'black' ? 'white' : 'black';

const uniqueSorted = <T extends string>(values: Iterable<T>): readonly T[] =>
  Object.freeze([...new Set(values)].sort(compareStrings));

const assertPositiveInteger = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
};

const asPlayingState = (state: GameState, currentPlayer: StoneColor): GameState =>
  Object.freeze({
    ...state,
    currentPlayer,
    consecutivePasses: 0,
    phase: 'playing' as const,
  });

const boardSignature = (
  board: BoardOccupancy,
  orderedPoints: readonly PointId[],
): string =>
  orderedPoints
    .map((point) => {
      const occupancy = board[point];
      return occupancy === 'black' ? 'b' : occupancy === 'white' ? 'w' : '.';
    })
    .join('');

const searchNodeKey = (node: SearchNode, context: SearchContext): string => {
  const previous = node.previousBoard
    ? boardSignature(node.previousBoard, context.orderedTopologyPoints)
    : '?';
  return [
    node.state.currentPlayer,
    node.state.consecutivePasses,
    boardSignature(node.state.board, context.orderedTopologyPoints),
    `prev:${previous}`,
  ].join('|');
};

const exactEvaluation = (eyes: number): SearchEvaluation =>
  Object.freeze({
    lower: eyes,
    upper: eyes,
    complete: true,
    unresolvedReasons: Object.freeze([]),
  });

const unresolvedEvaluation = (
  context: SearchContext,
  reason: SmallEyeSpaceUnresolvedReason,
): SearchEvaluation =>
  Object.freeze({
    lower: 0,
    upper: context.maxPossibleEyes,
    complete: false,
    unresolvedReasons: Object.freeze([reason]),
  });

const targetCaptured = (node: SearchNode, context: SearchContext): boolean =>
  context.originalTargetPoints.some(
    (point) => node.state.board[point] !== context.targetColor,
  );

const countCurrentEyes = (node: SearchNode, context: SearchContext): number => {
  if (targetCaptured(node, context)) return 0;

  const graph = buildEndgameGraph(node.state, context.topology);
  const owner = graph.pointOwner.get(context.originalTargetPoints[0]!);
  if (!owner) return 0;

  for (const point of context.originalTargetPoints) {
    if (graph.pointOwner.get(point) !== owner) return 0;
  }

  return graph.emptyRegions.filter(
    (region) =>
      region.points.length > 0 &&
      region.points.every((point) => context.regionPointSet.has(point)) &&
      region.boundaryGroups.length === 1 &&
      region.boundaryGroups[0] === owner,
  ).length;
};

const combineEvaluations = (
  evaluations: readonly SearchEvaluation[],
  minimize: boolean,
): SearchEvaluation => {
  if (evaluations.length === 0) {
    throw new Error('Small eye-space search requires at least one child');
  }

  const lower = minimize
    ? Math.min(...evaluations.map((evaluation) => evaluation.lower))
    : Math.max(...evaluations.map((evaluation) => evaluation.lower));
  const upper = minimize
    ? Math.min(...evaluations.map((evaluation) => evaluation.upper))
    : Math.max(...evaluations.map((evaluation) => evaluation.upper));
  const unresolvedReasons = uniqueSorted(
    evaluations.flatMap((evaluation) => evaluation.unresolvedReasons),
  );

  return Object.freeze({
    lower,
    upper,
    complete: evaluations.every((evaluation) => evaluation.complete),
    unresolvedReasons,
  });
};

const evaluateSearchNode = (
  node: SearchNode,
  context: SearchContext,
  depth: number,
  path: ReadonlySet<string>,
): SearchEvaluation => {
  context.maxDepth = Math.max(context.maxDepth, depth);

  if (targetCaptured(node, context)) return exactEvaluation(0);
  if (node.state.phase !== 'playing') {
    return exactEvaluation(countCurrentEyes(node, context));
  }

  const nodeKey = searchNodeKey(node, context);
  if (path.has(nodeKey)) {
    return unresolvedEvaluation(context, 'search-cycle');
  }

  const cached = context.memo.get(nodeKey);
  if (cached) return cached;

  if (context.exploredNodes >= context.nodeBudget) {
    return unresolvedEvaluation(context, 'node-budget-exhausted');
  }
  context.exploredNodes += 1;

  const nextPath = new Set(path);
  nextPath.add(nodeKey);
  const childEvaluations: SearchEvaluation[] = [];
  const captureRootMove = (move: RootMoveEvaluation): void => {
    if (depth === 0) context.rootMoves.push(Object.freeze(move));
  };

  for (const point of context.regionPoints) {
    if (node.state.board[point] !== 'empty') continue;

    const mover = node.state.currentPlayer;
    const placed = context.engine.placeStone(
      node.state,
      point,
      mover,
      node.previousBoard
        ? Object.freeze({ previousBoard: node.previousBoard })
        : undefined,
    );
    if (!placed.ok) continue;

    let evaluation: SearchEvaluation;
    if (
      !node.previousBoard &&
      isPotentialSimpleKoCapture(
        context.engine,
        placed.state,
        point,
        mover,
        placed.captured,
      )
    ) {
      evaluation = unresolvedEvaluation(context, 'unknown-root-simple-ko');
    } else {
      const capturedOutsideRegion = placed.captured.filter(
        (capturedPoint) => !context.regionPointSet.has(capturedPoint),
      );
      if (capturedOutsideRegion.length > 0) {
        const capturedTarget = context.originalTargetPoints.some((targetPoint) =>
          capturedOutsideRegion.includes(targetPoint),
        );
        evaluation = capturedTarget
          ? exactEvaluation(0)
          : unresolvedEvaluation(context, 'outside-region-capture');
      } else {
        evaluation = evaluateSearchNode(
          Object.freeze({
            state: placed.state,
            previousBoard: node.state.board,
          }),
          context,
          depth + 1,
          nextPath,
        );
      }
    }

    childEvaluations.push(evaluation);
    captureRootMove({ kind: 'place', point, evaluation });
  }

  const passed = context.engine.pass(node.state);
  if (passed.ok) {
    const passEvaluation = evaluateSearchNode(
      Object.freeze({
        state: passed.state,
        previousBoard: node.state.board,
      }),
      context,
      depth + 1,
      nextPath,
    );
    childEvaluations.push(passEvaluation);
    captureRootMove({ kind: 'pass', evaluation: passEvaluation });
  }

  if (childEvaluations.length === 0) {
    return exactEvaluation(countCurrentEyes(node, context));
  }

  const evaluation = combineEvaluations(
    childEvaluations,
    node.state.currentPlayer !== context.targetColor,
  );
  if (evaluation.complete) context.memo.set(nodeKey, evaluation);
  return evaluation;
};

interface RootSearchResult extends SearchEvaluation {
  readonly vitalPoints: readonly PointId[];
  readonly exploredNodes: number;
  readonly maxDepth: number;
}

const evaluateRoot = (
  state: GameState,
  topology: Topology,
  target: EndgameStoneString,
  region: EndgameEmptyRegion,
  currentPlayer: StoneColor,
  previousBoard: BoardOccupancy | undefined,
  nodeBudget: number,
): RootSearchResult => {
  const context: SearchContext = {
    topology,
    engine: new GameEngine(topology),
    orderedTopologyPoints: Object.freeze([...topology.points()].sort(compareStrings)),
    regionPoints: Object.freeze([...region.points].sort(compareStrings)),
    regionPointSet: new Set(region.points),
    originalTargetPoints: target.points,
    targetColor: target.color,
    nodeBudget,
    maxPossibleEyes: region.points.length,
    memo: new Map(),
    rootMoves: [],
    exploredNodes: 0,
    maxDepth: 0,
  };

  const root = Object.freeze({
    state: asPlayingState(state, currentPlayer),
    ...(previousBoard ? { previousBoard } : {}),
  }) satisfies SearchNode;
  const evaluation = evaluateSearchNode(root, context, 0, new Set());

  let vitalPoints: readonly PointId[] = Object.freeze([]);
  if (evaluation.complete) {
    const pass = context.rootMoves.find((move) => move.kind === 'pass');
    const passValue = pass?.evaluation.lower;
    if (passValue !== undefined) {
      const minimize = currentPlayer !== target.color;
      vitalPoints = Object.freeze(
        context.rootMoves
          .filter(
            (move): move is RootMoveEvaluation & Readonly<{ point: PointId }> =>
              move.kind === 'place' && move.point !== undefined,
          )
          .filter((move) => {
            const value = move.evaluation.lower;
            if (value !== evaluation.lower) return false;
            return minimize ? value < passValue : value > passValue;
          })
          .map((move) => move.point)
          .sort(compareStrings),
      );
    }
  }

  return Object.freeze({
    ...evaluation,
    vitalPoints,
    exploredNodes: context.exploredNodes,
    maxDepth: context.maxDepth,
  });
};

const classifyBoundary = (
  target: EndgameStoneString,
  region: EndgameEmptyRegion,
  graphGroups: ReadonlyMap<string, EndgameStoneString>,
): SmallEyeSpaceBoundary => {
  const hasOpponentBoundary = region.boundaryGroups.some(
    (groupKey) => graphGroups.get(groupKey)?.color !== target.color,
  );
  if (hasOpponentBoundary) return 'shared-space';

  return region.boundaryGroups.length === 1 && region.boundaryGroups[0] === target.key
    ? 'strict-target-boundary'
    : 'friendly-shared-boundary';
};

const unresolvedRegion = (
  region: EndgameEmptyRegion,
  boundary: SmallEyeSpaceBoundary,
  reason: SmallEyeSpaceUnresolvedReason,
): SmallEyeSpaceRegionAnalysis =>
  Object.freeze({
    regionKey: region.key,
    points: region.points,
    boundary,
    minEyes: 0,
    maxEyes: region.points.length,
    attackVitalPoints: Object.freeze([]),
    defenseVitalPoints: Object.freeze([]),
    complete: false,
    koDependent: false,
    exploredNodes: 0,
    maxDepth: 0,
    unresolvedReasons: Object.freeze([reason]),
  });

/**
 * Exact bounded eye-space search over one connected empty region at a time.
 *
 * A strict region is bounded only by the target string. For regions up to the
 * configured size, every legal local placement and Pass is enumerated through
 * GameEngine for both move orders. The attacker minimizes surviving target-only
 * empty components; the defender maximizes them. Root simple-ko uncertainty,
 * cycles, budget exhaustion, and non-local captures fail closed.
 *
 * Shared/friendly-shared regions and oversized regions are represented with
 * conservative bounds only. These non-strict results may be used to order or
 * reduce later proof search, but are not life/death/seki proof authority.
 */
export const analyzeSmallEyeSpace = (
  state: GameState,
  topology: Topology,
  targetGroupKey: string,
  options: SmallEyeSpaceOptions = {},
): SmallEyeSpaceAnalysis | null => {
  const maxRegionPoints =
    options.maxRegionPoints ?? DEFAULT_SMALL_EYE_SPACE_MAX_POINTS;
  const nodeBudget = options.nodeBudget ?? DEFAULT_SMALL_EYE_SPACE_NODE_BUDGET;
  assertPositiveInteger(maxRegionPoints, 'maxRegionPoints');
  assertPositiveInteger(nodeBudget, 'nodeBudget');

  const graph = buildEndgameGraph(state, topology);
  const target = graph.groups.get(targetGroupKey);
  if (!target) return null;

  const regions = graph.emptyRegions
    .filter((region) => region.boundaryGroups.includes(targetGroupKey))
    .sort((left, right) => compareStrings(left.key, right.key))
    .map((region): SmallEyeSpaceRegionAnalysis => {
      const boundary = classifyBoundary(target, region, graph.groups);
      if (boundary === 'shared-space') {
        return unresolvedRegion(region, boundary, 'shared-space');
      }
      if (boundary === 'friendly-shared-boundary') {
        return unresolvedRegion(region, boundary, 'friendly-shared-boundary');
      }
      if (region.points.length > maxRegionPoints) {
        return unresolvedRegion(region, boundary, 'region-too-large');
      }

      const attacker = evaluateRoot(
        state,
        topology,
        target,
        region,
        opponentOf(target.color),
        options.previousBoard,
        nodeBudget,
      );
      const defender = evaluateRoot(
        state,
        topology,
        target,
        region,
        target.color,
        options.previousBoard,
        nodeBudget,
      );
      const unresolvedReasons = uniqueSorted([
        ...attacker.unresolvedReasons,
        ...defender.unresolvedReasons,
      ]);
      const complete = attacker.complete && defender.complete;

      return Object.freeze({
        regionKey: region.key,
        points: region.points,
        boundary,
        minEyes: attacker.lower,
        maxEyes: defender.upper,
        attackVitalPoints: complete ? attacker.vitalPoints : Object.freeze([]),
        defenseVitalPoints: complete ? defender.vitalPoints : Object.freeze([]),
        complete,
        koDependent: unresolvedReasons.includes('unknown-root-simple-ko'),
        exploredNodes: attacker.exploredNodes + defender.exploredNodes,
        maxDepth: Math.max(attacker.maxDepth, defender.maxDepth),
        unresolvedReasons,
      });
    });

  const unresolvedReasons = uniqueSorted(
    regions.flatMap((region) => region.unresolvedReasons),
  );

  return Object.freeze({
    algorithm: SMALL_EYE_SPACE_ALGORITHM,
    targetGroupKey,
    minEyes: regions.reduce((sum, region) => sum + region.minEyes, 0),
    maxEyes: regions.reduce((sum, region) => sum + region.maxEyes, 0),
    attackVitalPoints: uniqueSorted(
      regions.flatMap((region) => region.attackVitalPoints),
    ),
    defenseVitalPoints: uniqueSorted(
      regions.flatMap((region) => region.defenseVitalPoints),
    ),
    regions: Object.freeze(regions),
    complete: regions.every((region) => region.complete),
    koDependent: regions.some((region) => region.koDependent),
    exploredNodes: regions.reduce((sum, region) => sum + region.exploredNodes, 0),
    maxDepth: regions.reduce((depth, region) => Math.max(depth, region.maxDepth), 0),
    unresolvedReasons,
  });
};
