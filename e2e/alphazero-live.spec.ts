import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page,
  type Request,
  type Response,
} from '@playwright/test';

type MoveAction =
  | Readonly<{ type: 'place'; pointId: string }>
  | Readonly<{ type: 'pass' }>;

type MoveRequest = Readonly<{
  protocolVersion: 1;
  requestId: string;
  checkpointId: string;
  mctsSims: number;
  position: Readonly<{
    topology: 'torus';
    size: 9;
    ruleSet: 'chinese';
    komi: 0.5;
    moves: readonly Readonly<{
      moveNumber: number;
      color: 'black' | 'white';
      action: MoveAction;
    }>[];
  }>;
}>;

type MoveResponse = Readonly<{
  protocolVersion: 1;
  requestId: string;
  checkpointId: string;
  mctsSims: number;
  moveNumber: number;
  color: 'black' | 'white';
  action: MoveAction;
  search: Readonly<{
    simulations: number;
    implementationId: string;
  }>;
}>;

type LiveCheckpoint = Readonly<{
  id: string;
  iteration: number;
  topology: 'torus';
  size: 9;
  ruleSet: 'chinese';
  komi: 0.5;
  lineageStatus?: 'ACTIVE' | 'ARCHIVED' | 'DISCARDED';
}>;

const LIVE_REQUESTED =
  process.env.npm_lifecycle_event === 'test:alphazero-live' ||
  process.env.ALPHAZERO_LIVE === '1';

const alphaZeroBaseUrl = (): string =>
  (process.env.VITE_ALPHAZERO_BASE_URL ?? 'http://127.0.0.1:8765').replace(/\/+$/, '');

const liveMctsSimulations = (): number => {
  const raw = process.env.ALPHAZERO_LIVE_MCTS_SIMS ?? '128';
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`ALPHAZERO_LIVE_MCTS_SIMS must be a positive integer, got ${raw}.`);
  }
  return parsed;
};

const asRecord = (value: unknown): Readonly<Record<string, unknown>> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;

