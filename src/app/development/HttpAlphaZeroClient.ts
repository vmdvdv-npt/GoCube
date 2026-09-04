import {
  ALPHAZERO_DEFAULT_BASE_URL,
  ALPHAZERO_PROTOCOL_VERSION,
  AlphaZeroGatewayError,
  type AlphaZeroGenerateGameRequest,
  type AlphaZeroGateway,
  type AlphaZeroGeneratedGame,
  type AlphaZeroHealth,
  type AlphaZeroCheckpointDescriptor,
} from './AlphaZeroGateway';
import {
  parseAlphaZeroCheckpointList,
  parseAlphaZeroGeneratedGame,
  parseAlphaZeroHealth,
} from './AlphaZeroProtocol';

export type AlphaZeroFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const configuredBaseUrl = (): string => {
  const configured = import.meta.env.VITE_ALPHAZERO_BASE_URL;
  return typeof configured === 'string' && configured.trim().length > 0
    ? configured.trim()
    : ALPHAZERO_DEFAULT_BASE_URL;
};

const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, '');

const transportRecord = (
  value: unknown,
  context: string,
): Readonly<Record<string, unknown>> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AlphaZeroGatewayError(`${context} must be an object.`, 'protocol');
  }
  return value as Readonly<Record<string, unknown>>;
};

const normalizeHealthResponse = (value: unknown): unknown => {
  const record = transportRecord(value, 'health');
  if (record.status !== 'ok') {
    throw new AlphaZeroGatewayError('AlphaZero health.status must be "ok".', 'protocol');
  }
  if (typeof record.device !== 'string' || record.device.trim().length === 0) {
    throw new AlphaZeroGatewayError('AlphaZero health.device must be a non-empty string.', 'protocol');
  }

  // The GoCube gateway predates the service's `device` health field and exposes
  // this display slot as `version`. Preserve the gateway contract while validating
  // the real Protocol V1 payload at the transport boundary.
  return {
    protocolVersion: record.protocolVersion,
    service: record.service,
    version: record.device,
  };
};

const normalizeGeneratedGameResponse = (value: unknown): unknown => {
  const envelope = transportRecord(value, 'generatedGameEnvelope');
  const game = transportRecord(envelope.game, 'generatedGameEnvelope.game');
  const black = transportRecord(game.black, 'generatedGameEnvelope.game.black');
  const white = transportRecord(game.white, 'generatedGameEnvelope.game.white');

  return {
    protocolVersion: envelope.protocolVersion,
    topology: game.topology,
    size: game.size,
    ruleSet: game.ruleSet,
    komi: game.komi,
    blackCheckpoint: black.checkpointId,
    whiteCheckpoint: white.checkpointId,
    mctsSimulations: game.mctsSims,
    moves: game.moves,
    ...(Object.prototype.hasOwnProperty.call(game, 'terminal') ? { terminal: game.terminal } : {}),
    ...(Object.prototype.hasOwnProperty.call(game, 'result') ? { result: game.result } : {}),
  };
};

export class HttpAlphaZeroClient implements AlphaZeroGateway {
  private readonly baseUrl: string;
  private readonly fetcher: AlphaZeroFetch;

  constructor(options: { readonly baseUrl?: string; readonly fetcher?: AlphaZeroFetch } = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? configuredBaseUrl());
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  }

  async health(): Promise<AlphaZeroHealth> {
    return parseAlphaZeroHealth(normalizeHealthResponse(await this.request('/v1/health')));
  }

  async listCheckpoints(): Promise<readonly AlphaZeroCheckpointDescriptor[]> {
    return parseAlphaZeroCheckpointList(await this.request('/v1/checkpoints'));
  }

  async generateGame(request: AlphaZeroGenerateGameRequest): Promise<AlphaZeroGeneratedGame> {
    return parseAlphaZeroGeneratedGame(
      normalizeGeneratedGameResponse(
        await this.request('/v1/games', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            protocolVersion: ALPHAZERO_PROTOCOL_VERSION,
            blackCheckpointId: request.blackCheckpointId,
            whiteCheckpointId: request.whiteCheckpointId,
            mctsSims: request.mctsSimulations,
          }),
        }),
      ),
    );
  }

  private async request(path: string, init?: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, init);
    } catch (error) {
      throw new AlphaZeroGatewayError(
        `AlphaZero service is unavailable at ${this.baseUrl}.`,
        'transport',
        error,
      );
    }

    if (!response.ok) {
      let detail = '';
      try {
        const text = await response.text();
        detail = text.trim() ? ` ${text.trim()}` : '';
      } catch {
        // Preserve the HTTP status as the actionable transport diagnostic.
      }
      throw new AlphaZeroGatewayError(
        `AlphaZero service returned HTTP ${response.status}.${detail}`,
        'transport',
      );
    }

    try {
      return await response.json();
    } catch (error) {
      throw new AlphaZeroGatewayError(
        'AlphaZero service returned malformed JSON.',
        'protocol',
        error,
      );
    }
  }
}
