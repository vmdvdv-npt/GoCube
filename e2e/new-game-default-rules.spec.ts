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
  await page.mouse.move(0, 0);
  const selectedBackground = await size13.evaluate((element) => getComputedStyle(element).backgroundImage);
  expect(selectedBackground).toContain('rgb(52, 66, 79)');

  const idleBackground = await size19.evaluate((element) => getComputedStyle(element).backgroundImage);
  await size19.hover();
  const hoverBackground = await size19.evaluate((element) => getComputedStyle(element).backgroundImage);
  expect(hoverBackground).not.toBe(idleBackground);
  expect(hoverBackground).toContain('rgb(39, 53, 66)');

  const rules = page.getByLabel('Rules');
  await expect(rules.locator('option')).toHaveText(['Japanese', 'Chinese']);
  await expect(rules).toHaveValue('japanese');

  const startGame = page.getByRole('button', { name: 'Start game' });
  const startBackground = await startGame.evaluate((element) => getComputedStyle(element).backgroundImage);
  expect(startBackground).toContain('rgb(7, 49, 58)');

  await rules.selectOption('chinese');
  await startGame.click();
  await expect(page.getByText('Chinese rules')).toBeVisible();
  await expect(page.getByText('13×13', { exact: true })).toBeVisible();

  const inGameNewGame = page.getByRole('button', { name: 'New game', exact: true });
  const inGameBackground = await inGameNewGame.evaluate((element) => getComputedStyle(element).backgroundImage);
  expect(inGameBackground).toBe(startBackground);

  await inGameNewGame.click();
  await expect(page.getByRole('heading', { name: 'Start a new game?' })).toBeVisible();
  const confirmNewGame = page.getByRole('button', { name: 'New Game', exact: true });
  const confirmBackground = await confirmNewGame.evaluate((element) => getComputedStyle(element).backgroundImage);
  expect(confirmBackground).toBe(inGameBackground);
  await confirmNewGame.click();

  await expect(page.getByRole('heading', { name: 'New game' })).toBeVisible();
  await expect(page.getByLabel('Rules').locator('option')).toHaveText(['Japanese', 'Chinese']);
  await expect(page.getByLabel('Rules')).toHaveValue('japanese');
});

test('normalizes committed komi to canonical half-point values before saving', async ({ page }) => {
  await page.goto('/');

  const cases = [
    ['6.9', '6.5'],
    ['7.0', '7.5'],
    ['3.1415', '3.5'],
    ['7.5', '7.5'],
  ] as const;

  for (const [input, expected] of cases) {
    await page.getByLabel('Komi').fill(input);
    await page.getByRole('button', { name: 'Start game' }).click();

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Continue saved game?' })).toBeVisible();
    await expect(page.locator('.startup-card p')).toContainText(`Komi ${expected}`);

    await page.getByRole('button', { name: 'New game', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'New game' })).toBeVisible();
  }
});

test('Cube 2D adds 6×6 and 7×7 beside 5×5 in the second size row', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cube 2D', exact: true }).click();

  const size5 = page.getByRole('button', { name: '5×5', exact: true });
  const size6 = page.getByRole('button', { name: '6×6', exact: true });
  const size7 = page.getByRole('button', { name: '7×7', exact: true });

  await expect(size5).toBeVisible();
  await expect(size6).toBeVisible();
  await expect(size7).toBeVisible();

  const [size5Box, size6Box, size7Box] = await Promise.all([
    size5.boundingBox(),
    size6.boundingBox(),
    size7.boundingBox(),
  ]);
  expect(size5Box).not.toBeNull();
  expect(size6Box).not.toBeNull();
  expect(size7Box).not.toBeNull();
  if (size5Box && size6Box && size7Box) {
    expect(size5Box.y).toBeCloseTo(size6Box.y, 0);
    expect(size6Box.y).toBeCloseTo(size7Box.y, 0);
    expect(size5Box.x).toBeLessThan(size6Box.x);
    expect(size6Box.x).toBeLessThan(size7Box.x);
  }

  await size6.click();
  await expect(size6).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Board size')).toHaveValue('6');

  await size7.click();
  await expect(size7).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Board size')).toHaveValue('7');
});

test('remembers the last started board size separately for Torus and Cube', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: '13×13', exact: true }).click();
  await page.getByRole('button', { name: 'Start game' }).click();

  await page.getByRole('button', { name: 'New game', exact: true }).click();
  await page.getByRole('button', { name: 'New Game', exact: true }).click();
  await expect(page.getByLabel('Board size')).toHaveValue('13');

  await page.getByRole('button', { name: 'Cube 2D', exact: true }).click();
  await expect(page.getByLabel('Board size')).toHaveValue('4');
  await page.getByRole('button', { name: '6×6', exact: true }).click();
  await page.getByRole('button', { name: 'Start game' }).click();

  await page.getByRole('button', { name: 'New game', exact: true }).click();
  await page.getByRole('button', { name: 'New Game', exact: true }).click();
  await expect(page.getByLabel('Board size')).toHaveValue('13');

  await page.getByRole('button', { name: 'Cube 2D', exact: true }).click();
  await expect(page.getByLabel('Board size')).toHaveValue('6');
  await page.getByRole('button', { name: 'Torus 2D', exact: true }).click();
  await expect(page.getByLabel('Board size')).toHaveValue('13');

  await page.reload();
  await expect(page.getByLabel('Board size')).toHaveValue('13');
  await page.getByRole('button', { name: 'Cube 2D', exact: true }).click();
  await expect(page.getByLabel('Board size')).toHaveValue('6');
});
