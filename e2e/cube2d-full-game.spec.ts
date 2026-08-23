import { expect, test, type Page } from '@playwright/test';

const hit = (page: Page, pointId: string) =>
  page.locator(`.cube-2d-hit-area[data-point-id="${pointId}"]`);

const stone = (page: Page, pointId: string) =>
  page.locator(`.cube-2d-stone[data-logical-point-id="${pointId}"]`);

const expectSixBoards = async (page: Page) => {
  await expect(page.locator('.cube-2d-board')).toHaveCount(6);
  await expect(page.locator('.cube-2d-renderer')).toHaveAttribute('data-board-count', '6');
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cube', exact: true }).click();
  await page.getByRole('button', { name: '3×3', exact: true }).click();
  await page.getByLabel('Rules').selectOption('chinese');
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('.cube-2d-renderer')).toHaveAttribute('data-cube-size', '3');
});

test('Cube 2D capture can be undone/redone without creating face duplicates', async ({ page }) => {
  const moves = [
    'front:1:1',
    'front:1:2',
    'front:0:2',
    'right:1:0',
    'front:2:2',
    'back:1:1',
    'right:0:0',
    'back:0:0',
    'right:2:0',
    'top:1:1',
    'right:1:1',
  ];

  for (const point of moves) await hit(page, point).click();

  await expect(stone(page, 'front:1:2')).toHaveCount(0);
  await expect(stone(page, 'right:1:0')).toHaveCount(0);
  await expectSixBoards(page);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(stone(page, 'front:1:2')).toHaveCount(1);
  await expect(stone(page, 'right:1:0')).toHaveCount(1);
  await expectSixBoards(page);

  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(stone(page, 'front:1:2')).toHaveCount(0);
  await expect(stone(page, 'right:1:0')).toHaveCount(0);
  await expectSixBoards(page);
});

test('Cube 2D completes assisted endgame, stays navigable when finished, and Undo reopens play', async ({ page }) => {
  await hit(page, 'front:1:2').click();
  await hit(page, 'back:0:0').click();
  await hit(page, 'right:1:0').click();

  const pass = page.getByRole('button', { name: /^Pass(?: \(1\))?$/ });
  await pass.click();
  await expect(page.getByRole('button', { name: 'Pass (1)' })).toBeDisabled();
  await page.waitForTimeout(1050);
  await expect(page.getByRole('button', { name: 'Pass (1)' })).toBeEnabled();

  await hit(page, 'front:0:0').click();
  await expect(page.getByRole('button', { name: 'Pass' })).toBeEnabled();

  await page.getByRole('button', { name: 'Pass' }).click();
  await page.waitForTimeout(1050);
  await page.getByRole('button', { name: 'Pass (1)' }).click();

  await expect(page.getByRole('heading', { name: 'Assisted endgame review' })).toBeVisible();
  await expect(page.getByText(/Manual review 0 of/)).toBeVisible();

  const statuses = page.getByRole('group', { name: 'Selected group status' });
  for (let index = 0; index < 3; index += 1) {
    await statuses.getByRole('button', { name: 'Alive' }).click();
  }

  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('Chinese scoring')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Calculate final score' })).toHaveCount(0);
  await expectSixBoards(page);

  await page.getByRole('button', { name: 'Close game result' }).click();
  await expect(page.getByRole('button', { name: 'Game result' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pass' })).toBeDisabled();
  await expect(page.locator('.cube-2d-renderer')).toHaveAttribute('data-gameplay-input-disabled', 'true');

  await page.getByRole('button', { name: 'Move cube right' }).click();
  await expect(page.locator('.cube-2d-renderer')).toHaveAttribute('data-animating', 'true');
  await expect(page.locator('.cube-2d-renderer')).toHaveAttribute('data-animating', 'false', { timeout: 1000 });
  const centralFace = await page.locator('.cube-2d-board[data-central="true"]').getAttribute('data-face');
  expect(centralFace).toBeTruthy();
  await expectSixBoards(page);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('button', { name: 'Pass (1)' })).toBeEnabled();
  await expect(page.locator('.cube-2d-renderer')).toHaveAttribute('data-gameplay-input-disabled', 'false');
  await expect(page.locator('.cube-2d-board[data-central="true"]')).toHaveAttribute('data-face', centralFace!);

  await hit(page, 'front:2:0').click();
  await expect(stone(page, 'front:2:0')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Pass' })).toBeEnabled();
  await expectSixBoards(page);
});
