import type { EndgameProposalStatus } from '../EndgameClassifier';
import type { GameState } from '../../game/types';
import type { PointId } from '../../topology/Topology';
import type { GeneratedGameCommand } from './EndgameFixture';

export const TEST_CASE_ID_SCHEMA_VERSION = 1 as const;
export const TEST_CASE_SOURCE_VERSION = 1 as const;

export type TestCaseSource = 'game-like' | 'synthetic-endgame' | 'corpus';
export type TestCaseTopology = 'torus' | 'cube';
export type TestCaseReplayMode = 'legal-sequence' | 'bootstrap-state';

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
  /** Source-specific stable variant. Zero for game-like/corpus unless documented otherwise. */
  readonly variant: number;
  /** Source-specific deterministic transform/placement code. */
  readonly transform: number;
  /** Game-like/synthetic uint32 seed, or stable external corpus catalog index. */
  readonly payload: number;
}

export interface TestCaseSourceDiagnostics {
  readonly sourceId: string;
  readonly sourceAnswer?: string;
  readonly sourceStatus: ReferenceStatus;
  readonly kataGoStatus: ReferenceStatus;
  readonly cubeGoStatus: ReferenceStatus;
  readonly attention: boolean;
  readonly attentionReason?: string;
}

export interface ReplayableTestCase {
  readonly testId: string;
  readonly identity: TestCaseIdentity;
  readonly state: GameState;
  readonly replayMode: TestCaseReplayMode;
  readonly commands: readonly GeneratedGameCommand[];
  readonly targetPoints: readonly PointId[];
  readonly diagnostics?: TestCaseSourceDiagnostics;
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

const mask = (bits: bigint): bigint => (1n << bits) - 1n;

const SOURCE_CODES: Readonly<Record<TestCaseSource, number>> = Object.freeze({
  'game-like': 0,
  'synthetic-endgame': 1,
  corpus: 2,
});
const SOURCE_BY_CODE: Readonly<Record<number, TestCaseSource>> = Object.freeze({
  0: 'game-like',
  1: 'synthetic-endgame',
  2: 'corpus',
});

const TOPOLOGY_CODES: Readonly<Record<TestCaseTopology, number>> = Object.freeze({
  torus: 0,
  cube: 1,
});
const TOPOLOGY_BY_CODE: Readonly<Record<number, TestCaseTopology>> = Object.freeze({
  0: 'torus',
  1: 'cube',
});

const assertUnsignedField = (name: string, value: number, bits: number): void => {
  const maximum = 2 ** bits - 1;
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${name} must be an unsigned ${bits}-bit integer, got ${String(value)}`);
  }
};

const pushField = (accumulator: bigint, value: number, bits: bigint): bigint =>
  (accumulator << bits) | BigInt(value);

/**
 * Numeric Test ID codec. The decimal string is a reversible compact envelope,
 * not a hash and not a seed alias. Every parameter that influences replay is
 * either encoded directly here or fixed by the encoded sourceVersion contract.
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
  encoded = pushField(encoded, identity.schemaVersion, SCHEMA_BITS);
  encoded = pushField(encoded, identity.sourceVersion, SOURCE_VERSION_BITS);
  encoded = pushField(encoded, SOURCE_CODES[identity.source], SOURCE_BITS);
  encoded = pushField(encoded, TOPOLOGY_CODES[identity.topology], TOPOLOGY_BITS);
  encoded = pushField(encoded, identity.size, SIZE_BITS);
  encoded = pushField(encoded, identity.variant, VARIANT_BITS);
  encoded = pushField(encoded, identity.transform, TRANSFORM_BITS);
  encoded = pushField(encoded, identity.payload, PAYLOAD_BITS);
  return encoded.toString(10);
};

const popField = (
  value: bigint,
  bits: bigint,
): Readonly<{ field: number; rest: bigint }> =>
  Object.freeze({
    field: Number(value & mask(bits)),
    rest: value >> bits,
  });

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

  const payload = popField(encoded, PAYLOAD_BITS);
  const transform = popField(payload.rest, TRANSFORM_BITS);
  const variant = popField(transform.rest, VARIANT_BITS);
  const size = popField(variant.rest, SIZE_BITS);
  const topology = popField(size.rest, TOPOLOGY_BITS);
  const source = popField(topology.rest, SOURCE_BITS);
  const sourceVersion = popField(source.rest, SOURCE_VERSION_BITS);
  const schema = popField(sourceVersion.rest, SCHEMA_BITS);

  if (schema.rest !== 0n) throw new Error('Test ID contains unsupported high-order data');
  if (schema.field !== TEST_CASE_ID_SCHEMA_VERSION) {
    throw new Error(`Unsupported Test ID schema version: ${String(schema.field)}`);
  }
  if (sourceVersion.field !== TEST_CASE_SOURCE_VERSION) {
    throw new Error(`Unsupported Test ID source version: ${String(sourceVersion.field)}`);
  }

  const decodedSource = SOURCE_BY_CODE[source.field];
  if (!decodedSource) throw new Error(`Unsupported Test ID source code: ${String(source.field)}`);
  const decodedTopology = TOPOLOGY_BY_CODE[topology.field];
  if (!decodedTopology) {
    throw new Error(`Unsupported Test ID topology code: ${String(topology.field)}`);
  }

  return Object.freeze({
    schemaVersion: TEST_CASE_ID_SCHEMA_VERSION,
    sourceVersion: TEST_CASE_SOURCE_VERSION,
    source: decodedSource,
    topology: decodedTopology,
    size: size.field,
    variant: variant.field,
    transform: transform.field,
    payload: payload.field,
  });
};

export const makeTestCaseIdentity = (
  input: Omit<TestCaseIdentity, 'schemaVersion' | 'sourceVersion'>,
): TestCaseIdentity =>
  Object.freeze({
    schemaVersion: TEST_CASE_ID_SCHEMA_VERSION,
    sourceVersion: TEST_CASE_SOURCE_VERSION,
    ...input,
  });
