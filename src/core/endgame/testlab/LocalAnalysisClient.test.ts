import { describe, expect, it, vi } from 'vitest';
import { LocalAnalysisClient } from './LocalAnalysisClient';
import type { PlanarOraclePosition } from './DifferentialOracle';

const position: PlanarOraclePosition = Object.freeze({
  boardSize: 19,
  currentPlayer: 'black',
  stones: Object.freeze([
    Object.freeze({ row: 9, column: 9, color: 'black' as const }),
    Object.freeze({ row: 9, column: 10, color: 'white' as const }),
  ]),
  targetCoordinates: Object.freeze([Object.freeze({ row: 9, column: 9 })]),
});

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('LocalAnalysisClient', () => {
  it('reports a configured compatible loopback bridge as available', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ protocolVersion: 1, available: true, version: '0.3.03' }),
    );
    const client = new LocalAnalysisClient({
      fetchImpl: fetchMock as unknown as typeof fetch,
      token: 'secret',
    });

    await expect(client.availability()).resolves.toEqual({
      available: true,
      reason: undefined,
      version: '0.3.03',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer secret' });
  });

  it('degrades cleanly when no local bridge is running', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const client = new LocalAnalysisClient({ fetchImpl: fetchMock as unknown as typeof fetch });

    await expect(client.availability()).resolves.toEqual({
      available: false,
      reason: 'Local analysis bridge unavailable: fetch failed',
    });
  });

  it('rejects incompatible protocol versions before treating the helper as usable', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ protocolVersion: 2, available: true, version: 'future' }),
    );
    const client = new LocalAnalysisClient({ fetchImpl: fetchMock as unknown as typeof fetch });

    await expect(client.availability()).resolves.toEqual({
      available: false,
      reason: 'Unsupported local analysis protocol version: 2',
    });
  });

  it('sends only the fixed analysis payload and returns KataGo diagnostics', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      const body = JSON.parse(String(init?.body)) as {
        protocolVersion: number;
        position: PlanarOraclePosition;
      };
      expect(body).toEqual({ protocolVersion: 1, position });
      return jsonResponse({
        protocolVersion: 1,
        result: {
          id: 'katago-case',
          rootInfo: { scoreLead: 3.5 },
          moveInfos: [{ move: 'Q16', visits: 42 }],
          ownership: [0.5, -0.5],
          policy: [0.1, 0.9],
        },
      });
    });
    const client = new LocalAnalysisClient({ fetchImpl: fetchMock as unknown as typeof fetch });

    const result = await client.analyze(position);

    expect(result.id).toBe('katago-case');
    expect(result.rootInfo).toEqual({ scoreLead: 3.5 });
    expect(result.moveInfos).toEqual([{ move: 'Q16', visits: 42 }]);
    expect(result.ownership).toEqual([0.5, -0.5]);
    expect(result.policy).toEqual([0.1, 0.9]);
  });

  it('surfaces bridge rejection as an explicit oracle error', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: 'CUBEGO_KATAGO_MODEL is not configured.' }, 503),
    );
    const client = new LocalAnalysisClient({ fetchImpl: fetchMock as unknown as typeof fetch });

    await expect(client.analyze(position)).rejects.toThrow(
      'Local analysis bridge rejected request: CUBEGO_KATAGO_MODEL is not configured.',
    );
  });
});
