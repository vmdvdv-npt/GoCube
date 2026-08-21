import { expect, test } from '@playwright/test';

test('game screen uses a compact left service panel and a clean board area', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await page.getByLabel('Board size').selectOption('9');
  await page.getByRole('button', { name: 'Start game' }).click();

  await expect(page.locator('.app-header')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Shift torus view up' })).toBeVisible();
  await expect(page.getByText('Black captures 0')).toBeVisible();
  await expect(page.getByText('White captures 0')).toBeVisible();
  await expect(page.getByText('Move 0')).toBeVisible();
  await expect(page.getByText('Passes 0')).toBeVisible();
  await expect(page.getByText('Chinese rules')).toBeVisible();
  await expect(page.getByText('Komi 7.5')).toBeVisible();
  await expect(page.getByLabel('Показывать дублирующие области')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pass' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New game' })).toBeVisible();

  const game = page.locator('.torus-game');
  const summary = page.locator('.game-summary');
  const board = page.locator('.torus-board-shell');

  const [gameBox, summaryBox, boardBox] = await Promise.all([
    game.boundingBox(),
    summary.boundingBox(),
    board.boundingBox(),
  ]);

  expect(gameBox).not.toBeNull();
  expect(summaryBox).not.toBeNull();
  expect(boardBox).not.toBeNull();

  if (!gameBox || !summaryBox || !boardBox) return;

  expect(summaryBox.x).toBeLessThan(boardBox.x);
  expect(summaryBox.width / gameBox.width).toBeGreaterThan(0.16);
  expect(summaryBox.width / gameBox.width).toBeLessThan(0.27);

  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(background).toBe('rgb(4, 9, 15)');
});
