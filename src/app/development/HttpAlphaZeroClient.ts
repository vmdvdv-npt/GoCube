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

export class HttpAlphaZeroClient implements AlphaZeroGateway {
  private readonly baseUrl: string;
  private readonly fetcher: AlphaZeroFetch;

  constructor(options: { readonly baseUrl?: string; readonly fetcher?: AlphaZeroFetch } = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? configuredBaseUrl());
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  }

  async health(): Promise<AlphaZeroHealth> {
    return parseAlphaZeroHealth(await this.request('/health'));
  }

  async listCheckpoints(): Promise<readonly AlphaZeroCheckpointDescriptor[]> {
    return parseAlphaZeroCheckpointList(await this.request('/checkpoints'));
  }

  async generateGame(request: AlphaZeroGenerateGameRequest): Promise<AlphaZeroGeneratedGame> {
    return parseAlphaZeroGeneratedGame(
      await this.request('/games/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          protocolVersion: ALPHAZERO_PROTOCOL_VERSION,
          blackCheckpointId: request.blackCheckpointId,
          whiteCheckpointId: request.whiteCheckpointId,
          mctsSimulations: request.mctsSimulations,
        }),
      }),
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
