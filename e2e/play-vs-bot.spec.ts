import { expect, test, type Page, type Route } from '@playwright/test';

type MoveRequest = Readonly<{
  protocolVersion: 1;
  requestId: string;
  checkpointId: string;
  mctsSims: number;
  position: Readonly<{
    topology: 'torus';
    size: 9;
    ruleSet: 'chinese';
    komi: number;
    moves: readonly Readonly<Record<string, unknown>>[];
  }>;
}>;

type MoveAction =
  | Readonly<{ type: 'place'; pointId: string }>
  | Readonly<{ type: 'pass' }>;

const checkpoint = {
  id: 'torus9-bot-e2e',
  runName: 'torus9-bot-e2e',
  iteration: 93,
  topology: 'torus',
  size: 9,
  ruleSet: 'chinese',
  komi: 0.5,
  lineageStatus: 'ACTIVE',
} as const;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const selectedMoveBody = (
  request: MoveRequest,
  action: MoveAction,
  color: 'black' | 'white',
) => ({
  protocolVersion: 1,
  requestId: request.requestId,
  checkpointId: request.checkpointId,
  mctsSims: request.mctsSims,
  moveNumber: request.position.moves.length + 1,
  color,
  action,
  search: {
    simulations: request.mctsSims,
    implementationId: 'fake-playwright-search',
  },
});

const installBotService = async (
  page: Page,
  onMove: (route: Route, request: MoveRequest, attempt: number) => Promise<void>,
): Promise<void> => {
  let attempt = 0;
  await page.route('http://127.0.0.1:8765/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }

    if (url.pathname === '/v1/health') {
      await route.fulfill({
        status: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          protocolVersion: 1,
          status: 'ok',
          service: 'gocube-alphazero',
          device: 'test',
          capabilities: { generateGame: true, selectMove: true },
        }),
      });
      return;
    }

    if (url.pathname === '/v1/checkpoints') {
      await route.fulfill({
        status: 200,
        headers: corsHeaders,
        body: JSON.stringify({ protocolVersion: 1, checkpoints: [checkpoint] }),
      });
      return;
    }

    if (url.pathname === '/v1/move') {
      attempt += 1;
      await onMove(route, request.postDataJSON() as MoveRequest, attempt);
      return;
    }

    await route.fulfill({ status: 404, headers: corsHeaders, body: '{}' });
  });
};

const selectTorus2D = async (page: Page): Promise<void> => {
  const view2D = page
    .getByRole('group', { name: 'Torus view' })
    .getByRole('button', { name: '2D' });
  await expect(view2D).toBeEnabled();
  await view2D.click();
  await expect(view2D).toHaveAttribute('aria-pressed', 'true');
};

