import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

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

const discoverCompatibleCheckpoint = async (
  request: APIRequestContext,
): Promise<LiveCheckpoint> => {
  const baseUrl = alphaZeroBaseUrl();
  let response;
  try {
    response = await request.get(`${baseUrl}/v1/checkpoints`, { timeout: 5_000 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `AlphaZero live lifecycle acceptance was explicitly requested, but ${baseUrl}/v1/checkpoints is unavailable: ${detail}`,
    );
  }
  if (!response.ok()) {
    throw new Error(`/v1/checkpoints returned HTTP ${response.status()}.`);
  }

  const payload = asRecord(await response.json());
  if (payload?.protocolVersion !== 1 || !Array.isArray(payload.checkpoints)) {
    throw new Error('AlphaZero /v1/checkpoints returned an invalid Protocol V1 payload.');
  }

  const compatible = payload.checkpoints.flatMap((raw): LiveCheckpoint[] => {
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
    return [{
      id: checkpoint.id,
      iteration: checkpoint.iteration as number,
      topology: 'torus',
      size: 9,
      ruleSet: 'chinese',
      komi: 0.5,
      ...(status === undefined
        ? {}
        : { lineageStatus: status as LiveCheckpoint['lineageStatus'] }),
    }];
  });

  compatible.sort((left, right) => {
    const leftActive = (left.lineageStatus ?? 'ACTIVE') === 'ACTIVE' ? 1 : 0;
    const rightActive = (right.lineageStatus ?? 'ACTIVE') === 'ACTIVE' ? 1 : 0;
    return rightActive - leftActive || right.iteration - left.iteration || left.id.localeCompare(right.id);
  });

  const selected = compatible[0];
  if (!selected) {
    throw new Error(
      'AlphaZero live lifecycle acceptance requires Torus 9×9 / Chinese / komi 0.5 descriptor metadata.',
    );
  }
  return selected;
};

const startBotGame = async (
  page: Page,
  checkpoint: LiveCheckpoint,
  mctsSimulations: number,
): Promise<void> => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Torus', exact: true }).click();
  await page.getByLabel('Board size').selectOption('9');
  await page.getByLabel('Rules').selectOption('chinese');
  await page.getByLabel('Komi').fill('0.5');
  await page.getByLabel('MCTS simulations').fill(String(mctsSimulations));
  await page.getByRole('button', { name: 'Choose model…' }).click();

  const dialog = page.getByRole('dialog', { name: 'AlphaZero' });
  await expect(dialog.getByText('Connected', { exact: true })).toBeVisible({ timeout: 10_000 });
  if ((checkpoint.lineageStatus ?? 'ACTIVE') !== 'ACTIVE') {
    await dialog.getByLabel('Show closed lineages').check();
  }
  await dialog.getByLabel('Bot checkpoint').selectOption(checkpoint.id);
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

test.describe('Play vs bot live AlphaZero lifecycle acceptance', () => {
  test.skip(!LIVE_REQUESTED, 'Run explicitly with npm run test:alphazero-live.');
  test.setTimeout(240_000);

  test('transport failure shows Retry and Retry continues the same authoritative game against the real service', async ({
    page,
    request,
  }) => {
    const checkpoint = await discoverCompatibleCheckpoint(request);
    const mctsSimulations = liveMctsSimulations();
    const moveUrl = `${alphaZeroBaseUrl()}/v1/move`;
    let failedRequest: MoveRequest | null = null;
    let failFirstMove = true;

    await page.route(moveUrl, async (route) => {
      const intercepted = route.request();
      if (intercepted.method() !== 'POST' || !failFirstMove) {
        await route.continue();
        return;
      }
      failFirstMove = false;
      failedRequest = intercepted.postDataJSON() as MoveRequest;
      await route.abort('connectionfailed');
    });

    await startBotGame(page, checkpoint, mctsSimulations);
    await primaryHit(page, '0,0').click();

    await expect(primaryStone(page, '0,0')).toHaveCount(1);
    await expect(turnIndicator(page)).toContainText('Bot move failed.', { timeout: 20_000 });
    const retry = page.getByRole('button', { name: 'Retry', exact: true });
    await expect(retry).toBeVisible();
    await expect.poll(() => failedRequest !== null).toBe(true);

    const failed = failedRequest;
    if (!failed) throw new Error('Expected the first /v1/move request to be intercepted.');
    expect(failed.position.moves).toEqual([
      { moveNumber: 1, color: 'black', action: { type: 'place', pointId: '0,0' } },
    ]);

    await page.unroute(moveUrl);
    const retryRequestPromise = page.waitForRequest(
      (candidate) => candidate.method() === 'POST' && new URL(candidate.url()).pathname === '/v1/move',
      { timeout: 75_000 },
    );
    const retryResponsePromise = page.waitForResponse(
      (candidate) => candidate.request().method() === 'POST' && new URL(candidate.url()).pathname === '/v1/move',
      { timeout: 75_000 },
    );
    await retry.click();

    const retryRequest = (await retryRequestPromise).postDataJSON() as MoveRequest;
    expect(retryRequest.position.moves).toEqual(failed.position.moves);
    expect(retryRequest.checkpointId).toBe(failed.checkpointId);
    expect(retryRequest.mctsSims).toBe(failed.mctsSims);

    const retryResponse = await retryResponsePromise;
    expect(retryResponse.ok()).toBe(true);
    const retryBody = (await retryResponse.json()) as MoveResponse;
    assertRealMoveResponse(retryBody, retryRequest, 'white');
    await expect(turnIndicator(page)).toContainText('Black to move', { timeout: 75_000 });
    await expect(retry).toHaveCount(0);
  });

  test('board input stays blocked and a completed real MCTS response cannot mutate a replacement game', async ({
    page,
    request,
  }) => {
    const checkpoint = await discoverCompatibleCheckpoint(request);
    const mctsSimulations = liveMctsSimulations();
    const moveUrl = `${alphaZeroBaseUrl()}/v1/move`;

    let releaseResponse!: () => void;
    const responseRelease = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    let markBackendCompleted!: () => void;
    const backendCompleted = new Promise<void>((resolve) => {
      markBackendCompleted = resolve;
    });
    let liveRequest: MoveRequest | null = null;
    let liveResponseBody: MoveResponse | null = null;
    let liveStatus: number | null = null;

    await page.route(moveUrl, async (route) => {
      const intercepted = route.request();
      if (intercepted.method() !== 'POST') {
        await route.continue();
        return;
      }

      liveRequest = intercepted.postDataJSON() as MoveRequest;
      const backendResponse = await route.fetch({ timeout: 75_000 });
      liveStatus = backendResponse.status();
      liveResponseBody = (await backendResponse.json()) as MoveResponse;
      markBackendCompleted();
      await responseRelease;
      await route.fulfill({ response: backendResponse });
    });

    await startBotGame(page, checkpoint, mctsSimulations);
    const moveRequestPromise = page.waitForRequest(
      (candidate) => candidate.method() === 'POST' && new URL(candidate.url()).pathname === '/v1/move',
      { timeout: 75_000 },
    );
    await primaryHit(page, '0,0').click();
    await moveRequestPromise;

    await expect(primaryStone(page, '0,0')).toHaveCount(1);
    await expect(turnIndicator(page)).toContainText('Computer is thinking…');
    await expect(page.getByRole('button', { name: 'Pass', exact: true })).toBeDisabled();

    await primaryHit(page, '1,0').click();
    await expect(primaryStone(page, '1,0')).toHaveCount(0);

    await backendCompleted;
    if (liveStatus !== 200 || !liveRequest || !liveResponseBody) {
      releaseResponse();
      throw new Error(`Expected a successful real /v1/move response, got HTTP ${liveStatus}.`);
    }
    assertRealMoveResponse(liveResponseBody, liveRequest, 'white');

    await page.getByRole('button', { name: 'New game', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: 'Start a new game?' });
    await confirmation.getByRole('button', { name: 'New Game', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Play vs bot' })).toBeVisible();

    await page.getByRole('button', { name: 'Start game', exact: true }).click();
    await expect(turnIndicator(page)).toContainText('Black to move');
    await expect(page.locator('.torus-board__stone[data-copy-role="primary"]')).toHaveCount(0);

    releaseResponse();
    await page.unroute(moveUrl);
    await page.waitForTimeout(250);

    await expect(page.locator('.torus-board__stone[data-copy-role="primary"]')).toHaveCount(0);
    await expect(turnIndicator(page)).toContainText('Black to move');
    await expect(page.getByText('Computer is thinking…', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Bot move failed.', { exact: true })).toHaveCount(0);
  });
});
