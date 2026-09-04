import type { RuleSet, StoneColor } from '../../core/game/types';
import type { ScoreWinner } from '../../core/scoring/Scoring';
import type { PointId } from '../../core/topology/Topology';

export const ALPHAZERO_PROTOCOL_VERSION = 1 as const;
export const ALPHAZERO_DEFAULT_BASE_URL = 'http://127.0.0.1:8765';

export type AlphaZeroTopology = 'cube' | 'torus';

export interface AlphaZeroHealth {
  readonly protocolVersion: typeof ALPHAZERO_PROTOCOL_VERSION;
  readonly service: string;
  readonly version: string;
}

export interface AlphaZeroCheckpointDescriptor {
  readonly id: string;
  readonly runName: string;
  readonly iteration: number;
  readonly topology: AlphaZeroTopology;
  readonly size: number;
  readonly ruleSet: RuleSet;
  readonly komi: number;
}

export interface AlphaZeroPlaceAction {
  readonly type: 'place';
  readonly pointId: PointId;
}

export interface AlphaZeroPassAction {
  readonly type: 'pass';
}

export type AlphaZeroAction = AlphaZeroPlaceAction | AlphaZeroPassAction;

export interface AlphaZeroGeneratedMove {
  readonly moveNumber: number;
  readonly color: StoneColor;
  readonly action: AlphaZeroAction;
  readonly captured?: readonly PointId[];
}

export interface AlphaZeroGeneratedScore {
  readonly ruleSet: RuleSet;
  readonly black: number;
  readonly white: number;
  readonly komi: number;
  readonly winner: ScoreWinner;
  readonly margin: number;
}

export interface AlphaZeroGeneratedGameResult {
  readonly winner: ScoreWinner;
  readonly fallbackCount: number;
  readonly score: AlphaZeroGeneratedScore;
}

export interface AlphaZeroGeneratedGame {
  readonly protocolVersion: typeof ALPHAZERO_PROTOCOL_VERSION;
  readonly topology: AlphaZeroTopology;
  readonly size: number;
  readonly ruleSet: RuleSet;
  readonly komi: number;
  readonly blackCheckpoint: string;
  readonly whiteCheckpoint: string;
  readonly mctsSimulations: number;
  readonly moves: readonly AlphaZeroGeneratedMove[];
  readonly terminal?: unknown;
  readonly result?: AlphaZeroGeneratedGameResult;
}

export interface AlphaZeroGenerateGameRequest {
  readonly blackCheckpointId: string;
  readonly whiteCheckpointId: string;
  readonly mctsSimulations: number;
}

export interface AlphaZeroGateway {
  health(): Promise<AlphaZeroHealth>;
  listCheckpoints(): Promise<readonly AlphaZeroCheckpointDescriptor[]>;
  generateGame(request: AlphaZeroGenerateGameRequest): Promise<AlphaZeroGeneratedGame>;
}

export class AlphaZeroGatewayError extends Error {
  constructor(
    message: string,
    readonly kind: 'transport' | 'protocol',
    readonly causeValue?: unknown,
  ) {
    super(message);
    this.name = 'AlphaZeroGatewayError';
  }
}
