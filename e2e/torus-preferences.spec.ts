import { expect, test } from '@playwright/test';

test('Torus duplicate-region preference is remembered for the next Torus game', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Board size').selectOption('9');
  await page.getByRole('button', { name: 'Start game' }).click();

  const duplicates = page.getByLabel('Показывать дублирующие области');
  await duplicates.check();
  await expect(duplicates).toBeChecked();
  await expect(page.locator('.torus-board')).toHaveAttribute(
    'data-duplicate-regions-visible',
    'true',
  );
  await page.waitForFunction(() => {
    const raw = window.localStorage.getItem('gocube:preferences');
    if (!raw) return false;
    return JSON.parse(raw).showTorusDuplicateRegions === true;
  });

  await page.getByRole('button', { name: 'New game', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Start a new game?' })).toBeVisible();
  await page.getByRole('button', { name: 'New Game', exact: true }).click();
  await expect(page.getByTestId('new-game-settings-grid')).toBeVisible();
  await page.getByRole('button', { name: 'Start game' }).click();

  await expect(page.locator('.torus-game')).toBeVisible();
  await expect(page.getByLabel('Показывать дублирующие области')).toBeChecked();
  await expect(page.locator('.torus-board')).toHaveAttribute(
    'data-duplicate-regions-visible',
    'true',
  );
});
