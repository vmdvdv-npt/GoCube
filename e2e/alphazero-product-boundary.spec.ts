import { expect, test } from '@playwright/test';

test('representative verified boundary reviews a real group before the GoCube final result', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cube', exact: true }).click();
  await page.getByRole('button', { name: '4×4', exact: true }).click();
  await page.getByLabel('Rules').selectOption('japanese');
  await page.getByLabel('Komi').fill('0.5');
  await page.getByRole('button', { name: 'Start game' }).click();

  await page.locator('.cube-2d-hit-area[data-point-id="front:1:1"]').click();
  const pass = page.getByRole('button', { name: /^Pass(?: \(1\))?$/ });
  await pass.click();
  await expect(pass).toBeEnabled({ timeout: 2_200 });
  await pass.click();

  await expect(page.getByRole('heading', { name: 'Assisted endgame review' })).toBeVisible();
  await expect(page.locator('.endgame-progress')).toHaveText('Resolved 0 of 1');
  await expect(page.getByText('There are no stone groups to review.')).toHaveCount(0);
  await page.locator('.cube-2d-hit-area[data-point-id="front:1:1"]').click();
  await page.getByRole('group', { name: 'Selected group status' })
    .getByRole('button', { name: 'Alive', exact: true })
    .click();
  await page.getByRole('button', { name: 'Finish scoring' }).click();

  const result = page.getByRole('dialog');
  await expect(result).toBeVisible();
  await expect(result.getByText('Japanese', { exact: true })).toBeVisible();
  await expect(result.getByText('4×4', { exact: true })).toBeVisible();
});
