import { expect, test } from '@playwright/test';

test('Torus keeps the system cursor and no persistent compositor hint', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Board size').selectOption('9');
  await page.getByRole('button', { name: 'Start game' }).click();

  const board = page.locator('.torus-board');
  await expect(board).toBeVisible();

  const state = await board.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      cursor: style.cursor,
      transform: style.transform,
      willChange: style.willChange,
    };
  });

  expect(state.cursor).not.toBe('none');
  expect(state.transform).toBe('none');
  expect(state.willChange).toBe('auto');
});
