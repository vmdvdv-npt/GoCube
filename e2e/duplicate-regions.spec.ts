import { expect, test } from '@playwright/test';

test('duplicate torus regions are opt-in and add four wrapped rows and columns per side', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Board size').selectOption('9');
  await page.getByRole('button', { name: 'Start game' }).click();

  const board = page.locator('.torus-board');
  const toggle = page.getByLabel('Показывать дублирующие области');

  await expect(toggle).not.toBeChecked();
  await expect(board).toHaveAttribute('data-duplicate-regions-visible', 'false');
  await expect(page.locator('.torus-board__hit-target[data-copy-role="primary"]')).toHaveCount(81);
  await expect(page.locator('.torus-board__hit-target[data-copy-role="duplicate"]')).toHaveCount(0);
  await expect(page.locator('.torus-board__grid line')).toHaveCount(18);

  await toggle.check();

  await expect(board).toHaveAttribute('data-duplicate-regions-visible', 'true');
  await expect(page.locator('.torus-board__hit-target[data-copy-role="primary"]')).toHaveCount(81);
  await expect(page.locator('.torus-board__hit-target[data-copy-role="duplicate"]')).toHaveCount(208);
  await expect(page.locator('.torus-board__grid line')).toHaveCount(34);

  await toggle.uncheck();

  await expect(board).toHaveAttribute('data-duplicate-regions-visible', 'false');
  await expect(page.locator('.torus-board__hit-target[data-copy-role="duplicate"]')).toHaveCount(0);
  await expect(page.locator('.torus-board__grid line')).toHaveCount(18);
});
