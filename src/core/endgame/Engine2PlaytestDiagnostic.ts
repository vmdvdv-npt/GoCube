import type { BoardOccupancy } from '../game/types';
import type { GameSessionSnapshot } from '../persistence/GameSessionSnapshot';
import type { PointId, Topology } from '../topology/Topology';
import {
  searchDeterministicAndOrProof,
  type DeterministicProofSearchResult,
  type ProofSearchRole,
} from './DeterministicAndOrProofSearch';
import { buildEndgameGraph } from './EndgameGraphCore';
import { createEndgameProofSearchNode } from './EndgameProofSearchGoAdapter';
import {
  analyzeSemeaiSeki,
  type SemeaiSekiAnalysis,
} from './SemeaiSekiProof';
import {
  analyzeSmallEyeSpace,
  type SmallEyeSpaceAnalysis,
} from './SmallEyeSpaceAnalyzer';
import { createTacticalExtensionProofSearchGoAdapter } from './TacticalExtensionProofSearchGoAdapter';

export const ENGINE2_PLAYTEST_DIAGNOSTIC_ALGORITHM =
  'engine2-real-game-playtest-diagnostic-v1';
export const DEFAULT_ENGINE2_PLAYTEST_NODE_BUDGET = 512;

export type Engine2PlaytestVerdict =
  | 'proven-dead'
  | 'proven-alive'
  | 'proven-seki'
  | 'first-player-dependent'
  | 'ko-dependent'
  | 'budget-exhausted'
  | 'unresolved';

export interface Engine2PlaytestKillProof {
  readonly firstPlayer: 'attacker' | 'defender';
  readonly result: DeterministicProofSearchResult;
}

export interface Engine2PlaytestDiagnostic {
  readonly algorithm: typeof ENGINE2_PLAYTEST_DIAGNOSTIC_ALGORITHM;
  readonly groupKey: string;
  readonly color: 'black' | 'white';
  readonly points: readonly PointId[];
  readonly liberties: readonly PointId[];
  readonly verdict: Engine2PlaytestVerdict;
  readonly attackerFirst: Engine2PlaytestKillProof;
  readonly defenderFirst: Engine2PlaytestKillProof;
  readonly eyeSpace: SmallEyeSpaceAnalysis | null;
  readonly semeai: readonly SemeaiSekiAnalysis[];
  readonly nodeBudget: number;
  readonly previousBoardKnown: boolean;
}

export interface Engine2PlaytestDiagnosticOptions {
  readonly nodeBudget?: number;
}

const previousBoardFor = (
  snapshot: GameSessionSnapshot,
): BoardOccupancy | undefined => snapshot.history.at(-2)?.board;

const proofFor = (
  snapshot: GameSessionSnapshot,
  topology: Topology,
  groupKey: string,
  role: ProofSearchRole,
  nodeBudget: number,
): Engine2PlaytestKillProof | null => {
  const state = snapshot.history.at(-1);
  if (!state) return null;
  const graph = buildEndgameGraph(state, topology);
  const group = graph.groups.get(groupKey);
  if (!group) return null;

  const root = createEndgameProofSearchNode(
    topology,
    state,
    group.color,
    group.points,
    role,
    previousBoardFor(snapshot),
  );
  return Object.freeze({
    firstPlayer: role,
    result: searchDeterministicAndOrProof(
      root,
      createTacticalExtensionProofSearchGoAdapter(topology),
      Object.freeze({ nodeBudget }),
    ),
  });
};

