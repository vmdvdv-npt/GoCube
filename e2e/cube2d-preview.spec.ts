import { expect, test } from '@playwright/test';

test('Cube 2D technical preview renders six physical faces in the 4x3 cross', async ({ page }) => {
  await page.goto('/?cube2d-preview=1');

  await expect(page.getByRole('heading', { name: 'Cube 2D renderer preview' })).toBeVisible();
  await expect(page.getByText('occupied boards: 6')).toBeVisible();
  await expect(page.getByText('empty slots: 6')).toBeVisible();

  const renderer = page.locator('.cube-2d-renderer');
  await expect(renderer).toHaveAttribute('data-layout-rows', '3');
  await expect(renderer).toHaveAttribute('data-layout-columns', '4');
  await expect(renderer).toHaveAttribute('data-board-count', '6');

  const boards = page.locator('.cube-2d-board');
  await expect(boards).toHaveCount(6);
  expect(await boards.evaluateAll((elements) => elements.some((element) => element.hasAttribute('data-duplicate')))).toBe(false);

  const top = page.locator('.cube-2d-board[data-layout-row="0"][data-layout-column="1"]');
  const left = page.locator('.cube-2d-board[data-layout-row="1"][data-layout-column="0"]');
  const central = page.locator('.cube-2d-board[data-layout-row="1"][data-layout-column="1"]');
  const right = page.locator('.cube-2d-board[data-layout-row="1"][data-layout-column="2"]');
  const back = page.locator('.cube-2d-board[data-layout-row="1"][data-layout-column="3"]');
  const bottom = page.locator('.cube-2d-board[data-layout-row="2"][data-layout-column="1"]');

  await expect(top).toHaveAttribute('data-face', 'top');
  await expect(left).toHaveAttribute('data-face', 'left');
  await expect(central).toHaveAttribute('data-face', 'front');
  await expect(right).toHaveAttribute('data-face', 'right');
  await expect(back).toHaveAttribute('data-face', 'back');
  await expect(bottom).toHaveAttribute('data-face', 'bottom');
  await expect(central).toHaveAttribute('data-central', 'true');

  const boxes = await Promise.all([top, left, central, right, back, bottom].map((locator) => locator.boundingBox()));
  const [topBox, leftBox, centerBox, rightBox, backBox, bottomBox] = boxes;
  expect(topBox && leftBox && centerBox && rightBox && backBox && bottomBox).toBeTruthy();
  expect(Math.abs(topBox!.x - centerBox!.x)).toBeLessThan(1);
  expect(Math.abs(bottomBox!.x - centerBox!.x)).toBeLessThan(1);
  expect(topBox!.y).toBeLessThan(centerBox!.y);
  expect(bottomBox!.y).toBeGreaterThan(centerBox!.y);
  expect(Math.abs(leftBox!.y - centerBox!.y)).toBeLessThan(1);
  expect(Math.abs(rightBox!.y - centerBox!.y)).toBeLessThan(1);
  expect(Math.abs(backBox!.y - centerBox!.y)).toBeLessThan(1);
  expect(leftBox!.x).toBeLessThan(centerBox!.x);
  expect(rightBox!.x).toBeGreaterThan(centerBox!.x);
  expect(backBox!.x).toBeGreaterThan(rightBox!.x);

  await expect(central.locator('line')).toHaveCount(8);
  await expect(central.locator('.cube-2d-visual-point')).toHaveCount(16);

  const boardBoxes = await boards.evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { width: box.width, height: box.height };
    }),
  );
  expect(boardBoxes.every((box) => Math.abs(box.width - box.height) < 0.5)).toBe(true);
  expect(new Set(boardBoxes.map((box) => `${box.width}:${box.height}`)).size).toBe(1);

  await page.getByLabel('Diagnostic rotation').selectOption('90');
  await expect(central).toHaveAttribute('data-face', 'front');
  await expect(central).toHaveAttribute('data-rotation', '90');
  await expect(
    central.locator('.cube-2d-visual-point[data-visual-row="0"][data-visual-column="3"]'),
  ).toHaveAttribute('data-point-id', 'front:0:0');
  await expect(boards).toHaveCount(6);

  await page.getByLabel('Cube size').selectOption('5');
  await expect(central.locator('line')).toHaveCount(10);
  await expect(central.locator('.cube-2d-visual-point')).toHaveCount(25);
  await expect(page.getByText('logical points: 150')).toBeVisible();
  await expect(page.getByText('occupied boards: 6')).toBeVisible();
});
