import { expect, test, type Page } from '@playwright/test';

const startGame = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.getByLabel('Board size').selectOption('9');
  await page.getByLabel('Rules').selectOption('chinese');
  await page.getByLabel('Komi').fill('7.5');
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('.torus-game')).toBeVisible();
};

const clickPoint = async (page: Page, logicalPointId: string): Promise<void> => {
  await page
    .locator(
      `.torus-board__hit-target[data-logical-point-id="${logicalPointId}"][data-copy-role="primary"]`,
    )
    .click();
};

test('first Pass starts a three-second UI guard while board play remains available', async ({ page }) => {
  await startGame(page);

  const pass = page.getByRole('button', { name: 'Pass' });
  await pass.click();

  await expect(page.getByText('White to move')).toBeVisible();
  await expect(page.getByText('Passes 1')).toBeVisible();
  await expect(page.getByText('Previous pass: Black')).toBeVisible();
  await expect(pass).toBeDisabled();
  await expect(page.getByRole('progressbar', { name: 'Pass cooldown' })).toBeVisible();

  await clickPoint(page, '4,4');

  await expect(page.getByText('Black to move')).toBeVisible();
  await expect(page.getByText('Passes 0')).toBeVisible();
  await expect(page.getByText('Previous pass: Black')).toHaveCount(0);
  await expect(page.getByRole('progressbar', { name: 'Pass cooldown' })).toHaveCount(0);
  await expect(pass).toBeEnabled();
});

test('second Pass unlocks after the guard and Undo of endgame does not restore the guard', async ({ page }) => {
  await startGame(page);

  const pass = page.getByRole('button', { name: 'Pass' });
  await pass.click();

  await expect(pass).toBeDisabled();
  await expect(page.getByRole('progressbar', { name: 'Pass cooldown' })).toBeVisible();
  await expect(pass).toBeEnabled({ timeout: 4000 });
  await expect(page.getByRole('progressbar', { name: 'Pass cooldown' })).toHaveCount(0);
  await expect(page.getByText('Previous pass: Black')).toBeVisible();

  await pass.click();
  await expect(page.getByRole('heading', { name: 'Manual endgame classification' })).toBeVisible();

  await page.getByRole('button', { name: 'Undo' }).click();

  await expect(page.getByText('White to move')).toBeVisible();
  await expect(page.getByText('Passes 1')).toBeVisible();
  await expect(page.getByText('Previous pass: Black')).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Pass cooldown' })).toHaveCount(0);
  await expect(pass).toBeEnabled();

  await pass.click();
  await expect(page.getByRole('heading', { name: 'Manual endgame classification' })).toBeVisible();
});
