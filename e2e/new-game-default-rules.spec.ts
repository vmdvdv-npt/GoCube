import { expect, test } from '@playwright/test';

test('Japanese rules are first and selected by default for every new game', async ({ page }) => {
  await page.goto('/');

  const rules = page.getByLabel('Rules');
  await expect(rules.locator('option')).toHaveText(['Japanese', 'Chinese']);
  await expect(rules).toHaveValue('japanese');

  await rules.selectOption('chinese');
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.getByText('Chinese rules')).toBeVisible();

  await page.getByRole('button', { name: 'New game', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Start a new game?' })).toBeVisible();
  await page.getByRole('button', { name: 'New Game', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'New game' })).toBeVisible();
  await expect(page.getByLabel('Rules').locator('option')).toHaveText(['Japanese', 'Chinese']);
  await expect(page.getByLabel('Rules')).toHaveValue('japanese');
});
