import { expect, test } from '@playwright/test';

test('Cube 2D technical preview renders the 4x3 layout and logical point mapping', async ({ page }) => {
  await page.goto('/?cube2d-preview=1');

  await expect(page.getByRole('heading', { name: 'Cube 2D renderer preview' })).toBeVisible();

  const boards = page.locator('.cube-2d-board');
  await expect(boards).toHaveCount(12);

  const central = page.locator('.cube-2d-board[data-central="true"]');
  await expect(central).toHaveCount(1);
  await expect(central).toHaveAttribute('data-layout-row', '1');
  await expect(central).toHaveAttribute('data-layout-column', '1');
  await expect(central).toHaveAttribute('data-face', 'front');

  const topRotations = await page
    .locator('.cube-2d-board[data-layout-row="0"]')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-rotation')));
  expect(topRotations).toEqual(['270', '0', '90', '180']);

  const firstBoard = boards.first();
  await expect(firstBoard.locator('line')).toHaveCount(8);
  await expect(firstBoard.locator('.cube-2d-visual-point')).toHaveCount(16);

  const rotatedTop = page.locator(
    '.cube-2d-board[data-layout-row="0"][data-layout-column="2"][data-rotation="90"]',
  );
  await expect(
    rotatedTop.locator('.cube-2d-visual-point[data-visual-row="0"][data-visual-column="3"]'),
  ).toHaveAttribute('data-point-id', 'top:0:0');

  const boardBoxes = await boards.evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { width: box.width, height: box.height };
    }),
  );
  expect(boardBoxes.every((box) => Math.abs(box.width - box.height) < 0.5)).toBe(true);
  expect(new Set(boardBoxes.map((box) => `${box.width}:${box.height}`)).size).toBe(1);

  await page.getByLabel('Cube size').selectOption('5');
  await expect(firstBoard.locator('line')).toHaveCount(10);
  await expect(firstBoard.locator('.cube-2d-visual-point')).toHaveCount(25);
  await expect(page.getByText('logical points: 150')).toBeVisible();
});
