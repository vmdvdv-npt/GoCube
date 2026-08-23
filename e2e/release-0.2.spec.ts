import { expect, test, type Locator, type Page } from '@playwright/test';

const hit = (page: Page, pointId: string) =>
  page.locator(`.cube-2d-hit-area[data-point-id="${pointId}"]`);

const stone = (page: Page, pointId: string) =>
  page.locator(`.cube-2d-stone[data-logical-point-id="${pointId}"]`);

const expectSixBoards = async (page: Page) => {
  await expect(page.locator('.cube-2d-board')).toHaveCount(6);
  await expect(page.locator('.cube-2d-renderer')).toHaveAttribute('data-board-count', '6');
  await expect(page.locator('.cube-2d-board__diagnostic')).toHaveCount(0);
};

const requiredBox = async (locator: Locator) => {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
};

const expectNear = (actual: number, expected: number, tolerance = 1) => {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
};

const expectNavigationAnchored = async (page: Page) => {
  const leftBoard = await requiredBox(
    page.locator('.cube-2d-board[data-layout-row="1"][data-layout-column="0"]'),
  );
  const rightBoard = await requiredBox(
    page.locator('.cube-2d-board[data-layout-row="1"][data-layout-column="3"]'),
  );
  const topBoard = await requiredBox(page.locator('.cube-2d-board[data-layout-row="0"]'));
  const bottomBoard = await requiredBox(page.locator('.cube-2d-board[data-layout-row="2"]'));
  const leftArrow = await requiredBox(page.getByRole('button', { name: 'Move cube left' }));
  const rightArrow = await requiredBox(page.getByRole('button', { name: 'Move cube right' }));
  const upArrow = await requiredBox(page.getByRole('button', { name: 'Move cube up' }));
  const downArrow = await requiredBox(page.getByRole('button', { name: 'Move cube down' }));

  expectNear(leftBoard.x - (leftArrow.x + leftArrow.width), 30);
  expectNear(leftArrow.y + leftArrow.height / 2, leftBoard.y + leftBoard.height / 2);

  expectNear(rightArrow.x - (rightBoard.x + rightBoard.width), 30);
  expectNear(rightArrow.y + rightArrow.height / 2, rightBoard.y + rightBoard.height / 2);

  expectNear(topBoard.y - (upArrow.y + upArrow.height), 30);
  expectNear(upArrow.x + upArrow.width / 2, topBoard.x + topBoard.width / 2);

  expectNear(downArrow.y - (bottomBoard.y + bottomBoard.height), 30);
  expectNear(downArrow.x + downArrow.width / 2, bottomBoard.x + bottomBoard.width / 2);
};

test('Cube 2D navigation arrows stay anchored to face edges through anchor movement and zoom', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cube', exact: true }).click();
  await page.getByRole('button', { name: '4×4', exact: true }).click();
  await page.getByRole('button', { name: 'Start game' }).click();

  const renderer = page.locator('.cube-2d-renderer');
  const navigationLayer = page.locator('.cube-2d-game__navigation-layer');
  await expect(navigationLayer).toHaveAttribute('data-navigation-gap', '30');
  await expectNavigationAnchored(page);

  await page
    .getByRole('button', { name: 'Move top and bottom to column 4 using top slot' })
    .click();
  await expect(renderer).toHaveAttribute('data-animating', 'true');
  await expect(renderer).toHaveAttribute('data-animating', 'false', { timeout: 1000 });
  await expect(renderer).toHaveAttribute('data-vertical-anchor-column', '3');
  await expect(navigationLayer).toHaveAttribute('data-vertical-anchor-column', '3');
  await expectNavigationAnchored(page);

  const cubeViewport = page.locator('.cube-2d-game__viewport');
  await cubeViewport.hover();
  await page.mouse.wheel(0, -250);
  await expect(cubeViewport).toHaveAttribute('data-view-zoom', '1.200');
  await expectNavigationAnchored(page);
});

test('0.2 production Cube flow: New Game, seam capture, history, zoom, resume and endgame', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await page.goto('/');
  await page.getByRole('button', { name: 'Cube', exact: true }).click();
  await page.getByRole('button', { name: '4×4', exact: true }).click();
  await page.getByLabel('Rules').selectOption('japanese');
  await page.getByLabel('Komi').fill('7.5');
  await page.getByRole('button', { name: 'Start game' }).click();

  await expect(page.locator('.cube-2d-game .game-summary')).toBeVisible();
  await expect(page.locator('.cube-2d-game .game-statistics')).toContainText('4×4');
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

  const cubeViewport = page.locator('.cube-2d-game__viewport');
  await expect(cubeViewport).toHaveAttribute('data-view-zoom', '1.000');
  await cubeViewport.hover();
  await page.mouse.wheel(0, -250);
  await expect(cubeViewport).not.toHaveAttribute('data-view-zoom', '1.000');
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
  await expect(page.getByRole('heading', { name: 'Assisted endgame review' })).toBeVisible();

  const progress = page.locator('.endgame-progress');
  const progressText = (await progress.textContent()) ?? '';
  const totalMatch = progressText.match(/Manual review 0 of (\d+)/);
  expect(totalMatch).not.toBeNull();
  const manualTotal = Number(totalMatch![1]);
  expect(manualTotal).toBeGreaterThan(1);

  // Acceptance checkpoint: persist a partial assisted review, reload before scoring,
  // and require Continue to restore the already reviewed group and next selection.
  const statuses = page.getByRole('group', { name: 'Selected group status' });
  await statuses.getByRole('button', { name: 'Alive' }).click();
  await expect(progress).toContainText(`Manual review 1 of ${manualTotal}`);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Continue saved game?' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Assisted endgame review' })).toBeVisible();
  await expect(page.locator('.endgame-progress')).toContainText(`Manual review 1 of ${manualTotal}`);

  for (let reviewed = 1; reviewed < manualTotal; reviewed += 1) {
    await page
      .getByRole('group', { name: 'Selected group status' })
      .getByRole('button', { name: 'Alive' })
      .click();
  }

  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('Japanese scoring')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Calculate final score' })).toHaveCount(0);
  await expectSixBoards(page);

  await page.getByRole('button', { name: 'Close game result' }).click();
  await expect(page.getByRole('button', { name: 'Game result' })).toBeVisible();
  await expect(page.locator('.cube-2d-renderer')).toHaveAttribute('data-gameplay-input-disabled', 'true');
  await expectSixBoards(page);
  expect(pageErrors).toEqual([]);
});
