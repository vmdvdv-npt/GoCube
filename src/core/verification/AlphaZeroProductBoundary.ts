import { CubeTopology, isValidCubeSize } from '../topology/CubeTopology';
import type { PointId, Topology } from '../topology/Topology';
import { TORUS_SIZES, TorusTopology } from '../topology/TorusTopology';
import type { CaptureCounts, RuleSet, StoneColor } from '../game/types';

export const PRODUCT_BOUNDARY_SCHEMA = 'gocube-product-boundary-v1' as const;
export const PRODUCT_BOUNDARY_ACTION_CONTRACT = 'gocube-action-point-id-pass-v1' as const;
export const PRODUCT_BOUNDARY_F0_CONTRACT = 'gocube-f0-integrated-freeze-v1' as const;
export const PRODUCT_BOUNDARY_SOURCE_REPO = 'vmdvdv-npt/gocube-alphazero' as const;

export type ProductBoundaryTopology = 'cube' | 'torus';

export interface ProductBoundaryBoard {
  readonly black: readonly PointId[];
  readonly white: readonly PointId[];
}

export interface ProductBoundaryAction {
  readonly type: 'place' | 'pass';
  readonly pointId?: PointId;
  readonly alphaZeroPointId?: string;
  readonly alphaZeroActionIndex?: number;
}

export interface ProductBoundaryStep {
  readonly index: number;
  readonly playerBefore: StoneColor;
  readonly action: ProductBoundaryAction;
  readonly legal: true;
  readonly capturedPoints: readonly PointId[];
  readonly board: ProductBoundaryBoard;
  readonly captures: CaptureCounts;
  readonly nextPlayer: StoneColor;
  readonly consecutivePasses: number;
}

export interface ProductBoundaryPassSnapshot {
  readonly board: ProductBoundaryBoard;
  readonly captures: CaptureCounts;
  readonly playerToMove: StoneColor;
  readonly consecutivePasses: number;
}

export interface ProductBoundaryExpectedBoundary extends ProductBoundaryPassSnapshot {
  readonly phase: 'endgame';
}

export interface ProductBoundaryPointMapping {
  readonly alphaZeroPointId: string;
  readonly productPointId: PointId;
  readonly alphaZeroActionIndex: number;
}

export interface ProductBoundaryTopologyContract {
  readonly topology: ProductBoundaryTopology;
  readonly size: number;
  readonly pointIds: readonly string[];
  readonly pointMapping: readonly ProductBoundaryPointMapping[];
  readonly adjacency: Readonly<Record<string, readonly string[]>>;
}

export interface ProductBoundaryProvenance {
  readonly sourceRepo: string;
  readonly f0ContractId: string;
  readonly v1FixtureId: string;
  readonly v1Status: 'verified';
}

export interface ProductBoundaryClassificationGroup {
  readonly points: readonly PointId[];
  readonly status: 'alive' | 'dead' | 'seki';
  readonly source?: 'automatic' | 'user';
}

export interface ProductBoundaryFixture {
  readonly schema: typeof PRODUCT_BOUNDARY_SCHEMA;
  readonly fixtureId: string;
  readonly sourceVerificationId: string;
  readonly sourceVerificationStatus: 'verified';
  readonly provenance: ProductBoundaryProvenance;
  readonly topology: ProductBoundaryTopology;
  readonly size: number;
  readonly ruleSet: RuleSet;
  readonly komi: 0.5;
  readonly topologyContract: ProductBoundaryTopologyContract;
  readonly initialPosition: ProductBoundaryBoard;
  readonly initialPlayer: StoneColor;
  readonly mainActions: readonly ProductBoundaryAction[];
  readonly steps: readonly ProductBoundaryStep[];
  readonly afterFirstPass: ProductBoundaryPassSnapshot;
  readonly afterSecondPass: ProductBoundaryPassSnapshot;
  readonly expectedProductBoundary: ProductBoundaryExpectedBoundary;
  readonly expectedEndgameClassification: readonly ProductBoundaryClassificationGroup[];
  readonly expectedFinalScore: Readonly<Record<string, unknown>> | null;
  readonly trainingInternalCleanup: Readonly<Record<string, unknown>>;
}

export class ProductBoundaryFixtureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductBoundaryFixtureError';
  }
}

const fail = (context: string, message: string): never => {
  throw new ProductBoundaryFixtureError(`${context}: ${message}`);
};

