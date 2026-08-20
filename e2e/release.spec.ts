import { expect, test, type Page } from '@playwright/test';

type StartOptions = Readonly<{
  size: '9' | '13' | '19';
  rules: 'chinese' | 'japanese';
  komi: string;
}>;

const startGame = async (page: Page, options: StartOptions): Promise<void> => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'New game' })).toBeVisible();
  await page.getByLabel('Board size').selectOption(options.size);
  await page.getByLabel('Rules').selectOption(options.rules);
  await page.getByLabel('Komi').fill(options.komi);
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('.torus-game')).toBeVisible();
};

test('new game exposes every supported 0.1 torus size', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'New game' })).toBeVisible();
  await expect(page.getByLabel('Board size').locator('option')).toHaveText([
    '9×9',
    '13×13',
    '19×19',
  ]);
});

test('board input, persistence and restore work through the browser UI', async ({ page }) => {
  await startGame(page, { size: '19', rules: 'japanese', komi: '5.5' });

  const board = page.getByRole('img', { name: '19 by 19 repeating torus Go board' });
  await expect(board).toBeVisible();
  await board.click();

  await expect(page.getByText('White to move')).toBeVisible();
  await expect(page.getByText('Move 1')).toBeVisible();

  await board.click();
  await expect(page.getByText('That point is occupied.')).toBeVisible();
  await expect(page.getByText('White to move')).toBeVisible();
  await expect(page.getByText('Move 1')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Continue saved game?' })).toBeVisible();
  await expect(page.getByText(/19×19 · Japanese · Komi 5\.5 · Move 1/)).toBeVisible();

  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('White to move')).toBeVisible();
  await expect(page.getByText('19×19')).toBeVisible();
  await expect(page.getByText('Japanese rules')).toBeVisible();
  await expect(page.getByText('Komi 5.5')).toBeVisible();
});

test('Chinese game reaches result, can reopen it, and Undo restores play', async ({ page }) => {
  await startGame(page, { size: '9', rules: 'chinese', komi: '7.5' });

  await page.getByRole('button', { name: 'Pass' }).click();
  await expect(page.getByText('White to move')).toBeVisible();
  await page.getByRole('button', { name: 'Pass' }).click();

  await expect(page.getByRole('heading', { name: 'Manual endgame classification' })).toBeVisible();
  await expect(page.getByText('There are no stone groups to classify.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('White to move')).toBeVisible();
  await expect(page.getByText('Move 1')).toBeVisible();
  await expect(page.getByText('Passes 1')).toBeVisible();

  await page.getByRole('button', { name: 'Pass' }).click();
  await expect(page.getByRole('heading', { name: 'Manual endgame classification' })).toBeVisible();
  await page.getByRole('button', { name: 'Calculate final score' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'White wins by 7.5' })).toBeVisible();
  await expect(dialog.getByRole('cell', { name: 'Area subtotal' })).toBeVisible();
  await expect(dialog.getByText('Chinese', { exact: true })).toBeVisible();

  await dialog.getByRole('button', { name: 'Close game result' }).click();
  await expect(page.getByRole('button', { name: 'Game result' })).toBeVisible();
  await page.getByRole('button', { name: 'Game result' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close game result' }).click();

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('White to move')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Game result' })).toHaveCount(0);
});

test('Japanese scoring completes with the selected board size and komi', async ({ page }) => {
  await startGame(page, { size: '13', rules: 'japanese', komi: '6.5' });

  await page.getByRole('button', { name: 'Pass' }).click();
  await page.getByRole('button', { name: 'Pass' }).click();
  await page.getByRole('button', { name: 'Calculate final score' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'White wins by 6.5' })).toBeVisible();
  await expect(dialog.getByRole('cell', { name: 'Prisoners' })).toBeVisible();
  await expect(dialog.getByText('13×13', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Japanese', { exact: true })).toBeVisible();
});

test('corrupted local save is discarded without blocking startup', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('gocube:game:current', '{broken-json');
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'New game' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('gocube:game:current'))).toBeNull();
});
