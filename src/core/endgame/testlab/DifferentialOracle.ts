import type { EndgameProposal } from '../EndgameClassifier';
import type { StoneColor } from '../../game/types';
import type { PointId, Topology } from '../../topology/Topology';
import type { EndgameTestFixture, GeneratedGameCommand } from './EndgameFixture';
import {
  analyzePlanarLocalNeighborhood,
  type PlanarLocalAnalyzerOptions,
  type PlanarLocalProjection,
} from './PlanarLocalAnalyzer';

export const DIFFERENTIAL_ORACLE_SCHEMA_VERSION = 1 as const;

export interface PlanarOracleStone {
  readonly row: number;
  readonly column: number;
  readonly color: StoneColor;
}

export interface PlanarOraclePosition {
  readonly boardSize: number;
  readonly currentPlayer: StoneColor;
  readonly stones: readonly PlanarOracleStone[];
  readonly targetCoordinates: readonly Readonly<{ row: number; column: number }>[];
}

export interface OracleAvailability {
  readonly available: boolean;
  readonly reason?: string;
  readonly version?: string;
}

export interface DifferentialOracleAdapter<TResult = unknown> {
  readonly id: string;
  availability(): Promise<OracleAvailability>;
  analyze(position: PlanarOraclePosition): Promise<TResult>;
}

export interface DifferentialOracleRunOptions extends PlanarLocalAnalyzerOptions {
  readonly targetPoints: readonly PointId[];
}

export type DifferentialOracleRunResult<TResult = unknown> =
  | Readonly<{
      status: 'match';
      oracleId: string;
      projection: PlanarLocalProjection;
      internalResult: EndgameProposal;
      oracleResult: TResult;
    }>
  | Readonly<{
      status: 'mismatch';
      oracleId: string;
      projection: PlanarLocalProjection;
      internalResult: EndgameProposal;
      oracleResult: TResult;
      capture: OracleMismatchCapture<TResult>;
    }>
  | Readonly<{
      status: 'not-applicable';
      oracleId: string;
      reason: string;
    }>
  | Readonly<{
      status: 'unavailable';
      oracleId: string;
      reason: string;
    }>
  | Readonly<{
      status: 'error';
      oracleId: string;
      reason: string;
    }>;

export interface OracleMismatchCapture<TResult = unknown> {
  readonly schemaVersion: typeof DIFFERENTIAL_ORACLE_SCHEMA_VERSION;
  readonly oracleId: string;
  readonly seed: string;
  readonly fixtureId: string;
  readonly generator: EndgameTestFixture['generator'];
  readonly topology: EndgameTestFixture['topology'];
  readonly actionTrace: readonly GeneratedGameCommand[];
  readonly fixture: EndgameTestFixture;
  readonly projection: PlanarLocalProjection;
  readonly internalResult: EndgameProposal;
  readonly oracleResult: TResult;
}

export type OracleResultComparator<TResult> = (
  internalResult: EndgameProposal,
  oracleResult: TResult,
) => boolean;

const toPlanarOraclePosition = (
  fixture: EndgameTestFixture,
  projection: PlanarLocalProjection,
): PlanarOraclePosition => {
  const targets = new Set(projection.targetPoints);
  return Object.freeze({
    boardSize: projection.boardSize,
    currentPlayer: fixture.state.currentPlayer,
    stones: Object.freeze(
      projection.points
        .filter((point) => point.occupancy !== 'empty')
        .map((point) =>
          Object.freeze({
            row: point.row,
            column: point.column,
            color: point.occupancy as StoneColor,
          }),
        ),
    ),
    targetCoordinates: Object.freeze(
      projection.points
        .filter((point) => targets.has(point.point))
        .map((point) => Object.freeze({ row: point.row, column: point.column })),
    ),
  });
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const runDifferentialOracle = async <TResult>(
  fixture: EndgameTestFixture,
  topology: Topology,
  internalResult: EndgameProposal,
  adapter: DifferentialOracleAdapter<TResult>,
  comparator: OracleResultComparator<TResult>,
  options: DifferentialOracleRunOptions,
): Promise<DifferentialOracleRunResult<TResult>> => {
  const planar = analyzePlanarLocalNeighborhood(topology, fixture.state, options.targetPoints, options);
  if (planar.status === 'not-applicable') {
    return Object.freeze({
      status: 'not-applicable',
      oracleId: adapter.id,
      reason: `${planar.reason}: ${planar.detail}`,
    });
  }

  let availability: OracleAvailability;
  try {
    availability = await adapter.availability();
  } catch (error) {
    return Object.freeze({
      status: 'unavailable',
      oracleId: adapter.id,
      reason: `Oracle availability check failed: ${errorMessage(error)}`,
    });
  }
  if (!availability.available) {
    return Object.freeze({
      status: 'unavailable',
      oracleId: adapter.id,
      reason: availability.reason ?? 'Oracle reported itself unavailable.',
    });
  }

  let oracleResult: TResult;
  try {
    oracleResult = await adapter.analyze(toPlanarOraclePosition(fixture, planar.projection));
  } catch (error) {
    return Object.freeze({
      status: 'error',
      oracleId: adapter.id,
      reason: `Oracle analysis failed: ${errorMessage(error)}`,
    });
  }

  if (comparator(internalResult, oracleResult)) {
    return Object.freeze({
      status: 'match',
      oracleId: adapter.id,
      projection: planar.projection,
      internalResult,
      oracleResult,
    });
  }

  const capture: OracleMismatchCapture<TResult> = Object.freeze({
    schemaVersion: DIFFERENTIAL_ORACLE_SCHEMA_VERSION,
    oracleId: adapter.id,
    seed: fixture.generator.seed,
    fixtureId: fixture.fixtureId,
    generator: fixture.generator,
    topology: fixture.topology,
    actionTrace: fixture.commands,
    fixture,
    projection: planar.projection,
    internalResult,
    oracleResult,
  });

  return Object.freeze({
    status: 'mismatch',
    oracleId: adapter.id,
    projection: planar.projection,
    internalResult,
    oracleResult,
    capture,
  });
};

export const serializeOracleMismatch = <TResult>(capture: OracleMismatchCapture<TResult>): string =>
  `${JSON.stringify(capture, null, 2)}\n`;
