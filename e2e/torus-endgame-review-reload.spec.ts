import { expect, test, type Page } from '@playwright/test';

const selectTorus2D = async (page: Page): Promise<void> => {
  const view2D = page
    .getByRole('group', { name: 'Torus view' })
    .getByRole('button', { name: '2D' });
  await expect(view2D).toBeEnabled();
  await view2D.click();
  await expect(view2D).toHaveAttribute('aria-pressed', 'true');
};

test('Torus 2D restores a partially completed assisted endgame review after reload', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Board size').selectOption('9');
  await page.getByRole('button', { name: 'Start game' }).click();
  await selectTorus2D(page);

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
  await expect(statuses).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Continue saved game?' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await selectTorus2D(page);

  await expect(page.getByRole('heading', { name: 'Assisted endgame review' })).toBeVisible();
  await expect(page.locator('.endgame-progress')).toHaveText('Resolved 1 of 2');
  await expect(statuses).toHaveCount(0);

  // Session-owned decision survives reload; presentation-only popup selection does not.
  await black.click();
  await expect(statuses.getByRole('button', { name: 'Alive', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await white.click();
  await statuses.getByRole('button', { name: 'Seki', exact: true }).click();
  await expect(statuses).toHaveCount(0);
  await expect(page.locator('.endgame-progress')).toHaveText('Resolved 2 of 2');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Finish scoring' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});
