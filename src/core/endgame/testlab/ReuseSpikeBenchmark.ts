import type { EndgameProposalStatus } from '../EndgameClassifier';
import {
  buildReuseSpikeCorpus,
  type ReuseSpikeCorpusCase,
} from './ReuseSpikeCorpus';
import type { ReferenceStatus } from './TestCase';

export type ReuseSpikeCandidateId =
  | 'tsumego-js'
  | 'cameron-martin'
  | 'relevance-zone'
  | 'darkforest';

export type ReuseSpikeSolverStatus =
  | EndgameProposalStatus
  | 'unsupported'
  | 'error';

export interface ReuseSpikeSolverResult {
  readonly status: ReuseSpikeSolverStatus;
  readonly move?: string;
  readonly nodes?: number;
  readonly detail?: string;
}

/**
 * Thin Work 1 boundary around an external solver. Production endgame code must
 * never depend on this interface; adapters exist only to compare candidates on
 * the same deterministic planar corpus.
 */
export interface ReuseSpikeSolverAdapter {
  readonly id: ReuseSpikeCandidateId;
  readonly revision: string;
  solve(problem: ReuseSpikeCorpusCase): Promise<ReuseSpikeSolverResult>;
}

export type ReuseSpikeCorrectness = 'match' | 'mismatch' | 'not-scored';

export interface ReuseSpikeBenchmarkCaseResult {
  readonly id: string;
  readonly sourceStatus: ReferenceStatus;
  readonly solverStatus: ReuseSpikeSolverStatus;
  readonly correctness: ReuseSpikeCorrectness;
  readonly elapsedMs: number;
  readonly nodes?: number;
  readonly move?: string;
  readonly detail?: string;
}

export interface ReuseSpikeBenchmarkSummary {
  readonly candidate: ReuseSpikeCandidateId;
  readonly revision: string;
  readonly totalCases: number;
  readonly scoredCases: number;
  readonly matches: number;
  readonly mismatches: number;
  readonly unsupported: number;
  readonly errors: number;
  readonly totalElapsedMs: number;
  readonly meanElapsedMs: number;
  readonly totalNodes?: number;
  readonly cases: readonly ReuseSpikeBenchmarkCaseResult[];
}

export type ReuseSpikeClock = () => number;

const isScorableReference = (
  status: ReferenceStatus,
): status is EndgameProposalStatus =>
  status === 'alive' ||
  status === 'dead' ||
  status === 'seki' ||
  status === 'unresolved';

const classifyCorrectness = (
  sourceStatus: ReferenceStatus,
  solverStatus: ReuseSpikeSolverStatus,
): ReuseSpikeCorrectness => {
  if (!isScorableReference(sourceStatus)) return 'not-scored';
  if (solverStatus === 'unsupported' || solverStatus === 'error') return 'mismatch';
  return sourceStatus === solverStatus ? 'match' : 'mismatch';
};

const finiteElapsed = (start: number, end: number): number => {
  const elapsed = end - start;
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : 0;
};

/**
 * Runs cases sequentially on purpose: Work 1 compares solver behavior and cost,
 * not host parallelism. A candidate that throws is recorded as an error and the
 * rest of the corpus still runs.
 */
export const runReuseSpikeBenchmark = async (
  adapter: ReuseSpikeSolverAdapter,
  corpus: readonly ReuseSpikeCorpusCase[] = buildReuseSpikeCorpus(),
  now: ReuseSpikeClock = () => performance.now(),
): Promise<ReuseSpikeBenchmarkSummary> => {
  const cases: ReuseSpikeBenchmarkCaseResult[] = [];

  for (const problem of corpus) {
    const started = now();
    let result: ReuseSpikeSolverResult;

    try {
      result = await adapter.solve(problem);
    } catch (error) {
      result = {
        status: 'error',
        detail: error instanceof Error ? error.message : String(error),
      };
    }

    const elapsedMs = finiteElapsed(started, now());
    cases.push(
      Object.freeze({
        id: problem.id,
        sourceStatus: problem.sourceStatus,
        solverStatus: result.status,
        correctness: classifyCorrectness(problem.sourceStatus, result.status),
        elapsedMs,
        ...(result.nodes === undefined ? {} : { nodes: result.nodes }),
        ...(result.move === undefined ? {} : { move: result.move }),
        ...(result.detail === undefined ? {} : { detail: result.detail }),
      }),
    );
  }

  const scored = cases.filter(({ correctness }) => correctness !== 'not-scored');
  const totalElapsedMs = cases.reduce((sum, result) => sum + result.elapsedMs, 0);
  const nodeCounts = cases
    .map(({ nodes }) => nodes)
    .filter((nodes): nodes is number => nodes !== undefined);

  return Object.freeze({
    candidate: adapter.id,
    revision: adapter.revision,
    totalCases: cases.length,
    scoredCases: scored.length,
    matches: scored.filter(({ correctness }) => correctness === 'match').length,
    mismatches: scored.filter(({ correctness }) => correctness === 'mismatch').length,
    unsupported: cases.filter(({ solverStatus }) => solverStatus === 'unsupported').length,
    errors: cases.filter(({ solverStatus }) => solverStatus === 'error').length,
    totalElapsedMs,
    meanElapsedMs: cases.length === 0 ? 0 : totalElapsedMs / cases.length,
    ...(nodeCounts.length === 0
      ? {}
      : { totalNodes: nodeCounts.reduce((sum, nodes) => sum + nodes, 0) }),
    cases: Object.freeze(cases),
  });
};
