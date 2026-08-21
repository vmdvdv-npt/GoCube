import { expect, test, type Page } from '@playwright/test';

const start19x19Game = async (page: Page): Promise<void> => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'New game' })).toBeVisible();
  await page.getByLabel('Board size').selectOption('19');
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('.torus-game')).toBeVisible();
};

const zoomValue = async (page: Page): Promise<number> =>
  Number(await page.locator('.torus-board').getAttribute('data-view-zoom'));

test('Torus 2D wheel zoom is smooth, bounded and survives duplicate-region rendering', async ({
  page,
}) => {
  await start19x19Game(page);

  const board = page.locator('.torus-board');
  await expect(board).toHaveAttribute('data-view-zoom', '1.000');

  await board.hover();
  await page.mouse.wheel(0, -500);
  await expect.poll(() => zoomValue(page)).toBeGreaterThan(1);
  const zoomedIn = await zoomValue(page);

  await page.getByLabel('Показывать дублирующие области').check();
  await expect(board).toHaveAttribute('data-duplicate-regions-visible', 'true');
  await expect.poll(() => zoomValue(page)).toBeCloseTo(zoomedIn, 3);

  const centerPoint = page.locator(
    '.torus-board__hit-target[data-logical-point-id="9,9"][data-copy-role="primary"]',
  );
  await centerPoint.click();
  await expect(page.getByText('White to move')).toBeVisible();
  await expect(page.getByText('Move 1')).toBeVisible();

  await board.hover();
  for (let step = 0; step < 8; step += 1) await page.mouse.wheel(0, -500);
  await expect(board).toHaveAttribute('data-view-zoom', '2.500');

  for (let step = 0; step < 12; step += 1) await page.mouse.wheel(0, 500);
  await expect(board).toHaveAttribute('data-view-zoom', '0.700');

  await page.getByLabel('Показывать дублирующие области').uncheck();
  await expect(board).toHaveAttribute('data-duplicate-regions-visible', 'false');
  await expect(board).toHaveAttribute('data-view-zoom', '0.700');
});
