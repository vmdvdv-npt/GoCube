import { expect, test } from '@playwright/test';

test('game screen uses compact statistics and uniform history controls', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await page.getByLabel('Board size').selectOption('9');
  await page.getByRole('button', { name: 'Start game' }).click();

  await expect(page.locator('.app-header')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Shift torus view up' })).toBeVisible();
  await expect(page.getByText('Black Captured 0')).toBeVisible();
  await expect(page.getByText('White Captured 0')).toBeVisible();
  await expect(page.getByText('Move 0')).toBeVisible();
  const passStateHook = page.getByText('Passes 0');
  const passStateBox = await passStateHook.boundingBox();
  expect(passStateBox).not.toBeNull();
  expect(passStateBox?.x ?? 0).toBeLessThan(-1000);
  await expect(page.getByText('Japanese rules')).toBeVisible();
  await expect(page.getByText('Komi 7.5')).toBeVisible();
  await expect(page.getByLabel('Показывать дублирующие области')).toBeVisible();

  const pass = page.getByRole('button', { name: /^Pass(?: \(1\))?$/ });
  const redo = page.getByRole('button', { name: 'Redo' });
  const undo = page.getByRole('button', { name: 'Undo' });
  const newGame = page.getByRole('button', { name: 'New game', exact: true });
  await expect(pass).toBeVisible();
  await expect(redo).toBeVisible();
  await expect(undo).toBeVisible();
  await expect(newGame).toBeVisible();

  const game = page.locator('.torus-game');
  const summary = page.locator('.game-summary');
  const board = page.locator('.torus-board-shell');

  const [gameBox, summaryBox, boardBox, passBox, redoBox, undoBox, newGameBox] = await Promise.all([
    game.boundingBox(),
    summary.boundingBox(),
    board.boundingBox(),
    pass.boundingBox(),
    redo.boundingBox(),
    undo.boundingBox(),
    newGame.boundingBox(),
  ]);

  expect(gameBox).not.toBeNull();
  expect(summaryBox).not.toBeNull();
  expect(boardBox).not.toBeNull();
  expect(passBox).not.toBeNull();
  expect(redoBox).not.toBeNull();
  expect(undoBox).not.toBeNull();
  expect(newGameBox).not.toBeNull();

  if (!gameBox || !summaryBox || !boardBox || !passBox || !redoBox || !undoBox || !newGameBox) return;

  expect(summaryBox.x).toBeLessThan(boardBox.x);
  expect(summaryBox.width / gameBox.width).toBeGreaterThan(0.16);
  expect(summaryBox.width / gameBox.width).toBeLessThan(0.27);

  expect(passBox.y).toBeLessThan(redoBox.y);
  expect(passBox.y).toBeLessThan(undoBox.y);
  expect(redoBox.x).toBeLessThan(undoBox.x);
  expect(passBox.width).toBeGreaterThan(redoBox.width * 1.8);
  expect(passBox.height).toBeCloseTo(redoBox.height, 0);
  expect(passBox.height).toBeCloseTo(undoBox.height, 0);
  expect(passBox.height).toBeCloseTo(newGameBox.height, 0);

  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();
  await page
    .locator('.torus-board__hit-target[data-logical-point-id="4,4"][data-copy-role="primary"]')
    .click();
  await expect(undo).toBeEnabled();

  const [undoBorder, redoBorder] = await Promise.all([
    undo.evaluate((element) => getComputedStyle(element).borderTopColor),
    redo.evaluate((element) => getComputedStyle(element).borderTopColor),
  ]);
  expect(undoBorder).toBe('rgba(203, 140, 50, 0.52)');
  expect(redoBorder).not.toBe(undoBorder);

  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(background).toBe('rgb(4, 9, 15)');
});