const liveGet = async (request: APIRequestContext, path: string): Promise<APIResponse> => {
  const baseUrl = alphaZeroBaseUrl();
  try {
    return await request.get(`${baseUrl}${path}`, { timeout: 5_000 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `AlphaZero live smoke was explicitly requested, but ${baseUrl}${path} is unavailable: ${detail}`,
    );
  }
};

const discoverCompatibleCheckpoint = async (
  request: APIRequestContext,
): Promise<LiveCheckpoint> => {
  const healthResponse = await liveGet(request, '/v1/health');
  if (!healthResponse.ok()) {
    throw new Error(
      `AlphaZero live smoke was explicitly requested, but /v1/health returned HTTP ${healthResponse.status()}.`,
    );
  }
  const health = asRecord(await healthResponse.json());
  const capabilities = health ? asRecord(health.capabilities) : null;
  expect(health).toMatchObject({
    protocolVersion: 1,
    status: 'ok',
    service: 'gocube-alphazero',
  });
  expect(capabilities?.selectMove).toBe(true);

  const checkpointsResponse = await liveGet(request, '/v1/checkpoints');
  if (!checkpointsResponse.ok()) {
    throw new Error(
      `AlphaZero live smoke was explicitly requested, but /v1/checkpoints returned HTTP ${checkpointsResponse.status()}.`,
    );
  }
  const payload = asRecord(await checkpointsResponse.json());
  expect(payload?.protocolVersion).toBe(1);
  const rawCheckpoints = payload?.checkpoints;
  if (!Array.isArray(rawCheckpoints)) {
    throw new Error('AlphaZero /v1/checkpoints did not return a checkpoints array.');
  }

  const compatible = rawCheckpoints.flatMap((raw): LiveCheckpoint[] => {
    const checkpoint = asRecord(raw);
    if (!checkpoint) return [];
    const status = checkpoint.lineageStatus;
    if (
      typeof checkpoint.id !== 'string' ||
      checkpoint.id.length === 0 ||
      !Number.isSafeInteger(checkpoint.iteration) ||
      checkpoint.topology !== 'torus' ||
      checkpoint.size !== 9 ||
      checkpoint.ruleSet !== 'chinese' ||
      checkpoint.komi !== 0.5 ||
      (status !== undefined && status !== 'ACTIVE' && status !== 'ARCHIVED' && status !== 'DISCARDED')
    ) {
      return [];
    }
    return [
      {
        id: checkpoint.id,
        iteration: checkpoint.iteration as number,
        topology: 'torus',
        size: 9,
        ruleSet: 'chinese',
        komi: 0.5,
        ...(status === undefined
          ? {}
          : { lineageStatus: status as LiveCheckpoint['lineageStatus'] }),
      },
    ];
  });

  compatible.sort((left, right) => {
    const leftActive = (left.lineageStatus ?? 'ACTIVE') === 'ACTIVE' ? 1 : 0;
    const rightActive = (right.lineageStatus ?? 'ACTIVE') === 'ACTIVE' ? 1 : 0;
    return rightActive - leftActive || right.iteration - left.iteration || left.id.localeCompare(right.id);
  });

  const selected = compatible[0];
  if (!selected) {
    throw new Error(
      'AlphaZero live smoke requires a descriptor compatible with Torus 9×9 / Chinese / komi 0.5.',
    );
  }
  return selected;
};

const isMoveRequest = (request: Request): boolean => {
  const url = new URL(request.url());
  return request.method() === 'POST' && url.pathname === '/v1/move';
};

const isMoveResponse = (response: Response): boolean => isMoveRequest(response.request());

const startBotGame = async (
  page: Page,
  checkpoint: LiveCheckpoint,
  mctsSimulations: number,
  color: 'Black' | 'White',
): Promise<void> => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Torus', exact: true }).click();
  await page.getByLabel('Board size').selectOption('9');
  await page.getByLabel('Rules').selectOption('chinese');
  await page.getByLabel('Komi').fill('0.5');
  await page.getByLabel('MCTS simulations').fill(String(mctsSimulations));
  if (color === 'White') {
    await page
      .locator('.play-vs-bot-card')
      .getByRole('button', { name: 'White', exact: true })
      .click();
  }

  await page.getByRole('button', { name: 'Choose model…' }).click();
  const dialog = page.getByRole('dialog', { name: 'AlphaZero' });
  await expect(dialog.getByText('Connected', { exact: true })).toBeVisible({ timeout: 10_000 });
  if ((checkpoint.lineageStatus ?? 'ACTIVE') !== 'ACTIVE') {
    await dialog.getByLabel('Show closed lineages').check();
  }
  await dialog.getByLabel('Bot checkpoint').selectOption(checkpoint.id);
  await expect(dialog.getByText('torus · 9×9 · chinese · komi 0.5')).toBeVisible();
  await dialog.getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('.torus-game')).toBeVisible();
};

const primaryHit = (page: Page, pointId: string) =>
  page.locator(
    `.torus-board__hit-target[data-logical-point-id="${pointId}"][data-copy-role="primary"]`,
  );

const primaryStone = (page: Page, pointId: string) =>
  page.locator(
    `.torus-board__stone[data-logical-point-id="${pointId}"][data-copy-role="primary"]`,
  );

const turnIndicator = (page: Page) => page.locator('.turn-indicator');

const firstEmptyPrimaryPoint = async (page: Page): Promise<string> => {
  const pointId = await page.locator('.torus-board').evaluate((board) => {
    const occupied = new Set(
      Array.from(board.querySelectorAll<HTMLElement>('.torus-board__stone[data-copy-role="primary"]'))
        .map((node) => node.dataset.logicalPointId)
        .filter((value): value is string => Boolean(value)),
    );
    return Array.from(
      board.querySelectorAll<HTMLElement>('.torus-board__hit-target[data-copy-role="primary"]'),
    )
      .map((node) => node.dataset.logicalPointId)
      .find((value): value is string => Boolean(value) && !occupied.has(value)) ?? null;
  });
  if (!pointId) throw new Error('Could not find an empty Torus point for the live smoke.');
  return pointId;
};