const record = (value: unknown, context: string): Readonly<Record<string, unknown>> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(context, 'must be an object');
  }
  return value as Readonly<Record<string, unknown>>;
};

const required = (value: Readonly<Record<string, unknown>>, key: string, context: string): unknown => {
  if (!Object.prototype.hasOwnProperty.call(value, key)) return fail(context, `missing ${key}`);
  return value[key];
};

const stringValue = (value: unknown, context: string): string => {
  if (typeof value !== 'string' || value.length === 0) return fail(context, 'must be a non-empty string');
  return value;
};

const integerValue = (value: unknown, context: string, minimum = 0): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    return fail(context, `must be a safe integer >= ${minimum}`);
  }
  return value;
};

const finiteNumber = (value: unknown, context: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fail(context, 'must be finite number');
  return value;
};

const colorValue = (value: unknown, context: string): StoneColor => {
  if (value !== 'black' && value !== 'white') return fail(context, 'must be black or white');
  return value;
};

const topologyFor = (kind: ProductBoundaryTopology, size: number, context: string): Topology => {
  if (kind === 'cube') {
    if (!isValidCubeSize(size)) return fail(context, `unsupported Cube size ${size}`);
    return new CubeTopology(size);
  }
  if (!TORUS_SIZES.includes(size as (typeof TORUS_SIZES)[number])) {
    return fail(context, `unsupported Torus size ${size}`);
  }
  return new TorusTopology(size as (typeof TORUS_SIZES)[number]);
};

const topologyKind = (value: unknown, context: string): ProductBoundaryTopology => {
  if (value !== 'cube' && value !== 'torus') return fail(context, 'must be cube or torus');
  return value;
};

const ruleSetValue = (value: unknown, context: string): RuleSet => {
  if (value !== 'chinese' && value !== 'japanese') return fail(context, 'must be chinese or japanese');
  return value;
};

const uniqueStrings = (value: unknown, context: string): readonly string[] => {
  if (!Array.isArray(value)) return fail(context, 'must be an array');
  const result = value.map((item, index) => stringValue(item, `${context}[${index}]`));
  if (new Set(result).size !== result.length) return fail(context, 'must not contain duplicates');
  return Object.freeze(result);
};

const sameSet = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value) => right.includes(value));

const parseBoard = (value: unknown, topology: Topology, context: string): ProductBoundaryBoard => {
  const input = record(value, context);
  const black = uniqueStrings(required(input, 'black', context), `${context}.black`);
  const white = uniqueStrings(required(input, 'white', context), `${context}.white`);
  for (const point of [...black, ...white]) {
    if (!topology.has(point)) return fail(`${context}.${point}`, `unknown point for ${topology.id}`);
  }
  if (black.some((point) => white.includes(point))) return fail(context, 'black and white overlap');
  return Object.freeze({ black: black as readonly PointId[], white: white as readonly PointId[] });
};

const parseCaptures = (value: unknown, context: string): CaptureCounts => {
  const input = record(value, context);
  return Object.freeze({
    black: integerValue(required(input, 'black', context), `${context}.black`),
    white: integerValue(required(input, 'white', context), `${context}.white`),
  });
};

