import type { EndgameProposalStatus } from '../EndgameClassifier';
import type { GameState, StoneColor } from '../../game/types';
import type { PointId } from '../../topology/Topology';
import type { GeneratedGameCommand } from './EndgameFixture';

export const TEST_CASE_ID_SCHEMA_VERSION = 1 as const;
export const TEST_CASE_SOURCE_VERSION = 1 as const;

export type TestCaseSource = 'game-like' | 'synthetic-endgame' | 'corpus';
export type TestCaseTopology = 'torus' | 'cube';
export type TestCaseLoadStrategy = 'replay-commands' | 'snapshot';

export type ReferenceStatus =
  | EndgameProposalStatus
  | 'unknown'
  | 'unavailable'
  | 'unstable';

export interface TestCaseIdentity {
  readonly schemaVersion: typeof TEST_CASE_ID_SCHEMA_VERSION;
  readonly sourceVersion: typeof TEST_CASE_SOURCE_VERSION;
  readonly source: TestCaseSource;
  readonly topology: TestCaseTopology;
  readonly size: number;
  /** Source-specific stable scenario/catalog variant. */
  readonly variant: number;
  /** Source-specific placement/orientation transform. */
  readonly transform: number;
  /** uint32 seed for generated cases or stable catalog index for corpus cases. */
  readonly payload: number;
}

export interface TestCasePlanarStone {
  readonly row: number;
  readonly column: number;
  readonly color: StoneColor;
}

export interface TestCaseSourcePosition {
  readonly boardSize: number;
  readonly currentPlayer: StoneColor;
  readonly stones: readonly TestCasePlanarStone[];
  readonly targetCoordinates: readonly Readonly<{ row: number; column: number }>[];
}

export interface TestCaseDiagnostics {
  readonly sourceId: string;
  readonly sourceAnswer?: string;
  readonly sourceStatus: ReferenceStatus;
  readonly kataGoStatus: ReferenceStatus;
  readonly cubeGoStatus: ReferenceStatus;
  readonly attention: boolean;
  readonly attentionReason?: string;
  readonly sourcePosition: TestCaseSourcePosition;
}

export interface ReplayableTestCase {
  readonly testId: string;
  readonly identity: TestCaseIdentity;
  readonly state: GameState;
  readonly loadStrategy: TestCaseLoadStrategy;
  readonly commands: readonly GeneratedGameCommand[];
  readonly targetPoints: readonly PointId[];
  readonly diagnostics?: TestCaseDiagnostics;
  readonly scenario: string;
  readonly tags: readonly string[];
}

const SCHEMA_BITS = 4n;
const SOURCE_VERSION_BITS = 4n;
const SOURCE_BITS = 2n;
const TOPOLOGY_BITS = 1n;
const SIZE_BITS = 6n;
const VARIANT_BITS = 6n;
const TRANSFORM_BITS = 6n;
const PAYLOAD_BITS = 32n;

const bitMask = (bits: bigint): bigint => (1n << bits) - 1n;

const SOURCE_CODES: Readonly<Record<TestCaseSource, number>> = Object.freeze({
  'game-like': 0,
  'synthetic-endgame': 1,
  corpus: 2,
});

const sourceFromCode = (code: number): TestCaseSource => {
  switch (code) {
    case 0:
      return 'game-like';
    case 1:
      return 'synthetic-endgame';
    case 2:
      return 'corpus';
    default:
      throw new Error(`Unsupported Test ID source code: ${String(code)}`);
  }
};

const topologyCode = (topology: TestCaseTopology): number =>
  topology === 'cube' ? 1 : 0;

const topologyFromCode = (code: number): TestCaseTopology => {
  if (code === 0) return 'torus';
  if (code === 1) return 'cube';
  throw new Error(`Unsupported Test ID topology code: ${String(code)}`);
};