const installThinkingProbe = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    type LiveWindow = typeof window & {
      __alphaZeroLiveProbe?: {
        thinkingSeen: boolean;
        passDisabledDuringThinking: boolean;
        observer: MutationObserver;
      };
    };
    const target = window as LiveWindow;
    const probe = {
      thinkingSeen: false,
      passDisabledDuringThinking: false,
      observer: null as unknown as MutationObserver,
    };
    const sample = () => {
      const indicator = document.querySelector('.turn-indicator');
      const pass = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
        (button) => button.textContent?.trim() === 'Pass',
      );
      if (indicator?.textContent?.includes('Computer is thinking…')) {
        probe.thinkingSeen = true;
        if (pass?.disabled) probe.passDisabledDuringThinking = true;
      }
    };
    const observer = new MutationObserver(sample);
    probe.observer = observer;
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['disabled'],
    });
    target.__alphaZeroLiveProbe = probe;
    sample();
  });
};

const readThinkingProbe = async (
  page: Page,
): Promise<Readonly<{ thinkingSeen: boolean; passDisabledDuringThinking: boolean }>> =>
  page.evaluate(() => {
    type LiveWindow = typeof window & {
      __alphaZeroLiveProbe?: {
        thinkingSeen: boolean;
        passDisabledDuringThinking: boolean;
        observer: MutationObserver;
      };
    };
    const target = window as LiveWindow;
    const probe = target.__alphaZeroLiveProbe;
    if (!probe) return { thinkingSeen: false, passDisabledDuringThinking: false };
    probe.observer.disconnect();
    return {
      thinkingSeen: probe.thinkingSeen,
      passDisabledDuringThinking: probe.passDisabledDuringThinking,
    };
  });

const assertRealMoveResponse = (
  response: MoveResponse,
  request: MoveRequest,
  expectedColor: 'black' | 'white',
): void => {
  expect(response).toMatchObject({
    protocolVersion: 1,
    requestId: request.requestId,
    checkpointId: request.checkpointId,
    mctsSims: request.mctsSims,
    moveNumber: request.position.moves.length + 1,
    color: expectedColor,
    search: { simulations: request.mctsSims },
  });
  expect(response.search.implementationId.length).toBeGreaterThan(0);
  expect(response.action.type === 'place' || response.action.type === 'pass').toBe(true);
};