const parseTopologyContract = (
  value: unknown,
  topology: Topology,
  kind: ProductBoundaryTopology,
  size: number,
  context: string,
): ProductBoundaryTopologyContract => {
  const input = record(value, context);
  if (topologyKind(required(input, 'topology', context), `${context}.topology`) !== kind) {
    return fail(context, 'topology does not match fixture');
  }
  if (integerValue(required(input, 'size', context), `${context}.size`) !== size) {
    return fail(context, 'size does not match fixture');
  }

  const pointIds = uniqueStrings(required(input, 'point_ids', context), `${context}.point_ids`);
  const actualPoints = topology.points();
  if (pointIds.length !== actualPoints.length || !sameSet(pointIds, actualPoints)) {
    return fail(context, 'point_ids do not cover product topology exactly');
  }

  const rawMapping = required(input, 'point_mapping', context);
  if (!Array.isArray(rawMapping)) return fail(`${context}.point_mapping`, 'must be an array');
  const mapping = rawMapping.map((item, index) => {
    const entry = record(item, `${context}.point_mapping[${index}]`);
    const alphaZeroPointId = stringValue(
      required(entry, 'alpha_zero_point_id', `${context}.point_mapping[${index}]`),
      `${context}.point_mapping[${index}].alpha_zero_point_id`,
    );
    const productPointId = stringValue(
      required(entry, 'product_point_id', `${context}.point_mapping[${index}]`),
      `${context}.point_mapping[${index}].product_point_id`,
    );
    const alphaZeroActionIndex = integerValue(
      required(entry, 'alpha_zero_action_index', `${context}.point_mapping[${index}]`),
      `${context}.point_mapping[${index}].alpha_zero_action_index`,
    );
    if (!pointIds.includes(alphaZeroPointId)) return fail(`${context}.point_mapping[${index}]`, 'unknown AlphaZero point');
    if (!topology.has(productPointId)) return fail(`${context}.point_mapping[${index}]`, 'unknown product point');
    if (alphaZeroActionIndex !== index) return fail(`${context}.point_mapping[${index}]`, 'action index is not canonical');
    return Object.freeze({ alphaZeroPointId, productPointId, alphaZeroActionIndex });
  });
  if (mapping.length !== actualPoints.length) return fail(context, 'mapping does not contain every point');
  if (new Set(mapping.map((entry) => entry.alphaZeroPointId)).size !== mapping.length) return fail(context, 'duplicate AlphaZero PointId');
  if (new Set(mapping.map((entry) => entry.productPointId)).size !== mapping.length) return fail(context, 'duplicate product PointId');
  if (!sameSet(mapping.map((entry) => entry.alphaZeroPointId), pointIds)) return fail(context, 'mapping misses an AlphaZero PointId');
  if (!sameSet(mapping.map((entry) => entry.productPointId), actualPoints)) return fail(context, 'mapping misses a product PointId');

  const byAlpha = new Map(mapping.map((entry) => [entry.alphaZeroPointId, entry.productPointId]));
  const rawAdjacency = record(required(input, 'adjacency', context), `${context}.adjacency`);
  const adjacencyKeys = Object.keys(rawAdjacency);
  if (adjacencyKeys.length !== pointIds.length || !sameSet(adjacencyKeys, pointIds)) {
    return fail(context, 'adjacency must contain exactly one entry for every AlphaZero PointId');
  }
  const adjacency: Record<string, readonly string[]> = {};
  for (const alphaPointId of pointIds) {
    const neighbors = uniqueStrings(required(rawAdjacency, alphaPointId, `${context}.adjacency`), `${context}.adjacency.${alphaPointId}`);
    const productPointId = byAlpha.get(alphaPointId);
    if (!productPointId) return fail(context, `mapping missing ${alphaPointId}`);
    const mappedNeighbors = neighbors.map((neighbor) => {
      const mapped = byAlpha.get(neighbor);
      if (!mapped) return fail(`${context}.adjacency.${alphaPointId}`, `unknown neighbor ${neighbor}`);
      return mapped;
    });
    const productNeighbors = topology.neighbors(productPointId);
    if (!sameSet(mappedNeighbors, productNeighbors)) {
      return fail(`${context}.adjacency.${alphaPointId}`, 'neighbor set differs from product topology');
    }
    adjacency[alphaPointId] = Object.freeze([...neighbors]);
  }

  return Object.freeze({
    topology: kind,
    size,
    pointIds: Object.freeze([...pointIds]),
    pointMapping: Object.freeze(mapping),
    adjacency: Object.freeze(adjacency),
  });
};

