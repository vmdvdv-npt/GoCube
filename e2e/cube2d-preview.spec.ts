import { expect, test, type Locator, type Page } from '@playwright/test';

const waitForIdle = async (renderer: Locator) => {
  await expect(renderer).toHaveAttribute('data-animating', 'false', { timeout: 2_000 });
};

const expectCanonicalSlots = async (page: Page) => {
  const occupied = await page.locator('.cube-2d-board').evaluateAll((elements) =>
    elements.map((element) => [
      element.getAttribute('data-layout-row'),
      element.getAttribute('data-layout-column'),
    ]),
  );
  expect(occupied).toEqual([
    ['0', '1'],
    ['1', '0'],
    ['1', '1'],
    ['1', '2'],
    ['1', '3'],
    ['2', '1'],
  ]);
};

test('Cube 2D navigation keeps six physical faces in the fixed canonical cross', async ({ page }) => {
  await page.goto('/?cube2d-preview=1');

  await expect(page.getByRole('heading', { name: 'Cube 2D visual completion' })).toBeVisible();
  await expect(page.getByText('occupied boards: 6')).toBeVisible();
  await expect(page.getByText('empty slots: 6')).toBeVisible();

  const renderer = page.locator('.cube-2d-renderer');
  const boards = page.locator('.cube-2d-board');
  await expect(renderer).toHaveAttribute('data-layout-rows', '3');
  await expect(renderer).toHaveAttribute('data-layout-columns', '4');
  await expect(renderer).toHaveAttribute('data-board-count', '6');
  await expect(renderer).not.toHaveAttribute('data-vertical-anchor-column', /.+/);
  await expect(renderer).toHaveAttribute('data-gameplay-input-disabled', 'false');
  await waitForIdle(renderer);
  await expect(boards).toHaveCount(6);
  await expect(page.locator('.cube-2d-anchor-slot')).toHaveCount(0);
  expect(
    new Set(
      await boards.evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('data-face')),
      ),
    ).size,
  ).toBe(6);
  expect(
    await boards.evaluateAll((elements) =>
      elements.some((element) => element.hasAttribute('data-duplicate')),
    ),
  ).toBe(false);
  await expectCanonicalSlots(page);

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

  const [topBox, leftBox, centerBox, rightBox, backBox, bottomBox] = await Promise.all(
    [top, left, central, right, back, bottom].map((locator) => locator.boundingBox()),
  );
  expect(topBox && leftBox && centerBox && rightBox && backBox && bottomBox).toBeTruthy();
  expect(Math.abs(leftBox!.x + leftBox!.width - centerBox!.x)).toBeLessThan(0.5);
  expect(Math.abs(centerBox!.x + centerBox!.width - rightBox!.x)).toBeLessThan(0.5);
  expect(Math.abs(rightBox!.x + rightBox!.width - backBox!.x)).toBeLessThan(0.5);
  expect(Math.abs(topBox!.y + topBox!.height - centerBox!.y)).toBeLessThan(0.5);
  expect(Math.abs(centerBox!.y + centerBox!.height - bottomBox!.y)).toBeLessThan(0.5);
  expect(Math.abs(topBox!.x - centerBox!.x)).toBeLessThan(0.5);
  expect(Math.abs(bottomBox!.x - centerBox!.x)).toBeLessThan(0.5);

  await page.getByRole('button', { name: 'Move cube left' }).click();
  await expect(renderer).toHaveAttribute('data-animating', 'true');
  await waitForIdle(renderer);
  await expect(page.locator('.cube-2d-board[data-central="true"]')).toHaveAttribute('data-face', 'left');
  await expectCanonicalSlots(page);
  await expect(page.locator('.cube-2d-anchor-slot')).toHaveCount(0);

  await page.getByRole('button', { name: 'Move cube right' }).click();
  await waitForIdle(renderer);
  await expect(page.locator('.cube-2d-board[data-central="true"]')).toHaveAttribute('data-face', 'front');

  await page.getByRole('button', { name: 'Move cube up' }).click();
  await waitForIdle(renderer);
  await expect(page.locator('.cube-2d-board[data-central="true"]')).toHaveAttribute('data-face', 'top');
  await expectCanonicalSlots(page);

  await page.getByRole('button', { name: 'Move cube down' }).click();
  await waitForIdle(renderer);
  await expect(page.locator('.cube-2d-board[data-central="true"]')).toHaveAttribute('data-face', 'front');

  await page.getByLabel('Cube size').selectOption('5');
  const resizedCentral = page.locator('.cube-2d-board[data-central="true"]');
  await expect(resizedCentral.locator('line')).toHaveCount(10);
  await expect(resizedCentral.locator('.cube-2d-hit-area')).toHaveCount(25);
  await expect(page.getByText('logical points: 150')).toBeVisible();
  await expect(boards).toHaveCount(6);
  await expectCanonicalSlots(page);
});

test('Cube 2D preview supports hover, moves and navigation without anchor state', async ({ page }) => {
  await page.goto('/?cube2d-preview=1');

  const renderer = page.locator('.cube-2d-renderer');
  const target = page.locator('.cube-2d-hit-area[data-point-id="front:1:1"]');
  await expect(target).toHaveCount(1);

  await target.hover();
  const preview = page.locator('.cube-2d-preview-stone[data-logical-point-id="front:1:1"]');
  await expect(preview).toHaveCount(1);
  expect(Number(await preview.evaluate((element) => getComputedStyle(element).opacity))).toBeCloseTo(0.5, 1);

  await target.click();
  const blackStone = page.locator(
    '.cube-2d-stone[data-logical-point-id="front:1:1"][data-occupancy="black"]',
  );
  await expect(blackStone).toHaveCount(1);
  await expect(
    page.locator('.cube-2d-last-move-marker[data-logical-point-id="front:1:1"]'),
  ).toHaveCount(1);
  await expect(page.getByText('player: white')).toBeVisible();
  await expect(page.getByText('move: 1')).toBeVisible();

  await page.getByRole('button', { name: 'Move cube right' }).click();
  await expect(renderer).toHaveAttribute('data-gameplay-input-disabled', 'true');
  await waitForIdle(renderer);
  await expect(page.locator('.cube-2d-board')).toHaveCount(6);
  await expect(blackStone).toHaveCount(1);
  await expect(
    page.locator(
      '.cube-2d-board[data-face="front"] .cube-2d-stone[data-logical-point-id="front:1:1"]',
    ),
  ).toHaveCount(1);
  await expect(page.locator('.cube-2d-anchor-slot')).toHaveCount(0);
  expect(await page.locator('[data-duplicate]').count()).toBe(0);

  await page.getByRole('button', { name: 'Move numbers' }).click();
  const second = page.locator('.cube-2d-hit-area[data-point-id="right:1:1"]');
  await second.click();
  await expect(
    page.locator('.cube-2d-stone[data-logical-point-id="right:1:1"][data-occupancy="white"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('.cube-2d-move-number[data-logical-point-id="front:1:1"]'),
  ).toHaveText('1');
  await expect(
    page.locator('.cube-2d-last-move-marker[data-logical-point-id="right:1:1"]'),
  ).toHaveCount(1);
});
