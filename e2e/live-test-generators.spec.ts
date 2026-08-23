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

const testCaseControls = (page: Page): Locator =>
  page.getByTestId('live-test-generator-controls');

const openTestCaseControls = async (page: Page): Promise<Locator> => {
  const controls = testCaseControls(page);
  await expect(controls).toBeVisible();
  if ((await controls.getAttribute('open')) === null) {
    await controls.locator('summary').click();
  }
  await expect(controls).toHaveAttribute('open', '');
  return controls;
};

const closeTestCaseControls = async (page: Page): Promise<void> => {
  const controls = testCaseControls(page);
  if ((await controls.getAttribute('open')) !== null) {
    await controls.locator('summary').click();
  }
  await expect(controls).not.toHaveAttribute('open', '');
};

const currentTestId = async (controls: Locator): Promise<string> => {
  const text = await controls.getByText(/Current Test ID: \d+/).textContent();
  const match = text?.match(/Current Test ID:\s*(\d+)/);
  if (!match) throw new Error(`Could not read Test ID from ${String(text)}`);
  return match[1]!;
};

test('developer Game-like generator restores the exact Torus position from numeric Test ID', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Board size').selectOption('9');
  await page.getByLabel('Rules').selectOption('japanese');
  await page.getByRole('button', { name: 'Start game' }).click();

  let controls = await openTestCaseControls(page);
  await expect(controls.getByRole('button', { name: 'Generate game' })).toBeVisible();
  await expect(controls.getByRole('button', { name: 'Generate endgame' })).toBeVisible();
  await expect(controls.getByRole('button', { name: 'AI-verified case' })).toBeVisible();

  await controls.getByRole('button', { name: 'Generate game' }).click();
  controls = await openTestCaseControls(page);
  const firstId = await currentTestId(controls);
  expect(firstId).toMatch(/^\d+$/);
  const first = await primaryTorusStones(page);
  expect(first.length).toBeGreaterThan(6);

  await controls.getByRole('button', { name: 'Generate game' }).click();
  controls = await openTestCaseControls(page);
  const secondId = await currentTestId(controls);
  expect(secondId).not.toBe(firstId);

  await controls.getByLabel('Test ID').fill(firstId);
  await controls.getByRole('button', { name: 'Load' }).click();
  controls = await openTestCaseControls(page);
  await expect(controls.getByText(`Current Test ID: ${firstId}`)).toBeVisible();
  expect(await primaryTorusStones(page)).toEqual(first);
});

test('developer synthetic Endgame Test ID creates a playable Cube position for immediate assisted review', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cube', exact: true }).click();
  await page.getByRole('button', { name: '5×5', exact: true }).click();
  await page.getByLabel('Rules').selectOption('japanese');
  await page.getByRole('button', { name: 'Start game' }).click();

  let controls = await openTestCaseControls(page);
  await controls.getByRole('button', { name: 'Generate endgame' }).click();
  controls = await openTestCaseControls(page);
  const testId = await currentTestId(controls);
  await expect(controls.getByText(`Current Test ID: ${testId}`)).toBeVisible();
  await expect(controls.getByText(/Synthetic ·/)).toBeVisible();
  await expect(page.locator('.cube-2d-stone')).not.toHaveCount(0);

  await closeTestCaseControls(page);
  await finishTwoPasses(page);
  await expect(page.getByRole('heading', { name: 'Assisted endgame review' })).toBeVisible();
  await expect(page.locator('.endgame-progress')).toContainText('Resolved');
  await expect(page.getByRole('button', { name: 'Finish scoring' })).toBeVisible();
});

test('AI-verified case exposes Source / KataGo / Cube Go and is reloadable by Test ID', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Board size').selectOption('9');
  await page.getByLabel('Rules').selectOption('japanese');
  await page.getByRole('button', { name: 'Start game' }).click();

  let controls = await openTestCaseControls(page);
  await controls.getByRole('button', { name: 'AI-verified case' }).click();
  controls = await openTestCaseControls(page);
  const corpusId = await currentTestId(controls);
  await expect(controls.getByText('Source: Unknown')).toBeVisible();
  await expect(controls.getByText(/KataGo: (Alive|Dead|Unstable|Unavailable)/)).toBeVisible();
  await expect(controls.getByText(/Cube Go: (Alive|Dead|Seki|Unresolved)/)).toBeVisible();
  const corpusStones = await primaryTorusStones(page);
  expect(corpusStones.length).toBeGreaterThan(0);

  await controls.getByRole('button', { name: 'Generate game' }).click();
  controls = await openTestCaseControls(page);
  await controls.getByLabel('Test ID').fill(corpusId);
  await controls.getByRole('button', { name: 'Load' }).click();
  controls = await openTestCaseControls(page);
  await expect(controls.getByText(`Current Test ID: ${corpusId}`)).toBeVisible();
  await expect(controls.getByText('Source: Unknown')).toBeVisible();
  expect(await primaryTorusStones(page)).toEqual(corpusStones);
});
