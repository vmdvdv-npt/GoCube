import { expect, test } from '@playwright/test';

test('Show duplicate regions persists between Torus games while Move numbers stays game-local', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Komi')).toHaveValue('0.5');
  await page.getByLabel('Board size').selectOption('9');
  await page.getByRole('button', { name: 'Start game' }).click();

  const moveNumbers = page.getByLabel('Move numbers', { exact: true });
  const duplicateRegions = page.getByLabel('Show duplicate regions', { exact: true });
  await expect(moveNumbers).not.toBeChecked();
  await expect(duplicateRegions).not.toBeChecked();

  await duplicateRegions.check();
  await expect(duplicateRegions).toBeChecked();
  await expect(page.locator('.torus-board')).toHaveAttribute(
    'data-duplicate-regions-visible',
    'true',
  );
  await expect(page.locator('.torus-board__edge-duplicates')).toHaveCount(1);

  const storedDuplicatePreference = await page.evaluate(() => {
    const raw = localStorage.getItem('gocube:preferences');
    if (!raw) return null;
    return (JSON.parse(raw) as { showTorusDuplicateRegions?: unknown }).showTorusDuplicateRegions;
  });
  expect(storedDuplicatePreference).toBe(true);

  await moveNumbers.check();
  await expect(moveNumbers).toBeChecked();

  await page.getByRole('button', { name: 'New game', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Start a new game?' })).toBeVisible();
  await page.getByRole('button', { name: 'New Game', exact: true }).click();
  await expect(page.getByTestId('new-game-settings-grid')).toBeVisible();
  await page.getByRole('button', { name: 'Start game' }).click();

  await expect(page.locator('.torus-game')).toBeVisible();
  await expect(page.getByLabel('Move numbers', { exact: true })).not.toBeChecked();
  await expect(page.getByLabel('Show duplicate regions', { exact: true })).toBeChecked();
  await expect(page.locator('.torus-board')).toHaveAttribute(
    'data-duplicate-regions-visible',
    'true',
  );
  await expect(page.locator('.torus-board__edge-duplicates')).toHaveCount(1);
});
