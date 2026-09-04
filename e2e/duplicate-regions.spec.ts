import { expect, test } from '@playwright/test';

test('main Torus UI hides duplicate regions and keeps Show move number', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.setItem(
      'gocube:preferences',
      JSON.stringify({ version: 1, showTorusDuplicateRegions: true }),
    );
  });
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
});

test('Cube 2D exposes only the move-number display option', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cube', exact: true }).click();
  await page.getByRole('button', { name: 'Start game' }).click();

  const moveNumbers = page.getByLabel('Show move number');
  await expect(moveNumbers).toBeVisible();
  await expect(moveNumbers).not.toBeChecked();
  await moveNumbers.check();
  await expect(moveNumbers).toBeChecked();
  await expect(page.getByText(/duplicate regions/i)).toHaveCount(0);
  await expect(page.getByText('Показывать дублирующие области')).toHaveCount(0);
});
