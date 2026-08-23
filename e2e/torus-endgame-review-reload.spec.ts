import { expect, test } from '@playwright/test';

const differentStatusLabel = (label: string | null): 'Alive' | 'Dead' =>
  label?.trim() === 'Dead' ? 'Alive' : 'Dead';

test('Torus 2D restores confidence auto proposals and a player override after reload', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Board size').selectOption('9');
  await page.getByRole('button', { name: 'Start game' }).click();

  const black = page.locator(
    '.torus-board__hit-target[data-logical-point-id="0,0"][data-copy-role="primary"]',
  );
  const white = page.locator(
    '.torus-board__hit-target[data-logical-point-id="4,4"][data-copy-role="primary"]',
  );
  await black.click();
  await white.click();

  await page.getByRole('button', { name: 'Pass' }).click();
  await page.waitForTimeout(1050);
  await page.getByRole('button', { name: 'Pass (1)' }).click();
  await expect(page.getByRole('heading', { name: 'Assisted endgame review' })).toBeVisible();
  await expect(page.locator('.endgame-progress')).toHaveText('Resolved 2 of 2 · 2 automatic proposals');
  await expect(page.getByRole('button', { name: 'Finish scoring' })).toBeEnabled();

  await black.click();
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
  await black.click();
  await expect(page.locator('.endgame-selection .stone-chip--black')).toHaveCount(1);
  await expect(
    page.getByRole('group', { name: 'Selected group status' })
      .getByRole('button', { name: overrideLabel, exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');

  // The untouched white group stays automatically classified and remains editable.
  await white.click();
  await expect(page.locator('.endgame-selection .stone-chip--white')).toHaveCount(1);
  await expect(
    page.getByRole('group', { name: 'Selected group status' }).locator('button[aria-pressed="true"]'),
  ).toHaveCount(1);

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Finish scoring' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});
