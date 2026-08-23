import { AssistedEndgameClassifier } from '../AssistedEndgameClassifier';
import type {
  EndgameAnalysisContext,
  EndgameProposal,
  EndgameProposalStatus,
  GroupStatus,
} from '../EndgameClassifier';
import { buildEndgameGraph } from '../EndgameGraphCore';
import { ManualEndgameClassifier } from '../ManualEndgameClassifier';
import type { GameState } from '../../game/types';
import type { PointId, Topology } from '../../topology/Topology';

export const WORK9_ACCEPTANCE_SCHEMA_VERSION = 1 as const;

export type Work9AcceptanceClass =
  | 'benson'
  | 'tactical'
  | 'local-life-death'
  | 'connection'
  | 'semeai'
  | 'seki';

export type Work9TopologyClass = 'arbitrary' | 'torus' | 'cube';

export type Work9DiscrepancyCategory =
  | 'none'
  | 'gocube-defect'
  | 'oracle-limitation'
  | 'rules-mismatch'
  | 'ko-history-mismatch'
  | 'unsupported-semantics'
  | 'heuristic-disagreement'
  | 'unresolved-by-gocube-by-design';

export interface Work9KnownAnswerCase {
  readonly id: string;
  readonly className: Work9AcceptanceClass;
  readonly topologyClass: Work9TopologyClass;
  readonly topology: Topology;
  readonly state: GameState;
  readonly targetPoint: PointId;
  readonly expectedStatus: EndgameProposalStatus;
  /** Human-auditable source of the expected answer. Never classifier-derived. */
  readonly provenance: string;
}

export interface Work9SearchCost {
  readonly exploredNodes: number;
  readonly transpositionHits: number;
}

export interface Work9ShadowRecord {
  readonly schemaVersion: typeof WORK9_ACCEPTANCE_SCHEMA_VERSION;
  readonly id: string;
  readonly className: Work9AcceptanceClass;
  readonly topologyClass: Work9TopologyClass;
  readonly expectedStatus: EndgameProposalStatus;
  readonly currentClassifierStatus: EndgameProposalStatus;
  readonly engineStatus: EndgameProposalStatus;
  readonly automatic: boolean;
  readonly evidenceAlgorithm: string | null;
  readonly unresolvedReason: string | null;
  readonly cost: Work9SearchCost;
  readonly discrepancy: Work9DiscrepancyCategory;
  readonly provenance: string;
}

export interface Work9AutomaticMetric {
  readonly correct: number;
  readonly falsePositive: number;
}

export interface Work9UnresolvedMetric {
  readonly expectedUnresolved: number;
  readonly missedResolvableCase: number;
}

export interface Work9BreakdownMetric {
  readonly total: number;
  readonly correctAutomatic: number;
  readonly falseAutomatic: number;
  readonly expectedUnresolved: number;
  readonly missedResolvableCase: number;
}

export interface Work9AcceptanceSummary {
  readonly total: number;
  readonly automatic: Readonly<Record<GroupStatus, Work9AutomaticMetric>>;
  readonly unresolved: Work9UnresolvedMetric;
  readonly byClass: Readonly<Record<Work9AcceptanceClass, Work9BreakdownMetric>>;
  readonly byTopology: Readonly<Record<Work9TopologyClass, Work9BreakdownMetric>>;
  readonly criticalFalseAutomaticStatuses: number;
}

const proposalForTarget = (
  proposal: EndgameProposal,
  targetPoint: PointId,
): EndgameProposal[number] => {
  const match = proposal.find((candidate) => candidate.points.includes(targetPoint));
  if (!match) throw new Error(`Work 9 target ${targetPoint} is absent from classifier output`);
  return match;
};

