import { expect, test, type Page } from '@playwright/test';

const torusPoint = (page: Page, pointId: string) =>
  page.locator(
    `.torus-board__hit-target[data-logical-point-id="${pointId}"][data-copy-role="primary"]`,
  );

const cubePoint = (page: Page, pointId: string) =>
  page.locator(`.cube-2d-hit-area[data-point-id="${pointId}"]`);

const finishTwoPassSequence = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: 'Pass' }).click();
  await expect(page.getByRole('button', { name: 'Pass (1)' })).toBeDisabled();
  await page.waitForTimeout(1050);
  await expect(page.getByRole('button', { name: 'Pass (1)' })).toBeEnabled();
  await page.getByRole('button', { name: 'Pass (1)' }).click();
};

const differentStatusLabel = (label: string | null): 'Alive' | 'Dead' =>
  label?.trim() === 'Dead' ? 'Alive' : 'Dead';

test('0.3 acceptance: Torus confidence auto review survives reload and completes scoring', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Board size').selectOption('9');
  await page.getByLabel('Rules').selectOption('japanese');
  await page.getByRole('button', { name: 'Start game' }).click();

  await torusPoint(page, '0,0').click();
  await torusPoint(page, '4,4').click();
  await finishTwoPassSequence(page);

  await expect(page.getByRole('heading', { name: 'Assisted endgame review' })).toBeVisible();
  await expect(page.locator('.endgame-progress')).toHaveText('Resolved 2 of 2 · 2 automatic proposals');
  await expect(page.getByRole('button', { name: 'Finish scoring' })).toBeEnabled();

  await torusPoint(page, '0,0').click();
  await expect(page.locator('.endgame-selection .stone-chip--black')).toHaveCount(1);
  const statuses = page.getByRole('group', { name: 'Selected group status' });
  const selectedAutomatic = statuses.locator('button[aria-pressed="true"]');
  await expect(selectedAutomatic).toHaveCount(1);
  const overrideLabel = differentStatusLabel(await selectedAutomatic.textContent());
  await statuses.getByRole('button', { name: overrideLabel, exact: true }).click();
  await expect(statuses.getByRole('button', { name: overrideLabel, exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.endgame-progress')).toContainText('Resolved 2 of 2');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Continue saved game?' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: 'Assisted endgame review' })).toBeVisible();
  await expect(page.locator('.endgame-progress')).toContainText('Resolved 2 of 2');
  await torusPoint(page, '0,0').click();
  await expect(
    page.getByRole('group', { name: 'Selected group status' })
      .getByRole('button', { name: overrideLabel, exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Finish scoring' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('Japanese scoring')).toBeVisible();
});

test('0.3 acceptance: Cube confidence auto review completes scoring and Undo reopens play', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cube', exact: true }).click();
  await page.getByRole('button', { name: '3×3', exact: true }).click();
  await page.getByLabel('Rules').selectOption('chinese');
  await page.getByRole('button', { name: 'Start game' }).click();

  const reviewPoints = ['front:1:2', 'back:0:0', 'right:1:0', 'front:0:0'] as const;
  await cubePoint(page, reviewPoints[0]).click();
  await cubePoint(page, reviewPoints[1]).click();
  await cubePoint(page, reviewPoints[2]).click();

  await page.getByRole('button', { name: 'Pass' }).click();
  await expect(page.getByRole('button', { name: 'Pass (1)' })).toBeDisabled();
  await page.waitForTimeout(1050);
  await cubePoint(page, reviewPoints[3]).click();

  await finishTwoPassSequence(page);

  await expect(page.getByRole('heading', { name: 'Assisted endgame review' })).toBeVisible();
  const progress = page.locator('.endgame-progress');
  const progressText = (await progress.textContent()) ?? '';
  const match = progressText.match(/Resolved (\d+) of (\d+)/);
  expect(match).not.toBeNull();
  expect(Number(match![1])).toBe(Number(match![2]));
  expect(progressText).toContain(`${match![2]} automatic proposals`);
  await expect(page.getByRole('button', { name: 'Finish scoring' })).toBeEnabled();

  await cubePoint(page, reviewPoints[0]).click();
  const statuses = page.getByRole('group', { name: 'Selected group status' });
  const selectedAutomatic = statuses.locator('button[aria-pressed="true"]');
  await expect(selectedAutomatic).toHaveCount(1);
  const overrideLabel = differentStatusLabel(await selectedAutomatic.textContent());
  await statuses.getByRole('button', { name: overrideLabel, exact: true }).click();
  await expect(statuses.getByRole('button', { name: overrideLabel, exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await expect(page.getByRole('button', { name: 'Finish scoring' })).toBeEnabled();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Finish scoring' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('Chinese scoring')).toBeVisible();
  await expect(page.locator('.cube-2d-renderer')).toHaveAttribute('data-gameplay-input-disabled', 'true');

  await page.getByRole('button', { name: 'Close game result' }).click();
  await page.getByRole('button', { name: 'Undo' }).click();

  await expect(page.getByRole('button', { name: 'Pass (1)' })).toBeEnabled();
  await expect(page.locator('.cube-2d-renderer')).toHaveAttribute('data-gameplay-input-disabled', 'false');
  await cubePoint(page, 'front:2:0').click();
  await expect(page.locator('.cube-2d-stone[data-logical-point-id="front:2:0"]')).toHaveCount(1);
});
