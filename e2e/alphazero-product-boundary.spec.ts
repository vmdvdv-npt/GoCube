import { expect, test } from '@playwright/test';

test('representative verified empty boundary reaches the GoCube final result', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cube', exact: true }).click();
  await page.getByLabel('Rules').selectOption('japanese');
  await page.getByLabel('Komi').fill('0.5');
  await page.getByRole('button', { name: 'Start game' }).click();

  const pass = page.getByRole('button', { name: /^Pass(?: \(1\))?$/ });
  await pass.click();
  await expect(pass).toBeEnabled({ timeout: 2_200 });
  await pass.click();

  await expect(page.getByRole('heading', { name: 'Assisted endgame review' })).toBeVisible();
  await expect(page.getByText('There are no stone groups to review.')).toBeVisible();
  await page.getByRole('button', { name: 'Finish scoring' }).click();

  const result = page.getByRole('dialog');
  await expect(result).toBeVisible();
  await expect(result.getByRole('heading', { name: 'White wins by 0.5' })).toBeVisible();
  await expect(result.getByText('Japanese', { exact: true })).toBeVisible();
  await expect(result.getByText('4×4', { exact: true })).toBeVisible();
});
