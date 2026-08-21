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

test('first Pass is shown as Pass (1), uses no visible timer and a normal move resets it', async ({ page }) => {
  await startGame(page);

  const pass = page.getByRole('button', { name: /^Pass(?: \(1\))?$/ });
  await expect(pass).toHaveText('Pass');
  await pass.click();

  await expect(page.getByText('White to move')).toBeVisible();
  await expect(page.getByText('Passes 1')).toBeVisible();
  await expect(pass).toHaveText('Pass (1)');
  await expect(pass).toBeDisabled();
  await expect(page.getByRole('progressbar', { name: 'Pass cooldown' })).toHaveCount(0);
  await expect(page.getByText(/Previous pass:/)).toHaveCount(0);

  await clickPoint(page, '4,4');

  await expect(page.getByText('Black to move')).toBeVisible();
  await expect(page.getByText('Passes 0')).toBeVisible();
  await expect(pass).toHaveText('Pass');
  await expect(pass).toBeEnabled();
});

test('second Pass becomes available after about one second and Undo/Redo restores endgame', async ({ page }) => {
  await startGame(page);

  const pass = page.getByRole('button', { name: /^Pass(?: \(1\))?$/ });
  await pass.click();

  await expect(pass).toHaveText('Pass (1)');
  await expect(pass).toBeDisabled();
  await expect(pass).toBeEnabled({ timeout: 2200 });

  await pass.click();
  await expect(page.getByRole('heading', { name: 'Manual endgame classification' })).toBeVisible();

  const undo = page.getByRole('button', { name: 'Undo' });
  const redo = page.getByRole('button', { name: 'Redo' });
  await expect(undo).toBeEnabled();
  await expect(redo).toBeDisabled();

  await undo.click();
  await expect(page.getByText('White to move')).toBeVisible();
  await expect(page.getByText('Passes 1')).toBeVisible();
  await expect(pass).toHaveText('Pass (1)');
  await expect(pass).toBeEnabled();
  await expect(redo).toBeEnabled();

  await redo.click();
  await expect(page.getByRole('heading', { name: 'Manual endgame classification' })).toBeVisible();
  await expect(redo).toBeDisabled();
});