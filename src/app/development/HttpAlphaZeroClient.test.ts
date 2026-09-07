import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpAlphaZeroClient, type AlphaZeroFetch } from './HttpAlphaZeroClient';

const jsonResponse = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('HttpAlphaZeroClient', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads health and checkpoint descriptors through the typed gateway', async () => {
    const seen: string[] = [];
    const fetcher: AlphaZeroFetch = async (input) => {
      const url = String(input);
      seen.push(url);
      if (url.endsWith('/v1/health')) {
        return jsonResponse({
          protocolVersion: 1,
          status: 'ok',
          service: 'gocube-alphazero',
          device: 'cpu',
        });
      }
      return jsonResponse({
        protocolVersion: 1,
        checkpoints: [{
          id: 'cube4-1', runName: 'cube4', iteration: 1, topology: 'cube', size: 4,
          ruleSet: 'chinese', komi: 7.5, terminalAdjudicator: 'gocube-conservative-area-v1',
        }],
      });
    };
    const client = new HttpAlphaZeroClient({ baseUrl: 'http://example.test', fetcher });

    await expect(client.health()).resolves.toMatchObject({
      protocolVersion: 1,
      service: 'gocube-alphazero',
      version: 'cpu',
    });
    await expect(client.listCheckpoints()).resolves.toHaveLength(1);
    expect(seen).toEqual([
      'http://example.test/v1/health',
      'http://example.test/v1/checkpoints',
    ]);
  });

  it('reports an unavailable service without throwing a raw fetch error', async () => {
    const client = new HttpAlphaZeroClient({
      baseUrl: 'http://127.0.0.1:8765',
      fetcher: async () => { throw new TypeError('connection refused'); },
    });
    await expect(client.health()).rejects.toMatchObject({ kind: 'transport' });
    await expect(client.health()).rejects.toThrow(/unavailable/i);
  });

  it('aborts and reports a transport timeout when the service stops responding', async () => {
    vi.useFakeTimers();
    const seenSignals: AbortSignal[] = [];
    const fetcher: AlphaZeroFetch = async (_input, init) => {
      if (init?.signal) seenSignals.push(init.signal);
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      });
    };
    const client = new HttpAlphaZeroClient({
      baseUrl: 'http://127.0.0.1:8765',
      fetcher,
      metadataTimeoutMs: 1_000,
    });

    const rejection = client.health().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1_000);
    const error = await rejection;

    expect(error).toMatchObject({ kind: 'transport' });
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/timed out after 1 seconds/i);
    expect(seenSignals).toHaveLength(1);
    expect(seenSignals[0]?.aborted).toBe(true);
  });

  it('rejects malformed JSON', async () => {
    const client = new HttpAlphaZeroClient({
      fetcher: async () => new Response('{broken', { status: 200 }),
    });
    await expect(client.health()).rejects.toMatchObject({ kind: 'protocol' });
  });

  it('serializes generation request with the real Protocol V1 field names and validates the envelope', async () => {
    let requestUrl = '';
    let requestBody: unknown = null;
    const client = new HttpAlphaZeroClient({
      baseUrl: 'http://example.test',
      fetcher: async (input, init) => {
        requestUrl = String(input);
        requestBody = JSON.parse(String(init?.body));
        return jsonResponse({
          protocolVersion: 1,
          game: {
            topology: 'cube',
            size: 4,
            ruleSet: 'chinese',
            komi: 7.5,
            terminalAdjudicator: 'gocube-conservative-area-v1',
            mctsSims: 42,
            black: { checkpointId: 'c1' },
            white: { checkpointId: 'c1' },
            moves: [{ moveNumber: 1, color: 'black', action: { type: 'pass' }, captured: [] }],
            result: {
              winner: 'black',
              fallbackCount: 2,
              score: {
                ruleSet: 'chinese',
                black: 8,
                white: 7.5,
                komi: 7.5,
                winner: 'black',
                margin: 0.5,
              },
            },
          },
        });
      },
    });

    const game = await client.generateGame({
      blackCheckpointId: 'c1',
      whiteCheckpointId: 'c1',
      mctsSimulations: 42,
    });
    expect(requestUrl).toBe('http://example.test/v1/games');
    expect(requestBody).toEqual({
      protocolVersion: 1,
      blackCheckpointId: 'c1',
      whiteCheckpointId: 'c1',
      mctsSims: 42,
    });
    expect(game).toMatchObject({
      blackCheckpoint: 'c1',
      whiteCheckpoint: 'c1',
      mctsSimulations: 42,
      result: {
        winner: 'black',
        fallbackCount: 2,
        score: { black: 8, white: 7.5, margin: 0.5 },
      },
    });
    expect(game.moves[0]?.action).toEqual({ type: 'pass' });
  });
});
