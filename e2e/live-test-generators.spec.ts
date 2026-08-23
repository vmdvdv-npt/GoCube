import { expect, test, type Locator, type Page } from '@playwright/test';

const primaryTorusStones = async (page: Page): Promise<readonly string[]> =>
  page
    .locator('.torus-board__stone[data-copy-role="primary"]')
    .evaluateAll((nodes) =>
      nodes
        .map((node) => {
          const point = node.getAttribute('data-logical-point-id');
          const occupancy = node.getAttribute('data-occupancy');
          return `${String(point)}=${String(occupancy)}`;
        })
        .sort(),
    );

const finishTwoPasses = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: 'Pass', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pass (1)' })).toBeDisabled();
  await page.waitForTimeout(1050);
  await expect(page.getByRole('button', { name: 'Pass (1)' })).toBeEnabled();
  await page.getByRole('button', { name: 'Pass (1)' }).click();
};

const generatorControls = (page: Page): Locator =>
  page.getByRole('region', { name: 'Developer test generators' });

test('developer Game-like generator exposes seed and replays the exact Torus position', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Board size').selectOption('9');
  await page.getByLabel('Rules').selectOption('japanese');
  await page.getByRole('button', { name: 'Start game' }).click();

  const controls = generatorControls(page);
  await expect(controls.getByRole('button', { name: 'Generate game' })).toBeVisible();
  await expect(controls.getByRole('button', { name: 'Generate endgame' })).toBeVisible();

  await controls.getByLabel('Generator type for replay').selectOption('game-like');
  await controls.getByLabel('Replay seed').fill('184237');
  await controls.getByRole('button', { name: 'Replay seed' }).click();

  await expect(controls.getByText('Game-like · Torus · 9×9 · Seed 184237')).toBeVisible();
  const first = await primaryTorusStones(page);
  expect(first.length).toBeGreaterThan(6);

  await controls.getByRole('button', { name: 'Replay seed' }).click();
  await expect(controls.getByText('Game-like · Torus · 9×9 · Seed 184237')).toBeVisible();
  expect(await primaryTorusStones(page)).toEqual(first);

  await controls.getByLabel('Replay seed').fill('184238');
  await controls.getByRole('button', { name: 'Replay seed' }).click();
  await expect(controls.getByText('Game-like · Torus · 9×9 · Seed 184238')).toBeVisible();
  expect(await primaryTorusStones(page)).not.toEqual(first);
});

test('developer Endgame generator creates a playable Cube position for immediate assisted review', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cube', exact: true }).click();
  await page.getByRole('button', { name: '5×5', exact: true }).click();
  await page.getByLabel('Rules').selectOption('japanese');
  await page.getByRole('button', { name: 'Start game' }).click();

  const controls = generatorControls(page);
  await controls.getByLabel('Generator type for replay').selectOption('endgame');
  await controls.getByLabel('Replay seed').fill('endgame-review-184237');
  await controls.getByRole('button', { name: 'Replay seed' }).click();

  await expect(
    controls.getByText('Endgame · Cube · 5×5 · Seed endgame-review-184237'),
  ).toBeVisible();
  await expect(page.locator('.cube-2d-stone')).not.toHaveCount(0);

  await finishTwoPasses(page);
  await expect(page.getByRole('heading', { name: 'Assisted endgame review' })).toBeVisible();
  await expect(page.locator('.endgame-progress')).toContainText('Manual review');
});