const readEvidenceString = (
  evidence: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | null => {
  const value = evidence?.[key];
  return typeof value === 'string' ? value : null;
};

const collectSearchCost = (value: unknown): Work9SearchCost => {
  let exploredNodes = 0;
  let transpositionHits = 0;
  const visited = new Set<object>();

  const visit = (current: unknown): void => {
    if (current === null || typeof current !== 'object') return;
    if (visited.has(current)) return;
    visited.add(current);

    if (Array.isArray(current)) {
      for (const item of current) visit(item);
      return;
    }

    for (const [key, item] of Object.entries(current as Readonly<Record<string, unknown>>)) {
      if (key === 'exploredNodes' && typeof item === 'number') exploredNodes += item;
      else if (key === 'transpositionHits' && typeof item === 'number') transpositionHits += item;
      else visit(item);
    }
  };

  visit(value);
  return Object.freeze({ exploredNodes, transpositionHits });
};

const contextForCase = (testCase: Work9KnownAnswerCase): EndgameAnalysisContext => {
  const graph = buildEndgameGraph(testCase.state.board, testCase.topology);
  if (!graph.stringByPoint.has(testCase.targetPoint)) {
    throw new Error(`Work 9 target ${testCase.targetPoint} is not a stone`);
  }
  return Object.freeze({
    state: testCase.state,
    topology: testCase.topology,
    groups: Object.freeze(graph.strings.map((group) => group.points)),
  });
};

export const runWork9ShadowCase = async (
  testCase: Work9KnownAnswerCase,
): Promise<Work9ShadowRecord> => {
  const context = contextForCase(testCase);
  const current = proposalForTarget(
    await new ManualEndgameClassifier().analyze(context),
    testCase.targetPoint,
  );
  const engine = proposalForTarget(
    await new AssistedEndgameClassifier().analyze(context),
    testCase.targetPoint,
  );

  const automatic = engine.source === 'automatic';
  let discrepancy: Work9DiscrepancyCategory = 'none';
  if (engine.status !== testCase.expectedStatus) {
    discrepancy = automatic ? 'gocube-defect' : 'unresolved-by-gocube-by-design';
  }

  return Object.freeze({
    schemaVersion: WORK9_ACCEPTANCE_SCHEMA_VERSION,
    id: testCase.id,
    className: testCase.className,
    topologyClass: testCase.topologyClass,
    expectedStatus: testCase.expectedStatus,
    currentClassifierStatus: current.status,
    engineStatus: engine.status,
    automatic,
    evidenceAlgorithm: readEvidenceString(engine.evidence, 'algorithm'),
    unresolvedReason: engine.status === 'unresolved' ? 'no-authoritative-proof' : null,
    cost: collectSearchCost(engine.evidence),
    discrepancy,
    provenance: testCase.provenance,
  });
};

const emptyBreakdown = (): Work9BreakdownMetric =>
  Object.freeze({
    total: 0,
    correctAutomatic: 0,
    falseAutomatic: 0,
    expectedUnresolved: 0,
    missedResolvableCase: 0,
  });

const addToBreakdown = (
  metric: Work9BreakdownMetric,
  record: Work9ShadowRecord,
): Work9BreakdownMetric => {
  const correctAutomatic =
    record.automatic && record.engineStatus === record.expectedStatus ? 1 : 0;
  const falseAutomatic =
    record.automatic && record.engineStatus !== record.expectedStatus ? 1 : 0;
  const expectedUnresolved =
    record.engineStatus === 'unresolved' && record.expectedStatus === 'unresolved' ? 1 : 0;
  const missedResolvableCase =
    record.engineStatus === 'unresolved' && record.expectedStatus !== 'unresolved' ? 1 : 0;

  return Object.freeze({
    total: metric.total + 1,
    correctAutomatic: metric.correctAutomatic + correctAutomatic,
    falseAutomatic: metric.falseAutomatic + falseAutomatic,
    expectedUnresolved: metric.expectedUnresolved + expectedUnresolved,
    missedResolvableCase: metric.missedResolvableCase + missedResolvableCase,
  });
};

export const summarizeWork9Acceptance = (
  records: readonly Work9ShadowRecord[],
): Work9AcceptanceSummary => {
  const ids = new Set<string>();
  const automatic: Record<GroupStatus, { correct: number; falsePositive: number }> = {
    alive: { correct: 0, falsePositive: 0 },
    dead: { correct: 0, falsePositive: 0 },
    seki: { correct: 0, falsePositive: 0 },
  };
  let expectedUnresolved = 0;
  let missedResolvableCase = 0;

  const byClass: Record<Work9AcceptanceClass, Work9BreakdownMetric> = {
    benson: emptyBreakdown(),
    tactical: emptyBreakdown(),
    'local-life-death': emptyBreakdown(),
    connection: emptyBreakdown(),
    semeai: emptyBreakdown(),
    seki: emptyBreakdown(),
  };
  const byTopology: Record<Work9TopologyClass, Work9BreakdownMetric> = {
    arbitrary: emptyBreakdown(),
    torus: emptyBreakdown(),
    cube: emptyBreakdown(),
  };

  for (const record of records) {
    if (ids.has(record.id)) throw new Error(`Duplicate Work 9 acceptance id: ${record.id}`);
    ids.add(record.id);

    if (record.automatic && record.engineStatus !== 'unresolved') {
      const metric = automatic[record.engineStatus];
      if (record.engineStatus === record.expectedStatus) metric.correct += 1;
      else metric.falsePositive += 1;
    } else if (record.engineStatus === 'unresolved') {
      if (record.expectedStatus === 'unresolved') expectedUnresolved += 1;
      else missedResolvableCase += 1;
    }

    byClass[record.className] = addToBreakdown(byClass[record.className], record);
    byTopology[record.topologyClass] = addToBreakdown(
      byTopology[record.topologyClass],
      record,
    );
  }

  const frozenAutomatic = Object.freeze({
    alive: Object.freeze({ ...automatic.alive }),
    dead: Object.freeze({ ...automatic.dead }),
    seki: Object.freeze({ ...automatic.seki }),
  });
  const criticalFalseAutomaticStatuses =
    frozenAutomatic.alive.falsePositive +
    frozenAutomatic.dead.falsePositive +
    frozenAutomatic.seki.falsePositive;

  return Object.freeze({
    total: records.length,
    automatic: frozenAutomatic,
    unresolved: Object.freeze({ expectedUnresolved, missedResolvableCase }),
    byClass: Object.freeze({ ...byClass }),
    byTopology: Object.freeze({ ...byTopology }),
    criticalFalseAutomaticStatuses,
  });
};
