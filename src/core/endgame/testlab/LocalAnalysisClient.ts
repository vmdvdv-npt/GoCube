import type {
  DifferentialOracleAdapter,
  OracleAvailability,
  PlanarOraclePosition,
} from './DifferentialOracle';

export const LOCAL_ANALYSIS_PROTOCOL_VERSION = 1 as const;
export const LOCAL_ANALYSIS_DEFAULT_URL = 'http://127.0.0.1:4777';

export interface LocalAnalysisResult {
  readonly id: string;
  readonly rootInfo?: Readonly<Record<string, unknown>>;
  readonly moveInfos?: readonly Readonly<Record<string, unknown>>[];
  readonly ownership?: readonly number[];
  readonly policy?: readonly number[];
  readonly raw: Readonly<Record<string, unknown>>;
}

export interface LocalAnalysisClientOptions {
  readonly baseUrl?: string;
  readonly token?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

const responseReason = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as { readonly error?: unknown; readonly reason?: unknown };
    if (typeof body.error === 'string') return body.error;
    if (typeof body.reason === 'string') return body.reason;
  } catch {
    // Fall through to the status text.
  }
  return response.statusText || `HTTP ${response.status}`;
};

export class LocalAnalysisClient implements DifferentialOracleAdapter<LocalAnalysisResult> {
  readonly id = 'cubego-local-katago';
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: LocalAnalysisClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? LOCAL_ANALYSIS_DEFAULT_URL).replace(/\/$/, '');
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private headers(contentType = false): HeadersInit {
    const headers: Record<string, string> = {};
    if (contentType) headers['Content-Type'] = 'application/json';
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    return headers;
  }

  private async request(
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      globalThis.clearTimeout(timeout);
    }
  }

  async availability(): Promise<OracleAvailability> {
    try {
      const response = await this.request('/health', { headers: this.headers() });
      if (!response.ok) {
        return Object.freeze({
          available: false,
          reason: `Local analysis bridge health check failed: ${await responseReason(response)}`,
        });
      }

      const body = (await response.json()) as {
        readonly protocolVersion?: unknown;
        readonly available?: unknown;
        readonly reason?: unknown;
        readonly version?: unknown;
      };
      if (body.protocolVersion !== LOCAL_ANALYSIS_PROTOCOL_VERSION) {
        return Object.freeze({
          available: false,
          reason: `Unsupported local analysis protocol version: ${String(body.protocolVersion)}`,
        });
      }
      return Object.freeze({
        available: body.available === true,
        reason: typeof body.reason === 'string' ? body.reason : undefined,
        version: typeof body.version === 'string' ? body.version : undefined,
      });
    } catch (error) {
      return Object.freeze({
        available: false,
        reason: `Local analysis bridge unavailable: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  async analyze(position: PlanarOraclePosition): Promise<LocalAnalysisResult> {
    const response = await this.request('/analyze', {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify(
        Object.freeze({
          protocolVersion: LOCAL_ANALYSIS_PROTOCOL_VERSION,
          position,
        }),
      ),
    });
    if (!response.ok) {
      throw new Error(`Local analysis bridge rejected request: ${await responseReason(response)}`);
    }

    const body = (await response.json()) as {
      readonly protocolVersion?: unknown;
      readonly result?: unknown;
    };
    if (body.protocolVersion !== LOCAL_ANALYSIS_PROTOCOL_VERSION) {
      throw new Error(`Unsupported local analysis protocol version: ${String(body.protocolVersion)}`);
    }
    if (!body.result || typeof body.result !== 'object' || Array.isArray(body.result)) {
      throw new Error('Local analysis bridge returned an invalid result payload.');
    }

    const raw = body.result as Readonly<Record<string, unknown>>;
    const id = typeof raw.id === 'string' ? raw.id : 'local-analysis';
    return Object.freeze({
      id,
      rootInfo:
        raw.rootInfo && typeof raw.rootInfo === 'object' && !Array.isArray(raw.rootInfo)
          ? (raw.rootInfo as Readonly<Record<string, unknown>>)
          : undefined,
      moveInfos: Array.isArray(raw.moveInfos)
        ? Object.freeze(
            raw.moveInfos.filter(
              (item): item is Readonly<Record<string, unknown>> =>
                item !== null && typeof item === 'object' && !Array.isArray(item),
            ),
          )
        : undefined,
      ownership: Array.isArray(raw.ownership)
        ? Object.freeze(raw.ownership.filter((item): item is number => typeof item === 'number'))
        : undefined,
      policy: Array.isArray(raw.policy)
        ? Object.freeze(raw.policy.filter((item): item is number => typeof item === 'number'))
        : undefined,
      raw,
    });
  }
}