const verdictFor = (
  attackerFirst: DeterministicProofSearchResult,
  defenderFirst: DeterministicProofSearchResult,
  eyeSpace: SmallEyeSpaceAnalysis | null,
  semeai: readonly SemeaiSekiAnalysis[],
): Engine2PlaytestVerdict => {
  if (semeai.some((analysis) => analysis.seki.status === 'proven-seki')) {
    return 'proven-seki';
  }

  if (
    attackerFirst.outcome === 'proven-kill' &&
    defenderFirst.outcome === 'proven-kill'
  ) {
    return 'proven-dead';
  }

  if (
    attackerFirst.outcome === 'proven-survival' &&
    defenderFirst.outcome === 'proven-survival'
  ) {
    return 'proven-alive';
  }

  if (
    (attackerFirst.outcome === 'proven-kill' &&
      defenderFirst.outcome === 'proven-survival') ||
    (attackerFirst.outcome === 'proven-survival' &&
      defenderFirst.outcome === 'proven-kill')
  ) {
    return 'first-player-dependent';
  }

  if (
    attackerFirst.outcome === 'ko-dependent' ||
    defenderFirst.outcome === 'ko-dependent' ||
    eyeSpace?.koDependent ||
    semeai.some((analysis) => analysis.seki.status === 'ko-dependent')
  ) {
    return 'ko-dependent';
  }

  if (
    attackerFirst.outcome === 'budget-exhausted' ||
    defenderFirst.outcome === 'budget-exhausted' ||
    eyeSpace?.unresolvedReasons.includes('node-budget-exhausted')
  ) {
    return 'budget-exhausted';
  }

  return 'unresolved';
};

/**
 * Diagnostic-only bridge from a real saved game to the completed Engine 2 proof
 * stack. It never writes a classification or score. Both first-player orders
 * are searched independently, eye-space evidence is reported separately, and
 * seki is accepted only through the strict E2-9 certificate.
 */
export const analyzeEngine2PlaytestGroup = (
  snapshot: GameSessionSnapshot,
  topology: Topology,
  selectedPoint: PointId,
  options: Engine2PlaytestDiagnosticOptions = Object.freeze({}),
): Engine2PlaytestDiagnostic | null => {
  const state = snapshot.history.at(-1);
  if (!state || !topology.has(selectedPoint)) return null;

  const graph = buildEndgameGraph(state, topology);
  const groupKey = graph.pointOwner.get(selectedPoint);
  if (!groupKey) return null;
  const group = graph.groups.get(groupKey);
  if (!group) return null;

  const nodeBudget = options.nodeBudget ?? DEFAULT_ENGINE2_PLAYTEST_NODE_BUDGET;
  if (!Number.isSafeInteger(nodeBudget) || nodeBudget < 1) {
    throw new Error(`Engine2 playtest nodeBudget must be a positive safe integer, got ${nodeBudget}`);
  }

  const attackerFirst = proofFor(snapshot, topology, groupKey, 'attacker', nodeBudget);
  const defenderFirst = proofFor(snapshot, topology, groupKey, 'defender', nodeBudget);
  if (!attackerFirst || !defenderFirst) return null;

  const previousBoard = previousBoardFor(snapshot);
  const eyeSpace = analyzeSmallEyeSpace(
    state,
    topology,
    groupKey,
    Object.freeze({
      nodeBudget,
      ...(previousBoard ? { previousBoard } : {}),
    }),
  );

  const semeai = Object.freeze(
    graph.sharedLiberties.flatMap((shared) => {
      if (!shared.groupKeys.includes(groupKey)) return [];
      const otherKey = shared.groupKeys[0] === groupKey
        ? shared.groupKeys[1]
        : shared.groupKeys[0];
      const other = graph.groups.get(otherKey);
      if (!other || other.color === group.color) return [];
      const analysis = analyzeSemeaiSeki(
        state,
        topology,
        groupKey,
        otherKey,
        Object.freeze({
          nodeBudget,
          includeKillProofs: false,
          ...(previousBoard ? { previousBoard } : {}),
        }),
      );
      return analysis ? [analysis] : [];
    }),
  );

  return Object.freeze({
    algorithm: ENGINE2_PLAYTEST_DIAGNOSTIC_ALGORITHM,
    groupKey,
    color: group.color,
    points: group.points,
    liberties: group.liberties,
    verdict: verdictFor(
      attackerFirst.result,
      defenderFirst.result,
      eyeSpace,
      semeai,
    ),
    attackerFirst,
    defenderFirst,
    eyeSpace,
    semeai,
    nodeBudget,
    previousBoardKnown: Boolean(previousBoard),
  });
};