const parseAction = (
  value: unknown,
  topology: Topology,
  mapping: ProductBoundaryTopologyContract,
  context: string,
): ProductBoundaryAction => {
  const input = record(value, context);
  const type = required(input, 'type', context);
  if (type === 'pass') return Object.freeze({ type: 'pass' });
  if (type !== 'place') return fail(`${context}.type`, 'must be place or pass');
  const pointId = stringValue(required(input, 'point_id', context), `${context}.point_id`);
  if (!topology.has(pointId)) return fail(`${context}.point_id`, 'unknown product PointId');
  const result: ProductBoundaryAction = { type: 'place', pointId };
  const alphaPoint = Object.prototype.hasOwnProperty.call(input, 'alpha_zero_point_id')
    ? stringValue(input.alpha_zero_point_id, `${context}.alpha_zero_point_id`)
    : undefined;
  const entry = alphaPoint === undefined
    ? undefined
    : mapping.pointMapping.find((candidate) => candidate.alphaZeroPointId === alphaPoint);
  if (alphaPoint !== undefined && !entry) return fail(`${context}.alpha_zero_point_id`, 'not in topology mapping');
  if (entry && entry.productPointId !== pointId) return fail(context, 'AlphaZero/product action mapping disagrees');
  const actionIndex = Object.prototype.hasOwnProperty.call(input, 'alpha_zero_action_index')
    ? integerValue(input.alpha_zero_action_index, `${context}.alpha_zero_action_index`)
    : undefined;
  if (entry && actionIndex !== undefined && actionIndex !== entry.alphaZeroActionIndex) {
    return fail(context, 'AlphaZero action index disagrees with mapping');
  }
  return Object.freeze({
    ...result,
    ...(alphaPoint === undefined ? {} : { alphaZeroPointId: alphaPoint }),
    ...(actionIndex === undefined ? {} : { alphaZeroActionIndex: actionIndex }),
  });
};

const actionKey = (action: ProductBoundaryAction): string =>
  action.type === 'pass' ? 'pass' : `place:${action.pointId}`;

const parseStep = (
  value: unknown,
  index: number,
  topology: Topology,
  mapping: ProductBoundaryTopologyContract,
  context: string,
): ProductBoundaryStep => {
  const input = record(value, context);
  if (integerValue(required(input, 'index', context), `${context}.index`) !== index) return fail(context, 'index is not sequential');
  if (required(input, 'legal', context) !== true) return fail(`${context}.legal`, 'must be true');
  const playerBefore = colorValue(required(input, 'player_before', context), `${context}.player_before`);
  const nextPlayer = colorValue(required(input, 'next_player', context), `${context}.next_player`);
  return Object.freeze({
    index,
    playerBefore,
    action: parseAction(required(input, 'action', context), topology, mapping, `${context}.action`),
    legal: true,
    capturedPoints: parseBoard({ black: required(input, 'captured_points', context), white: [] }, topology, context).black,
    board: parseBoard(required(input, 'board', context), topology, `${context}.board`),
    captures: parseCaptures(required(input, 'captures', context), `${context}.captures`),
    nextPlayer,
    consecutivePasses: integerValue(required(input, 'consecutive_passes', context), `${context}.consecutive_passes`),
  });
};

const parsePassSnapshot = (
  value: unknown,
  topology: Topology,
  context: string,
  expectedPasses: number,
): ProductBoundaryPassSnapshot => {
  const input = record(value, context);
  const consecutivePasses = integerValue(required(input, 'consecutive_passes', context), `${context}.consecutive_passes`);
  if (consecutivePasses !== expectedPasses) return fail(`${context}.consecutive_passes`, `must equal ${expectedPasses}`);
  return Object.freeze({
    board: parseBoard(required(input, 'board', context), topology, `${context}.board`),
    captures: parseCaptures(required(input, 'captures', context), `${context}.captures`),
    playerToMove: colorValue(required(input, 'player_to_move', context), `${context}.player_to_move`),
    consecutivePasses,
  });
};

const parseClassification = (
  value: unknown,
  topology: Topology,
  context: string,
): readonly ProductBoundaryClassificationGroup[] => {
  if (!Array.isArray(value)) return fail(context, 'must be an array');
  const groups = value.map((item, index) => {
    const input = record(item, `${context}[${index}]`);
    const status = required(input, 'status', `${context}[${index}]`);
    if (status !== 'alive' && status !== 'dead' && status !== 'seki') return fail(`${context}[${index}].status`, 'invalid status');
    const source = input.source;
    if (source !== undefined && source !== 'automatic' && source !== 'user') return fail(`${context}[${index}].source`, 'invalid source');
    return Object.freeze({
      points: parseBoard({ black: required(input, 'points', `${context}[${index}]`), white: [] }, topology, `${context}[${index}].points`).black,
      status,
      ...(source === undefined ? {} : { source }),
    });
  });
  const pointOwners = new Set<string>();
  for (const group of groups) {
    for (const point of group.points) {
      if (pointOwners.has(point)) return fail(context, `classification overlaps at ${point}`);
      pointOwners.add(point);
    }
  }
  return Object.freeze(groups);
};