const assertUnsignedField = (name: string, value: number, bits: number): void => {
  const maximum = 2 ** bits - 1;
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${name} must be an unsigned ${bits}-bit integer, got ${String(value)}`);
  }
};

const appendField = (value: bigint, field: number, bits: bigint): bigint =>
  (value << bits) | BigInt(field);

/**
 * Test IDs are reversible decimal envelopes, not hashes and not aliases for a
 * random seed. Every replay-relevant choice is encoded directly or fixed by
 * sourceVersion. Changing an implicit generation/import rule requires bumping
 * TEST_CASE_SOURCE_VERSION rather than silently changing an existing ID.
 */
export const encodeTestCaseId = (identity: TestCaseIdentity): string => {
  if (identity.schemaVersion !== TEST_CASE_ID_SCHEMA_VERSION) {
    throw new Error(`Unsupported Test ID schema version: ${String(identity.schemaVersion)}`);
  }
  if (identity.sourceVersion !== TEST_CASE_SOURCE_VERSION) {
    throw new Error(`Unsupported Test ID source version: ${String(identity.sourceVersion)}`);
  }

  assertUnsignedField('size', identity.size, Number(SIZE_BITS));
  assertUnsignedField('variant', identity.variant, Number(VARIANT_BITS));
  assertUnsignedField('transform', identity.transform, Number(TRANSFORM_BITS));
  assertUnsignedField('payload', identity.payload, Number(PAYLOAD_BITS));

  let encoded = 0n;
  encoded = appendField(encoded, identity.schemaVersion, SCHEMA_BITS);
  encoded = appendField(encoded, identity.sourceVersion, SOURCE_VERSION_BITS);
  encoded = appendField(encoded, SOURCE_CODES[identity.source], SOURCE_BITS);
  encoded = appendField(encoded, topologyCode(identity.topology), TOPOLOGY_BITS);
  encoded = appendField(encoded, identity.size, SIZE_BITS);
  encoded = appendField(encoded, identity.variant, VARIANT_BITS);
  encoded = appendField(encoded, identity.transform, TRANSFORM_BITS);
  encoded = appendField(encoded, identity.payload, PAYLOAD_BITS);
  return encoded.toString(10);
};

const takeField = (
  value: bigint,
  bits: bigint,
): Readonly<{ field: number; rest: bigint }> =>
  Object.freeze({ field: Number(value & bitMask(bits)), rest: value >> bits });

export const decodeTestCaseId = (testId: string): TestCaseIdentity => {
  const normalized = testId.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error('Test ID must contain decimal digits only');
  }

  let encoded: bigint;
  try {
    encoded = BigInt(normalized);
  } catch {
    throw new Error('Test ID is not a valid decimal integer');
  }
  if (encoded <= 0n) throw new Error('Test ID must be positive');

  const payload = takeField(encoded, PAYLOAD_BITS);
  const transform = takeField(payload.rest, TRANSFORM_BITS);
  const variant = takeField(transform.rest, VARIANT_BITS);
  const size = takeField(variant.rest, SIZE_BITS);
  const topology = takeField(size.rest, TOPOLOGY_BITS);
  const source = takeField(topology.rest, SOURCE_BITS);
  const sourceVersion = takeField(source.rest, SOURCE_VERSION_BITS);
  const schema = takeField(sourceVersion.rest, SCHEMA_BITS);

  if (schema.rest !== 0n) throw new Error('Test ID contains unsupported high-order data');
  if (schema.field !== TEST_CASE_ID_SCHEMA_VERSION) {
    throw new Error(`Unsupported Test ID schema version: ${String(schema.field)}`);
  }
  if (sourceVersion.field !== TEST_CASE_SOURCE_VERSION) {
    throw new Error(`Unsupported Test ID source version: ${String(sourceVersion.field)}`);
  }

  return Object.freeze({
    schemaVersion: TEST_CASE_ID_SCHEMA_VERSION,
    sourceVersion: TEST_CASE_SOURCE_VERSION,
    source: sourceFromCode(source.field),
    topology: topologyFromCode(topology.field),
    size: size.field,
    variant: variant.field,
    transform: transform.field,
    payload: payload.field,
  });
};

export const makeTestCaseIdentity = (
  identity: Omit<TestCaseIdentity, 'schemaVersion' | 'sourceVersion'>,
): TestCaseIdentity =>
  Object.freeze({
    schemaVersion: TEST_CASE_ID_SCHEMA_VERSION,
    sourceVersion: TEST_CASE_SOURCE_VERSION,
    ...identity,
  });
