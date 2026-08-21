import { expect, test } from '@playwright/test';

test('new game uses board-size buttons and keeps Japanese rules as the default', async ({ page }) => {
  await page.goto('/');

  const sizes = page.locator('.board-size-options');
  const size9 = sizes.getByRole('button', { name: '9×9', exact: true });
  const size13 = sizes.getByRole('button', { name: '13×13', exact: true });
  const size19 = sizes.getByRole('button', { name: '19×19', exact: true });
  await expect(size9).toBeVisible();
  await expect(size13).toBeVisible();
  await expect(size19).toBeVisible();
  await expect(size9).toHaveAttribute('aria-pressed', 'true');

  const [size9Box, size13Box, size19Box] = await Promise.all([
    size9.boundingBox(),
    size13.boundingBox(),
    size19.boundingBox(),
  ]);
  expect(size9Box).not.toBeNull();
  expect(size13Box).not.toBeNull();
  expect(size19Box).not.toBeNull();
  if (size9Box && size13Box && size19Box) {
    expect(size9Box.y).toBeCloseTo(size13Box.y, 0);
    expect(size13Box.y).toBeCloseTo(size19Box.y, 0);
    expect(size9Box.x).toBeLessThan(size13Box.x);
    expect(size13Box.x).toBeLessThan(size19Box.x);
  }

  await size13.click();
  await expect(size13).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Board size')).toHaveValue('13');

  const rules = page.getByLabel('Rules');
  await expect(rules.locator('option')).toHaveText(['Japanese', 'Chinese']);
  await expect(rules).toHaveValue('japanese');

  const startGame = page.getByRole('button', { name: 'Start game' });
  const startBackground = await startGame.evaluate((element) => getComputedStyle(element).backgroundImage);
  expect(startBackground).toContain('rgb(22, 122, 73)');

  await rules.selectOption('chinese');
  await startGame.click();
  await expect(page.getByText('Chinese rules')).toBeVisible();
  await expect(page.getByText('13×13', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'New game', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Start a new game?' })).toBeVisible();
  await page.getByRole('button', { name: 'New Game', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'New game' })).toBeVisible();
  await expect(page.getByLabel('Rules').locator('option')).toHaveText(['Japanese', 'Chinese']);
  await expect(page.getByLabel('Rules')).toHaveValue('japanese');
});