const parseFixture = (value: unknown, index: number): ProductBoundaryFixture => {
  const input = record(value, `fixtures[${index}]`);
  if (required(input, 'schema', `fixtures[${index}]`) !== PRODUCT_BOUNDARY_SCHEMA) return fail(`fixtures[${index}].schema`, 'unsupported schema');
  const context = `fixtures[${index}]`;
  const fixtureId = stringValue(required(input, 'fixture_id', context), `${context}.fixture_id`);
  const sourceVerificationId = stringValue(required(input, 'source_verification_id', context), `${context}.source_verification_id`);
  const sourceVerificationStatus = stringValue(
    required(input, 'source_verification_status', context),
    `${context}.source_verification_status`,
  );
  if (sourceVerificationStatus !== 'verified') return fail(`${context}.source_verification_status`, 'V2 accepts only verified V1 sources');
  const provenanceInput = record(required(input, 'provenance', context), `${context}.provenance`);
  const sourceRepo = stringValue(
    required(provenanceInput, 'source_repo', `${context}.provenance`),
    `${context}.provenance.source_repo`,
  );
  if (sourceRepo !== PRODUCT_BOUNDARY_SOURCE_REPO) return fail(`${context}.provenance.source_repo`, 'unsupported source repository');
  const f0ContractId = stringValue(
    required(provenanceInput, 'f0_contract_id', `${context}.provenance`),
    `${context}.provenance.f0_contract_id`,
  );
  if (f0ContractId !== PRODUCT_BOUNDARY_F0_CONTRACT) return fail(`${context}.provenance.f0_contract_id`, 'unsupported F0 contract');
  const v1FixtureId = stringValue(
    required(provenanceInput, 'v1_fixture_id', `${context}.provenance`),
    `${context}.provenance.v1_fixture_id`,
  );
  const v1Status = stringValue(
    required(provenanceInput, 'v1_status', `${context}.provenance`),
    `${context}.provenance.v1_status`,
  );
  if (v1Status !== 'verified') return fail(`${context}.provenance.v1_status`, 'must be verified');
  if (v1FixtureId !== sourceVerificationId) return fail(context, 'source verification IDs disagree');
  if (sourceVerificationStatus !== v1Status) return fail(context, 'source verification statuses disagree');
  const provenance = Object.freeze({
    sourceRepo,
    f0ContractId,
    v1FixtureId,
    v1Status: 'verified' as const,
  });

  const kind = topologyKind(required(input, 'topology', context), `${context}.topology`);
  const size = integerValue(required(input, 'size', context), `${context}.size`, 2);
  const topology = topologyFor(kind, size, `${context}.topology`);
  const topologyContract = parseTopologyContract(required(input, 'topology_contract', context), topology, kind, size, `${context}.topology_contract`);
  const ruleSet = ruleSetValue(required(input, 'rule_set', context), `${context}.rule_set`);
  const komi = finiteNumber(required(input, 'komi', context), `${context}.komi`);
  if (komi !== 0.5) return fail(`${context}.komi`, 'V2 requires exact komi 0.5');
  const initialPosition = parseBoard(required(input, 'initial_position', context), topology, `${context}.initial_position`);
  const initialPlayer = colorValue(required(input, 'initial_player', context), `${context}.initial_player`);
  if (required(input, 'action_contract', context) !== PRODUCT_BOUNDARY_ACTION_CONTRACT) return fail(context, 'unsupported action contract');
  const rawActions = required(input, 'main_actions', context);
  if (!Array.isArray(rawActions)) return fail(`${context}.main_actions`, 'must be an array');
  const mainActions = Object.freeze(rawActions.map((action, actionIndex) => parseAction(action, topology, topologyContract, `${context}.main_actions[${actionIndex}]`)));
  const rawSteps = required(input, 'steps', context);
  if (!Array.isArray(rawSteps) || rawSteps.length !== mainActions.length) return fail(`${context}.steps`, 'must have one entry per MAIN action');
  const steps = Object.freeze(rawSteps.map((step, stepIndex) => parseStep(step, stepIndex, topology, topologyContract, `${context}.steps[${stepIndex}]`)));
  steps.forEach((step, stepIndex) => {
    if (actionKey(step.action) !== actionKey(mainActions[stepIndex]!)) return fail(`${context}.steps[${stepIndex}]`, 'action differs from main_actions');
    if (step.playerBefore !== (stepIndex === 0 ? initialPlayer : steps[stepIndex - 1]!.nextPlayer)) return fail(`${context}.steps[${stepIndex}]`, 'player sequence differs from initial_player');
  });
  const firstPass = parsePassSnapshot(required(input, 'after_first_pass', context), topology, `${context}.after_first_pass`, 1);
  const secondPass = parsePassSnapshot(required(input, 'after_second_pass', context), topology, `${context}.after_second_pass`, 2);
  const firstStep = steps.find((step) => step.consecutivePasses === 1);
  const secondStep = steps.find((step) => step.consecutivePasses === 2);
  if (!firstStep || !secondStep) return fail(context, 'fixture must contain first and second consecutive PASS snapshots');
  if (!sameBoard(firstStep.board, firstPass.board) || !sameCaptures(firstStep.captures, firstPass.captures) || firstStep.nextPlayer !== firstPass.playerToMove) return fail(context, 'after_first_pass differs from step snapshot');
  if (!sameBoard(secondStep.board, secondPass.board) || !sameCaptures(secondStep.captures, secondPass.captures) || secondStep.nextPlayer !== secondPass.playerToMove) return fail(context, 'after_second_pass differs from step snapshot');
  const boundaryInput = record(required(input, 'expected_product_boundary', context), `${context}.expected_product_boundary`);
  const expectedProductBoundary = Object.freeze({
    ...parsePassSnapshot(boundaryInput, topology, `${context}.expected_product_boundary`, 2),
    phase: required(boundaryInput, 'phase', `${context}.expected_product_boundary`) === 'endgame'
      ? 'endgame' as const
      : fail(`${context}.expected_product_boundary.phase`, 'must be endgame'),
  });
  if (!sameBoard(expectedProductBoundary.board, secondPass.board) || !sameCaptures(expectedProductBoundary.captures, secondPass.captures) || expectedProductBoundary.playerToMove !== secondPass.playerToMove) return fail(context, 'expected product boundary differs from AlphaZero boundary');
  const expectedFinalScoreValue = required(input, 'expected_final_score', context);
  const expectedFinalScore = expectedFinalScoreValue === null
    ? null
    : Object.freeze({ ...record(expectedFinalScoreValue, `${context}.expected_final_score`) });
  const cleanup = Object.freeze({ ...record(required(input, 'training_internal_cleanup', context), `${context}.training_internal_cleanup`) });

  return Object.freeze({
    schema: PRODUCT_BOUNDARY_SCHEMA,
    fixtureId,
    sourceVerificationId,
    sourceVerificationStatus: 'verified',
    provenance,
    topology: kind,
    size,
    ruleSet,
    komi: 0.5,
    topologyContract,
    initialPosition,
    initialPlayer,
    mainActions,
    steps,
    afterFirstPass: firstPass,
    afterSecondPass: secondPass,
    expectedProductBoundary,
    expectedEndgameClassification: parseClassification(required(input, 'expected_endgame_classification', context), topology, `${context}.expected_endgame_classification`),
    expectedFinalScore,
    trainingInternalCleanup: cleanup,
  });
};

const sameBoard = (left: ProductBoundaryBoard, right: ProductBoundaryBoard): boolean =>
  sameSet(left.black, right.black) && sameSet(left.white, right.white);

const sameCaptures = (left: CaptureCounts, right: CaptureCounts): boolean =>
  left.black === right.black && left.white === right.white;

export const parseAlphaZeroProductBoundaryDocument = (
  value: unknown,
): readonly ProductBoundaryFixture[] => {
  const input = record(value, 'productBoundaryDocument');
  if (required(input, 'schema', 'productBoundaryDocument') !== PRODUCT_BOUNDARY_SCHEMA) {
    return fail('productBoundaryDocument.schema', 'unsupported schema');
  }
  const rawFixtures = required(input, 'fixtures', 'productBoundaryDocument');
  if (!Array.isArray(rawFixtures)) return fail('productBoundaryDocument.fixtures', 'must be an array');
  const fixtures = rawFixtures.map(parseFixture);
  const ids = new Set<string>();
  for (const fixture of fixtures) {
    if (ids.has(fixture.fixtureId)) return fail('productBoundaryDocument.fixtures', `duplicate fixture ${fixture.fixtureId}`);
    ids.add(fixture.fixtureId);
  }
  return Object.freeze(fixtures);
};
