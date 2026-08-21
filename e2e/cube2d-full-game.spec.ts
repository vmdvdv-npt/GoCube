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
  await page.goto('/?cube2d-preview=1');
  await page.getByRole('combobox', { name: 'Cube size' }).selectOption('3');
  await expect(page.locator('.cube-2d-renderer')).toHaveAttribute('data-cube-size', '3');
});

test('Cube 2D capture animates from real faces and can be undone/redone without duplicates', async ({ page }) => {
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
  ];

  for (const point of moves) await hit(page, point).click();
  await hit(page, 'right:1:1').click();

  await expect(stone(page, 'front:1:2')).toHaveCount(0);
  await expect(stone(page, 'right:1:0')).toHaveCount(0);
  const captureStones = page.locator('.cube-2d-capture-stone');
  await expect(captureStones).toHaveCount(2);
  await expect(captureStones.nth(0)).toHaveAttribute('data-capture-color', 'white');
  await expect(captureStones.nth(0)).toHaveAttribute('data-delay-ms', '0');
  await expect(captureStones.nth(1)).toHaveAttribute('data-delay-ms', '150');
  await expectSixBoards(page);

  await expect(captureStones).toHaveCount(0, { timeout: 1500 });

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(stone(page, 'front:1:2')).toHaveCount(1);
  await expect(stone(page, 'right:1:0')).toHaveCount(1);
  await expect(captureStones).toHaveCount(0);
  await expectSixBoards(page);

  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(stone(page, 'front:1:2')).toHaveCount(0);
  await expect(stone(page, 'right:1:0')).toHaveCount(0);
  await expect(captureStones).toHaveCount(0);
  await expectSixBoards(page);
});

test('Cube 2D endgame presentation survives Result/navigation and follows Undo/Redo', async ({ page }) => {
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

  await expect(page.getByRole('heading', { name: 'Manual endgame classification' })).toBeVisible();
  await expect(page.getByText(/Classified 0 of/)).toBeVisible();

  await hit(page, 'front:1:2').hover();
  await expect(page.locator('.cube-2d-endgame-group-hover[data-logical-point-id="front:1:2"]')).toHaveCount(1);
  await expect(page.locator('.cube-2d-endgame-group-hover[data-logical-point-id="right:1:0"]')).toHaveCount(1);

  await hit(page, 'front:1:2').click();
  await expect(page.locator('.cube-2d-endgame-group-selected[data-logical-point-id="front:1:2"]')).toHaveCount(1);
  await expect(page.locator('.cube-2d-endgame-group-selected[data-logical-point-id="right:1:0"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Alive' }).click();

  await hit(page, 'front:0:0').click();
  await page.getByRole('button', { name: 'Alive' }).click();

  await hit(page, 'back:0:0').click();
  await page.getByRole('button', { name: 'Dead' }).click();
  await expect(page.locator('.cube-2d-dead-stone[data-logical-point-id="back:0:0"]')).toHaveCount(1);

  await page.getByRole('button', { name: 'Calculate final score' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('Chinese scoring')).toBeVisible();
  await expect(page.locator('.cube-2d-territory-cell--black')).not.toHaveCount(0);
  await expect(page.locator('.cube-2d-dead-stone[data-logical-point-id="back:0:0"]')).toHaveCount(1);
  await expectSixBoards(page);

  await page.getByRole('button', { name: 'Close game result' }).click();
  await expect(page.getByRole('button', { name: 'Game result' })).toBeVisible();
  await expect(page.locator('.cube-2d-territory-cell--black')).not.toHaveCount(0);
  await expect(page.locator('.cube-2d-dead-stone[data-logical-point-id="back:0:0"]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Pass' })).toBeDisabled();
  await expect(page.locator('.cube-2d-renderer')).toHaveAttribute('data-gameplay-input-disabled', 'true');

  await page.getByRole('button', { name: 'Move cube right' }).click();
  await expect(page.locator('.cube-2d-renderer')).toHaveAttribute('data-animating', 'true');
  await expect(page.locator('.cube-2d-renderer')).toHaveAttribute('data-animating', 'false', { timeout: 1000 });
  const centralFace = await page.locator('.cube-2d-board[data-central="true"]').getAttribute('data-face');
  expect(centralFace).toBeTruthy();
  await expect(page.locator('.cube-2d-territory-cell--black')).not.toHaveCount(0);
  await expectSixBoards(page);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('button', { name: 'Pass (1)' })).toBeEnabled();
  await expect(page.locator('.cube-2d-territory-cell')).toHaveCount(0);
  await expect(page.locator('.cube-2d-dead-stone')).toHaveCount(0);
  await expect(page.locator('.cube-2d-renderer')).toHaveAttribute('data-gameplay-input-disabled', 'false');
  await expect(page.locator('.cube-2d-board[data-central="true"]')).toHaveAttribute('data-face', centralFace!);

  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('.cube-2d-territory-cell--black')).not.toHaveCount(0);
  await expect(page.locator('.cube-2d-dead-stone[data-logical-point-id="back:0:0"]')).toHaveCount(1);
  await expect(page.locator('.cube-2d-board[data-central="true"]')).toHaveAttribute('data-face', centralFace!);
  await expectSixBoards(page);

  await page.getByRole('button', { name: 'Close game result' }).click();
  await page.getByRole('button', { name: 'Undo' }).click();
  await hit(page, 'front:2:0').click();
  await expect(stone(page, 'front:2:0')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Pass' })).toBeEnabled();
  await expectSixBoards(page);
});
