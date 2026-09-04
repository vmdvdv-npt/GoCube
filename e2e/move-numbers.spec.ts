import { expect, test, type Locator, type Page } from '@playwright/test';

const point = (page: Page, logicalPointId: string): Locator =>
  page.locator(
    `.torus-board__hit-target[data-logical-point-id="${logicalPointId}"][data-copy-role="primary"]`,
  ).first();

const startGame = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.getByLabel('Board size').selectOption('9');
  await page.getByRole('button', { name: 'Start game' }).click();
};

const marker = (page: Page, logicalPointId: string): Locator =>
  page.locator(
    `.torus-board__last-move-marker[data-logical-point-id="${logicalPointId}"]`,
  );

const moveNumber = (page: Page, logicalPointId: string): Locator =>
  page.locator(`.torus-board__move-number[data-logical-point-id="${logicalPointId}"]`);

test('last stone keeps a contrast dot while move numbers preserve pass gaps', async ({ page }) => {
  await startGame(page);

  await point(page, '0,0').click();
  await expect(marker(page, '0,0')).toHaveCount(1);
  await expect(marker(page, '0,0')).toHaveAttribute('fill', '#ffffff');

  await point(page, '1,0').click();
  await expect(marker(page, '0,0')).toHaveCount(0);
  await expect(marker(page, '1,0')).toHaveCount(1);
  await expect(marker(page, '1,0')).toHaveAttribute('fill', '#111111');

  const toggle = page.getByLabel('Show move number');
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(toggle).toBeChecked();
  await expect(moveNumber(page, '0,0')).toHaveText('1');
  await expect(moveNumber(page, '1,0')).toHaveCount(0);
  await expect(marker(page, '1,0')).toHaveCount(1);

  // Action 3 is a pass, so the next placed stone must be numbered 4.
  await page.getByRole('button', { name: 'Pass', exact: true }).click();
  await expect(marker(page, '1,0')).toHaveCount(1);
  await point(page, '2,0').click();

  await expect(moveNumber(page, '0,0')).toHaveText('1');
  await expect(moveNumber(page, '1,0')).toHaveText('2');
  await expect(page.locator('.torus-board__move-number[data-move-number="3"]')).toHaveCount(0);
  await expect(marker(page, '2,0')).toHaveCount(1);
  await expect(moveNumber(page, '2,0')).toHaveCount(0);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(marker(page, '1,0')).toHaveCount(1);
  await expect(moveNumber(page, '1,0')).toHaveCount(0);
});

test('move annotations survive smooth torus pan without duplicate-region UI', async ({ page }) => {
  await startGame(page);
  await point(page, '0,0').click();
  await point(page, '1,0').click();
  await page.getByLabel('Show move number').check();

  await expect(moveNumber(page, '0,0')).toHaveText('1');
  await expect(marker(page, '1,0')).toHaveCount(1);
  await expect(page.getByText(/duplicate regions/i)).toHaveCount(0);

  await page.getByRole('button', { name: 'Shift torus view right' }).click();
  await expect(page.locator('.torus-board')).toHaveAttribute('data-pan-animating', 'true');
  await expect(marker(page, '1,0')).not.toHaveCount(0);
  await expect(page.locator('.torus-board')).toHaveAttribute('data-pan-animating', 'false');
  await expect(moveNumber(page, '0,0')).not.toHaveCount(0);
  await expect(marker(page, '1,0')).not.toHaveCount(0);
});
