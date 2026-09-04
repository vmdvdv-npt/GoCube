import { expect, test, type Page } from '@playwright/test';

type GeneratedMove = Readonly<Record<string, unknown>>;

const checkpoint = {
  id: 'cube4-current',
  runName: 'cube4-current',
  iteration: 17,
  topology: 'cube',
  size: 4,
  ruleSet: 'chinese',
  komi: 7.5,
} as const;

const normalMoves: readonly GeneratedMove[] = [
  { moveNumber: 1, color: 'black', action: { type: 'place', pointId: 'front:0:0' } },
  { moveNumber: 2, color: 'white', action: { type: 'place', pointId: 'front:0:1' } },
  { moveNumber: 3, color: 'black', action: { type: 'place', pointId: 'front:1:0' } },
  { moveNumber: 4, color: 'white', action: { type: 'place', pointId: 'front:1:1' } },
  { moveNumber: 5, color: 'black', action: { type: 'place', pointId: 'back:0:0' } },
  { moveNumber: 6, color: 'white', action: { type: 'place', pointId: 'back:0:1' } },
  { moveNumber: 7, color: 'black', action: { type: 'pass' } },
  { moveNumber: 8, color: 'white', action: { type: 'pass' } },
];

const routeAlphaZero = async (page: Page, moves: readonly GeneratedMove[]) => {
  await page.route('http://127.0.0.1:8765/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Content-Type': 'application/json',
    };

    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }
    if (url.pathname === '/v1/health') {
      await route.fulfill({
        status: 200,
        headers,
        body: JSON.stringify({
          protocolVersion: 1,
          status: 'ok',
          service: 'gocube-alphazero',
          device: 'test',
        }),
      });
      return;
    }
    if (url.pathname === '/v1/checkpoints') {
      await route.fulfill({
        status: 200,
        headers,
        body: JSON.stringify({ protocolVersion: 1, checkpoints: [checkpoint] }),
      });
      return;
    }
    if (url.pathname === '/v1/games') {
      const requestBody = request.postDataJSON() as Record<string, unknown>;
      expect(requestBody).toMatchObject({
        protocolVersion: 1,
        blackCheckpointId: checkpoint.id,
        whiteCheckpointId: checkpoint.id,
        mctsSims: 100,
      });
      await route.fulfill({
        status: 200,
        headers,
        body: JSON.stringify({
          protocolVersion: 1,
          game: {
            topology: checkpoint.topology,
            size: checkpoint.size,
            ruleSet: checkpoint.ruleSet,
            komi: checkpoint.komi,
            terminalAdjudicator: 'gocube-conservative-area-v1',
            mctsSims: 100,
            black: { checkpointId: checkpoint.id },
            white: { checkpointId: checkpoint.id },
            moves,
          },
        }),
      });
      return;
    }

    await route.fulfill({ status: 404, headers, body: '{}' });
  });
};

const stone = (page: Page, pointId: string) =>
  page.locator(`.cube-2d-stone[data-logical-point-id="${pointId}"]`);

const localStorageSnapshot = (page: Page) =>
  page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));

test('Development Workspace replays generated Cube game without changing normal saved game', async ({ page }) => {
  await routeAlphaZero(page, normalMoves);
  await page.goto('/');

  await page.getByRole('button', { name: 'Cube', exact: true }).click();
  await page.getByRole('button', { name: '4×4', exact: true }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
  await page.locator('.cube-2d-hit-area[data-point-id="front:2:2"]').click();
  await expect(stone(page, 'front:2:2')).toHaveCount(1);
  const savedBefore = await localStorageSnapshot(page);

  await page.getByRole('button', { name: 'Development', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Development Workspace' })).toBeVisible();
  await expect(page.getByText(/gocube-alphazero test · protocol v1/)).toBeVisible();
  await expect(page.getByLabel('Black checkpoint')).toHaveValue(checkpoint.id);
  await expect(page.getByLabel('White checkpoint')).toHaveValue(checkpoint.id);

  await page.getByRole('button', { name: 'Generate game' }).click();
  await expect(page.locator('.cube-2d-renderer')).toHaveAttribute('data-cube-size', '4');
  await expect(page.locator('.cube-2d-board')).toHaveCount(6);
  await expect(page.getByText('0 / 8', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Next move' }).click();
  await expect(stone(page, 'front:0:0')).toHaveCount(1);
  await expect(page.getByText('1 / 8', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Previous move' }).click();
  await expect(stone(page, 'front:0:0')).toHaveCount(0);
  await page.getByRole('button', { name: 'Next move' }).click();
  await expect(stone(page, 'front:0:0')).toHaveCount(1);

  await page.getByLabel('Replay position').fill('3');
  await expect(page.getByText('3 / 8', { exact: true })).toBeVisible();
  await expect(stone(page, 'front:1:0')).toHaveCount(1);

  await page.getByRole('button', { name: '5×', exact: true }).click();
  await expect(page.locator('.cube-2d-game')).toHaveAttribute('data-animation-mode', 'disabled');
  await page.getByRole('button', { name: '1×', exact: true }).click();
  await expect(page.locator('.cube-2d-game')).toHaveAttribute('data-animation-mode', 'normal');
  await page.getByRole('button', { name: '10×', exact: true }).click();
  await expect(page.locator('.cube-2d-game')).toHaveAttribute('data-animation-mode', 'disabled');

  await page.getByRole('button', { name: 'Replay start' }).click();
  await expect(page.getByText('0 / 8', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Play replay' }).click();
  await expect(page.getByRole('button', { name: 'Pause replay' })).toBeVisible();
  await expect.poll(async () => Number((await page.locator('.developer-replay-controls__position').textContent())?.split('/')[0]?.trim())).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pause replay' }).click();

  await page.getByRole('button', { name: 'Replay end' }).click();
  await expect(page.getByText('8 / 8', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Assisted endgame review' })).toBeVisible();

  await page.getByRole('button', { name: 'Back to GoCube' }).click();
  await expect(stone(page, 'front:2:2')).toHaveCount(1);
  expect(await localStorageSnapshot(page)).toEqual(savedBefore);
});

test('Development replay stops and diagnoses an illegal AlphaZero move', async ({ page }) => {
  await routeAlphaZero(page, [
    { moveNumber: 1, color: 'black', action: { type: 'place', pointId: 'front:0:0' } },
    { moveNumber: 2, color: 'white', action: { type: 'place', pointId: 'front:0:0' } },
  ]);
  await page.goto('/');
  await page.getByRole('button', { name: 'Development', exact: true }).click();
  await page.getByRole('button', { name: 'Generate game' }).click();

  await page.getByRole('button', { name: 'Next move' }).click();
  await page.getByRole('button', { name: 'Next move' }).click();

  const diagnostic = page.getByRole('alert');
  await expect(diagnostic).toContainText('Compatibility failure at move 2');
  await expect(diagnostic).toContainText('front:0:0');
  await expect(diagnostic).toContainText('rejected');
  await expect(page.getByText('1 / 2', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play replay' })).toBeVisible();
  await expect(page.locator('.cube-2d-renderer')).toBeVisible();
});
