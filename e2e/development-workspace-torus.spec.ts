import { expect, test, type Page } from '@playwright/test';

const checkpoint = {
  id: 'torus9-golden-v3-20260914-run03@17',
  runName: 'torus9-golden-v3-20260914-run03',
  iteration: 17,
  topology: 'torus',
  size: 9,
  ruleSet: 'chinese',
  komi: 0.5,
} as const;

const moves = [
  { moveNumber: 1, color: 'black', action: { type: 'place', pointId: '1,0' } },
  { moveNumber: 2, color: 'white', action: { type: 'place', pointId: '1,1' } },
  { moveNumber: 3, color: 'black', action: { type: 'place', pointId: '0,1' } },
  { moveNumber: 4, color: 'white', action: { type: 'place', pointId: '8,8' } },
  { moveNumber: 5, color: 'black', action: { type: 'place', pointId: '2,1' } },
  { moveNumber: 6, color: 'white', action: { type: 'place', pointId: '7,7' } },
  { moveNumber: 7, color: 'black', action: { type: 'place', pointId: '1,2' }, captured: ['1,1'] },
  { moveNumber: 8, color: 'white', action: { type: 'pass' } },
  { moveNumber: 9, color: 'black', action: { type: 'pass' } },
] as const;

const routeAlphaZero = async (page: Page): Promise<void> => {
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
      expect(request.postDataJSON()).toMatchObject({
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

const primaryStone = (page: Page, pointId: string) =>
  page.locator(
    `.torus-board__stone[data-logical-point-id="${pointId}"][data-copy-role="primary"]`,
  );

const openDevelopmentTorusGame = async (page: Page): Promise<void> => {
  await routeAlphaZero(page);
  await page.goto('/');
  await page.getByRole('link', { name: 'development', exact: true }).click();
  await page.getByRole('button', { name: 'Generate game' }).click();
  await expect(page.locator('.torus-game')).toBeVisible();
};

const torusViewButton = (page: Page, mode: '2D' | '3D') =>
  page.getByRole('group', { name: 'Torus view' }).getByRole('button', { name: mode });

test('Development Workspace replays Torus 9x9 M17-shaped Protocol V1 game through the existing Torus view', async ({ page }) => {
  await routeAlphaZero(page);
  await page.goto('/');
  await page.getByRole('link', { name: 'development', exact: true }).click();

  await expect(page.getByLabel('Black checkpoint')).toHaveValue(checkpoint.id);
  await expect(page.getByLabel('White checkpoint')).toHaveValue(checkpoint.id);
  await expect(page.getByText('torus · 9×9 · chinese · komi 0.5')).toBeVisible();

  await page.getByRole('button', { name: 'Generate game' }).click();
  await expect(page.locator('.torus-game')).toBeVisible();
  await expect(torusViewButton(page, '2D')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.torus-board')).toBeVisible();
  await expect(page.getByText('0 / 9', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Next move' }).click();
  await expect(primaryStone(page, '1,0')).toHaveCount(1);
  await expect(page.getByText('1 / 9', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Previous move' }).click();
  await expect(primaryStone(page, '1,0')).toHaveCount(0);
  await page.getByRole('button', { name: 'Next move' }).click();
  await expect(primaryStone(page, '1,0')).toHaveCount(1);

  await page.getByRole('button', { name: '5×', exact: true }).click();
  await expect(page.locator('.torus-game')).toHaveAttribute('data-animation-mode', 'disabled');
  await page.getByRole('button', { name: '1×', exact: true }).click();
  await expect(page.locator('.torus-game')).toHaveAttribute('data-animation-mode', 'normal');

  await page.getByRole('button', { name: 'Replay start' }).click();
  await expect(page.getByText('0 / 9', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '10×', exact: true }).click();
  await page.getByRole('button', { name: 'Play replay' }).click();
  await expect(page.getByText('9 / 9', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(primaryStone(page, '1,1')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Assisted endgame review' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('Development Torus replay can switch to the production 3D view and back', async ({ page }) => {
  await openDevelopmentTorusGame(page);

  await expect(torusViewButton(page, '2D')).toHaveAttribute('aria-pressed', 'true');
  await torusViewButton(page, '3D').click();
  const scene = page.getByLabel('Torus 3D scene');
  const canvas = page.getByTestId('torus-3d-canvas');
  await expect(scene).toBeVisible();
  await expect(scene).toHaveAttribute('data-torus3d-ready', 'true');
  await expect(scene).toHaveAttribute('data-torus3d-size', '9');
  await expect(scene).toHaveAttribute('data-torus3d-mapping-count', '81');
  await expect(canvas).toBeVisible();

  const rotationBefore = await scene.getAttribute('data-torus3d-rotation');
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  const centerX = bounds!.x + bounds!.width / 2;
  const centerY = bounds!.y + bounds!.height / 2;
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + 70, centerY + 45, { steps: 4 });
  await page.mouse.up();
  await expect(scene).not.toHaveAttribute('data-torus3d-rotation', rotationBefore ?? '');

  const zoomBefore = await scene.getAttribute('data-torus3d-zoom');
  await page.mouse.move(centerX, centerY);
  await page.mouse.wheel(0, -240);
  await expect(scene).not.toHaveAttribute('data-torus3d-zoom', zoomBefore ?? '');

  await torusViewButton(page, '2D').click();
  await expect(scene).toHaveCount(0);
  await expect(page.locator('.torus-board')).toBeVisible();
});
