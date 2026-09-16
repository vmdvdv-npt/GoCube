import { expect, test } from '@playwright/test';

test('Torus 2D restores a partially completed assisted endgame review after reload', async ({ page }) => {
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
  await expect(page.locator('.endgame-progress')).toHaveText('Resolved 0 of 2');

  const statuses = page.getByRole('group', { name: 'Selected group status' });
  await expect(statuses).toHaveCount(0);
  await black.click();
  await statuses.getByRole('button', { name: 'Alive', exact: true }).click();
  await expect(page.locator('.endgame-progress')).toHaveText('Resolved 1 of 2');
  // The group remains selected so the user can immediately change the decision.
  await expect(statuses).toHaveCount(1);
  await expect(statuses.getByRole('button', { name: 'Alive', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Continue saved game?' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: 'Assisted endgame review' })).toBeVisible();
  await expect(page.locator('.endgame-progress')).toHaveText('Resolved 1 of 2');
  await expect(statuses).toHaveCount(0);

  // Session-owned decision survives reload; presentation-only selection does not.
  await black.click();
  await expect(statuses.getByRole('button', { name: 'Alive', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await white.click();
  await statuses.getByRole('button', { name: 'Seki', exact: true }).click();
  await expect(page.locator('.endgame-progress')).toHaveText('Resolved 2 of 2');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Finish scoring' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});
