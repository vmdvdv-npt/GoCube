import { expect, test } from '@playwright/test';

test('Torus 2D exposes independent Move numbers and Show duplicate regions controls', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Board size').selectOption('9');
  await page.getByRole('button', { name: 'Start game' }).click();

  const moveNumbers = page.getByLabel('Move numbers', { exact: true });
  const duplicateRegions = page.getByLabel('Show duplicate regions', { exact: true });

  await expect(moveNumbers).toBeVisible();
  await expect(duplicateRegions).toBeVisible();
  await expect(moveNumbers).not.toBeChecked();
  await expect(duplicateRegions).not.toBeChecked();
  await expect(page.locator('.torus-board')).toHaveAttribute(
    'data-duplicate-regions-visible',
    'false',
  );

  await duplicateRegions.check();
  await expect(duplicateRegions).toBeChecked();
  await expect(moveNumbers).not.toBeChecked();
  await expect(page.locator('.torus-board')).toHaveAttribute(
    'data-duplicate-regions-visible',
    'true',
  );
  await expect(page.locator('.torus-board__edge-duplicates')).toHaveCount(1);

  await moveNumbers.check();
  await expect(moveNumbers).toBeChecked();
  await expect(duplicateRegions).toBeChecked();
});

test('Cube 2D exposes only the Move numbers display option', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cube', exact: true }).click();
  await page.getByRole('button', { name: 'Start game' }).click();

  const moveNumbers = page.getByLabel('Move numbers', { exact: true });
  await expect(moveNumbers).toBeVisible();
  await expect(moveNumbers).not.toBeChecked();
  await moveNumbers.check();
  await expect(moveNumbers).toBeChecked();
  await expect(page.getByLabel('Show duplicate regions', { exact: true })).toHaveCount(0);
});