const startBotGame = async (
  page: Page,
  color: 'Black' | 'White' = 'Black',
): Promise<void> => {
  await page.goto('/');
  await page.getByLabel('Rules').selectOption('chinese');
  await page.getByLabel('Komi').fill('0.5');
  if (color === 'White') {
    await page
      .locator('.play-vs-bot-card')
      .getByRole('button', { name: 'White', exact: true })
      .click();
  }
  const panel = page.locator('.play-vs-bot-card');
  await panel.getByRole('button', { name: 'Choose model', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'AlphaZero' });
  await expect(dialog.getByText('CONNECTED', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Bot checkpoint')).toHaveValue(checkpoint.id);
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await panel.getByRole('button', { name: 'Play vs AI', exact: true }).click();
  await expect(page.getByRole('region', { name: /game/i }).or(page.locator('.torus-game'))).toBeVisible();
  await selectTorus2D(page);
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

test.describe('Play vs bot acceptance', () => {
  test.beforeEach(async ({ browserName }) => {
    test.skip(browserName !== 'chromium', 'Interactive bot acceptance is a Chromium gate.');
  });

  test('Human Black renders immediately, shows thinking in sidebar, then renders bot move', async ({
    page,
  }) => {
    const pending = deferred<MoveAction>();
    const requests: MoveRequest[] = [];
    await installBotService(page, async (route, request) => {
      requests.push(request);
      const action = await pending.promise;
      await route.fulfill({
        status: 200,
        headers: corsHeaders,
        body: JSON.stringify(selectedMoveBody(request, action, 'white')),
      });
    });

    await startBotGame(page, 'Black');
    await primaryHit(page, '0,0').click();

    await expect(primaryStone(page, '0,0')).toHaveCount(1);
    await expect(turnIndicator(page)).toContainText('Computer is thinking…');
    await expect(page.getByRole('button', { name: 'Pass', exact: true })).toBeDisabled();
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0]!.position.moves).toEqual([
      { moveNumber: 1, color: 'black', action: { type: 'place', pointId: '0,0' } },
    ]);

    pending.resolve({ type: 'place', pointId: '1,0' });

    await expect(primaryStone(page, '1,0')).toHaveCount(1);
    await expect(turnIndicator(page)).toContainText('Black to move');
  });

  test('Undo and Redo restore one complete human decision without another bot request', async ({
    page,
  }) => {
    const requests: MoveRequest[] = [];
    await installBotService(page, async (route, request) => {
      requests.push(request);
      await route.fulfill({
        status: 200,
        headers: corsHeaders,
        body: JSON.stringify(
          selectedMoveBody(request, { type: 'place', pointId: '1,0' }, 'white'),
        ),
      });
    });

    await startBotGame(page, 'Black');
    await primaryHit(page, '0,0').click();
    await expect(primaryStone(page, '0,0')).toHaveCount(1);
    await expect(primaryStone(page, '1,0')).toHaveCount(1);
    await expect.poll(() => requests.length).toBe(1);

    const undo = page.getByRole('button', { name: 'Undo', exact: true });
    const redo = page.getByRole('button', { name: 'Redo', exact: true });
    await expect(undo).toBeEnabled();
    await undo.click();

    await expect(primaryStone(page, '0,0')).toHaveCount(0);
    await expect(primaryStone(page, '1,0')).toHaveCount(0);
    await expect(turnIndicator(page)).toContainText('Black to move');
    await expect(redo).toBeEnabled();

    await redo.click();

    await expect(primaryStone(page, '0,0')).toHaveCount(1);
    await expect(primaryStone(page, '1,0')).toHaveCount(1);
    await expect(turnIndicator(page)).toContainText('Black to move');
    expect(requests).toHaveLength(1);
  });

  test('Human White automatically receives the opening Black bot move', async ({ page }) => {
    const pending = deferred<MoveAction>();
    let openingRequest: MoveRequest | null = null;
    await installBotService(page, async (route, request) => {
      openingRequest = request;
      const action = await pending.promise;
      await route.fulfill({
        status: 200,
        headers: corsHeaders,
        body: JSON.stringify(selectedMoveBody(request, action, 'black')),
      });
    });

    await startBotGame(page, 'White');
    await expect(turnIndicator(page)).toContainText('Computer is thinking…');
    await expect.poll(() => openingRequest?.position.moves.length ?? -1).toBe(0);
    pending.resolve({ type: 'place', pointId: '0,0' });

    await expect(primaryStone(page, '0,0')).toHaveCount(1);
    await expect(turnIndicator(page)).toContainText('White to move');
  });

  test('bot failure keeps human move and Retry continues the same turn', async ({ page }) => {
    await installBotService(page, async (route, request, attempt) => {
      if (attempt === 1) {
        await route.fulfill({
          status: 503,
          headers: corsHeaders,
          body: JSON.stringify({
            error: { code: 'search_failed', message: 'forced failure' },
          }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        headers: corsHeaders,
        body: JSON.stringify(
          selectedMoveBody(request, { type: 'place', pointId: '1,0' }, 'white'),
        ),
      });
    });

    await startBotGame(page, 'Black');
    await primaryHit(page, '0,0').click();

    await expect(primaryStone(page, '0,0')).toHaveCount(1);
    await expect(turnIndicator(page)).toContainText('Bot move failed.');
    const retry = page.getByRole('button', { name: 'Retry', exact: true });
    await expect(retry).toBeVisible();
    await retry.click();

    await expect(primaryStone(page, '1,0')).toHaveCount(1);
    await expect(turnIndicator(page)).toContainText('Black to move');
    await expect(retry).toHaveCount(0);
  });

  test('late response from an invalidated bot runtime cannot alter the next game presentation', async ({
    page,
  }) => {
    const pending = deferred<MoveAction>();
    let staleRequest: MoveRequest | null = null;
    await installBotService(page, async (route, request) => {
      staleRequest = request;
      const action = await pending.promise;
      await route.fulfill({
        status: 200,
        headers: corsHeaders,
        body: JSON.stringify(selectedMoveBody(request, action, 'white')),
      });
    });

    await startBotGame(page, 'Black');
    await primaryHit(page, '0,0').click();
    await expect(primaryStone(page, '0,0')).toHaveCount(1);
    await expect(turnIndicator(page)).toContainText('Computer is thinking…');
    await expect.poll(() => staleRequest !== null).toBe(true);

    await page.getByRole('button', { name: 'New game', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: 'Start a new game?' });
    await confirmation.getByRole('button', { name: 'New Game', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Play vs bot' })).toBeVisible();

    await page.getByRole('button', { name: 'Start game', exact: true }).click();
    await selectTorus2D(page);
    await expect(turnIndicator(page)).toContainText('Black to move');
    await expect(page.locator('.torus-board__stone[data-copy-role="primary"]')).toHaveCount(0);

    pending.resolve({ type: 'place', pointId: '1,0' });
    await page.waitForTimeout(100);

    await expect(primaryStone(page, '1,0')).toHaveCount(0);
    await expect(turnIndicator(page)).toContainText('Black to move');
    await expect(page.getByText('Computer is thinking…', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Bot move failed.', { exact: true })).toHaveCount(0);

    await primaryHit(page, '2,0').click();
    await expect(primaryStone(page, '2,0')).toHaveCount(1);
    await expect(turnIndicator(page)).toContainText('White to move');
  });
});