test.describe('Play vs bot live AlphaZero acceptance', () => {
  test.skip(!LIVE_REQUESTED, 'Run explicitly with npm run test:alphazero-live.');
  test.setTimeout(240_000);

  test('Human Black plays two real neural MCTS replies from full authoritative history', async ({
    page,
    request,
  }) => {
    const checkpoint = await discoverCompatibleCheckpoint(request);
    const mctsSimulations = liveMctsSimulations();
    await startBotGame(page, checkpoint, mctsSimulations, 'Black');
    await installThinkingProbe(page);

    const firstRequestPromise = page.waitForRequest(isMoveRequest, { timeout: 75_000 });
    const firstResponsePromise = page.waitForResponse(isMoveResponse, { timeout: 75_000 });
    await primaryHit(page, '0,0').click();

    const firstRequestBody = (await firstRequestPromise).postDataJSON() as MoveRequest;
    expect(firstRequestBody).toMatchObject({
      protocolVersion: 1,
      checkpointId: checkpoint.id,
      mctsSims: mctsSimulations,
      position: {
        topology: 'torus',
        size: 9,
        ruleSet: 'chinese',
        komi: 0.5,
      },
    });
    expect(firstRequestBody.position.moves).toEqual([
      { moveNumber: 1, color: 'black', action: { type: 'place', pointId: '0,0' } },
    ]);

    const firstResponse = await firstResponsePromise;
    expect(firstResponse.ok()).toBe(true);
    const firstResponseBody = (await firstResponse.json()) as MoveResponse;
    assertRealMoveResponse(firstResponseBody, firstRequestBody, 'white');
    await expect(turnIndicator(page)).toContainText('Black to move', { timeout: 75_000 });
    if (firstResponseBody.action.type === 'place') {
      await expect(primaryStone(page, firstResponseBody.action.pointId)).toHaveCount(1);
    }

    const probe = await readThinkingProbe(page);
    expect(probe.thinkingSeen).toBe(true);
    expect(probe.passDisabledDuringThinking).toBe(true);

    const secondHumanPoint = await firstEmptyPrimaryPoint(page);
    const secondRequestPromise = page.waitForRequest(isMoveRequest, { timeout: 75_000 });
    const secondResponsePromise = page.waitForResponse(isMoveResponse, { timeout: 75_000 });
    await primaryHit(page, secondHumanPoint).click();

    const secondRequestBody = (await secondRequestPromise).postDataJSON() as MoveRequest;
    expect(secondRequestBody.position.moves).toEqual([
      { moveNumber: 1, color: 'black', action: { type: 'place', pointId: '0,0' } },
      { moveNumber: 2, color: 'white', action: firstResponseBody.action },
      {
        moveNumber: 3,
        color: 'black',
        action: { type: 'place', pointId: secondHumanPoint },
      },
    ]);

    const secondResponse = await secondResponsePromise;
    expect(secondResponse.ok()).toBe(true);
    const secondResponseBody = (await secondResponse.json()) as MoveResponse;
    assertRealMoveResponse(secondResponseBody, secondRequestBody, 'white');
    await expect(turnIndicator(page)).toContainText('Black to move', { timeout: 75_000 });
  });

  test('Human White receives a real opening move and continues the same game', async ({
    page,
    request,
  }) => {
    const checkpoint = await discoverCompatibleCheckpoint(request);
    const mctsSimulations = liveMctsSimulations();
    const openingRequestPromise = page.waitForRequest(isMoveRequest, { timeout: 75_000 });
    const openingResponsePromise = page.waitForResponse(isMoveResponse, { timeout: 75_000 });

    await startBotGame(page, checkpoint, mctsSimulations, 'White');

    const openingRequestBody = (await openingRequestPromise).postDataJSON() as MoveRequest;
    expect(openingRequestBody.position.moves).toEqual([]);
    const openingResponse = await openingResponsePromise;
    expect(openingResponse.ok()).toBe(true);
    const openingResponseBody = (await openingResponse.json()) as MoveResponse;
    assertRealMoveResponse(openingResponseBody, openingRequestBody, 'black');
    await expect(turnIndicator(page)).toContainText('White to move', { timeout: 75_000 });

    const humanPoint = await firstEmptyPrimaryPoint(page);
    const replyRequestPromise = page.waitForRequest(isMoveRequest, { timeout: 75_000 });
    const replyResponsePromise = page.waitForResponse(isMoveResponse, { timeout: 75_000 });
    await primaryHit(page, humanPoint).click();

    const replyRequestBody = (await replyRequestPromise).postDataJSON() as MoveRequest;
    expect(replyRequestBody.position.moves).toEqual([
      { moveNumber: 1, color: 'black', action: openingResponseBody.action },
      { moveNumber: 2, color: 'white', action: { type: 'place', pointId: humanPoint } },
    ]);

    const replyResponse = await replyResponsePromise;
    expect(replyResponse.ok()).toBe(true);
    const replyResponseBody = (await replyResponse.json()) as MoveResponse;
    assertRealMoveResponse(replyResponseBody, replyRequestBody, 'black');
    await expect(turnIndicator(page)).toContainText('White to move', { timeout: 75_000 });
  });
});
