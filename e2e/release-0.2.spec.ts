import { expect, test, type Page } from '@playwright/test';

const hit = (page: Page, pointId: string) =>
  page.locator(`.cube-2d-hit-area[data-point-id="${pointId}"]`);

const stone = (page: Page, pointId: string) =>
  page.locator(`.cube-2d-stone[data-logical-point-id="${pointId}"]`);

const expectSixBoards = async (page: Page) => {
  await expect(page.locator('.cube-2d-board')).toHaveCount(6);
  await expect(page.locator('.cube-2d-renderer')).toHaveAttribute('data-board-count', '6');
  await expect(page.locator('.cube-2d-board__diagnostic')).toHaveCount(0);
};

test('0.2 production Cube flow: New Game, seam capture, history, zoom, resume and endgame', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await page.goto('/');
  await page.getByRole('button', { name: 'Cube 2D', exact: true }).click();
  await page.getByRole('button', { name: '4×4', exact: true }).click();
  await page.getByLabel('Rules').selectOption('japanese');
  await page.getByLabel('Komi').fill('7.5');
  await page.getByRole('button', { name: 'Start game' }).click();

  await expect(page.getByText('4×4 Cube 2D', { exact: true })).toBeVisible();
  await expectSixBoards(page);

  // White at front:1:3 is captured by a Black liberty supplied from right:1:0.
  for (const point of [
    'front:0:3',
    'front:1:3',
    'front:2:3',
    'back:0:0',
    'front:1:2',
    'back:0:1',
    'right:1:0',
  ]) {
    await hit(page, point).click();
  }
  await expect(stone(page, 'front:1:3')).toHaveCount(0);
  await expectSixBoards(page);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(stone(page, 'front:1:3')).toHaveCount(1);
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(stone(page, 'front:1:3')).toHaveCount(0);

  await page.getByRole('button', { name: 'Move cube right' }).click();
  await expect(page.locator('.cube-2d-renderer')).toHaveAttribute('data-animating', 'false', { timeout: 1000 });
  await expectSixBoards(page);

  await page.getByRole('button', { name: 'Zoom in Cube 2D' }).click();
  await expect(page.getByLabel('Cube zoom')).toHaveText('110%');
  await hit(page, 'top:3:3').click();
  await expect(stone(page, 'top:3:3')).toHaveCount(1);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Continue saved game?' })).toBeVisible();
  await expect(page.getByText(/Cube 2D · 4×4 · Japanese · Komi 7.5/)).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(stone(page, 'top:3:3')).toHaveCount(1);
  await expect(stone(page, 'front:1:3')).toHaveCount(0);
  await expectSixBoards(page);

  await page.getByRole('button', { name: 'Pass' }).click();
  await page.waitForTimeout(1050);
  await page.getByRole('button', { name: 'Pass (1)' }).click();
  await expect(page.getByRole('heading', { name: 'Manual endgame classification' })).toBeVisible();

  const occupiedPointIds = await page.locator('.cube-2d-stone').evaluateAll((nodes) =>
    [...new Set(nodes.map((node) => node.getAttribute('data-logical-point-id')).filter(Boolean))] as string[],
  );
  for (const pointId of occupiedPointIds) {
    await hit(page, pointId).click();
    await page.getByRole('button', { name: 'Alive' }).click();
  }

  await page.getByRole('button', { name: 'Calculate final score' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('Japanese scoring')).toBeVisible();
  await expectSixBoards(page);

  await page.getByRole('button', { name: 'Close game result' }).click();
  await expect(page.getByRole('button', { name: 'Game result' })).toBeVisible();
  await expect(page.locator('.cube-2d-renderer')).toHaveAttribute('data-gameplay-input-disabled', 'true');
  await expectSixBoards(page);
  expect(pageErrors).toEqual([]);
});
