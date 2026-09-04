import { expect, test } from '@playwright/test';

test('legacy duplicate-region preference does not leak into the main Torus UI', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.setItem(
      'gocube:preferences',
      JSON.stringify({ version: 1, showTorusDuplicateRegions: true }),
    );
  });
  await page.reload();

  await page.getByLabel('Board size').selectOption('9');
  await page.getByRole('button', { name: 'Start game' }).click();

  await expect(page.getByLabel('Show move number')).toBeVisible();
  await expect(page.getByText(/duplicate regions/i)).toHaveCount(0);
  await expect(page.getByText('Показывать дублирующие области')).toHaveCount(0);
  await expect(page.locator('.torus-board')).toHaveAttribute(
    'data-duplicate-regions-visible',
    'false',
  );
  await expect(page.locator('.torus-board__edge-duplicates')).toHaveCount(0);

  await page.getByRole('button', { name: 'New game', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Start a new game?' })).toBeVisible();
  await page.getByRole('button', { name: 'New Game', exact: true }).click();
  await expect(page.getByTestId('new-game-settings-grid')).toBeVisible();
  await page.getByRole('button', { name: 'Start game' }).click();

  await expect(page.locator('.torus-game')).toBeVisible();
  await expect(page.getByLabel('Show move number')).toBeVisible();
  await expect(page.getByText(/duplicate regions/i)).toHaveCount(0);
  await expect(page.locator('.torus-board')).toHaveAttribute(
    'data-duplicate-regions-visible',
    'false',
  );
  await expect(page.locator('.torus-board__edge-duplicates')).toHaveCount(0);
});
