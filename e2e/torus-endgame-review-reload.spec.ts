import { expect, test } from '@playwright/test';

test('Torus 2D restores a partially classified endgame review after reload', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Board size').selectOption('9');
  await page.getByRole('button', { name: 'Start game' }).click();

  await page.locator(
    '.torus-board__hit-target[data-logical-point-id="0,0"][data-copy-role="primary"]',
  ).click();
  await expect(page.getByText('White to move')).toBeVisible();

  await page.getByRole('button', { name: 'Pass' }).click();
  await page.waitForTimeout(1050);
  await page.getByRole('button', { name: 'Pass (1)' }).click();
  await expect(page.getByRole('heading', { name: 'Manual endgame classification' })).toBeVisible();

  await page.locator(
    '.torus-board__stone[data-logical-point-id="0,0"][data-copy-role="primary"]',
  ).click();
  await page.getByRole('button', { name: 'Alive' }).click();
  await expect(page.locator('.endgame-progress')).toHaveText('Classified 1 of 1');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Continue saved game?' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: 'Manual endgame classification' })).toBeVisible();
  await expect(page.locator('.endgame-progress')).toHaveText('Classified 1 of 1');
  await expect(page.getByRole('button', { name: 'Alive' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Calculate final score' })).toBeEnabled();

  await page.getByRole('button', { name: 'Calculate final score' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});
