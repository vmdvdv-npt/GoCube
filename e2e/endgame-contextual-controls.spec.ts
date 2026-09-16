import { expect, test, type Locator, type Page } from '@playwright/test';

const torusPoint = (page: Page, logicalPointId: string): Locator =>
  page.locator(
    `.torus-board__hit-target[data-logical-point-id="${logicalPointId}"][data-copy-role="primary"]`,
  );

const cubeHit = (page: Page, logicalPointId: string): Locator =>
  page.locator(`.cube-2d-hit-area[data-point-id="${logicalPointId}"]`);

const selectedStatuses = (page: Page): Locator =>
  page.getByRole('group', { name: 'Selected group status' });

test('Torus Endgame Review keeps one shared status control bound to the logical group across pan', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Board size').selectOption('9');
  await page.getByRole('button', { name: 'Start game' }).click();

  // Black is one logical seam group; White is a separate two-stone group near the top edge.
  await torusPoint(page, '0,4').click();
  await torusPoint(page, '4,0').click();
  await torusPoint(page, '8,4').click();
  await torusPoint(page, '4,1').click();

  await page.getByRole('button', { name: 'Pass' }).click();
  await page.getByRole('button', { name: 'Pass (1)' }).click();
  await expect(page.getByRole('heading', { name: 'Assisted endgame review' })).toBeVisible();
  await expect(selectedStatuses(page)).toHaveCount(0);

  await torusPoint(page, '0,4').click();
  const statuses = selectedStatuses(page);
  await expect(statuses).toBeVisible();
  await expect(page.locator('.endgame-selection .stone-chip--black')).toHaveCount(1);

  const seki = statuses.getByRole('button', { name: 'Seki', exact: true });
  await seki.click();
  await expect(seki).toHaveAttribute('aria-pressed', 'true');

  // The selected group is application state, not reconstructed from DOM geometry.
  // Torus navigation changes scene coordinates but must preserve the same logical selection.
  await page.getByRole('button', { name: 'Shift torus view right' }).click();
  await expect(page.locator('.torus-board')).toHaveAttribute('data-pan-animating', 'false', {
    timeout: 1000,
  });
  await expect(page.locator('.endgame-selection .stone-chip--black')).toHaveCount(1);
  await expect(seki).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.torus-board__endgame-lines')).toHaveCount(0);
  await expect(page.locator('.torus-board__group-contour--seki')).toHaveCount(1);

  // Clicking the other visual member of the same seam-connected group keeps that decision.
  await torusPoint(page, '8,4').click();
  await expect(seki).toHaveAttribute('aria-pressed', 'true');
});

test('Cube 2D uses the same shared review controls and preserves logical selection through navigation', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cube', exact: true }).click();
  await page.getByRole('button', { name: '3×3', exact: true }).click();
  await page.getByRole('button', { name: 'Start game' }).click();

  await cubeHit(page, 'front:1:1').click();
  await cubeHit(page, 'right:1:1').click();
  await page.getByRole('button', { name: 'Pass' }).click();
  await page.getByRole('button', { name: 'Pass (1)' }).click();
  await expect(page.getByRole('heading', { name: 'Assisted endgame review' })).toBeVisible();
  await expect(selectedStatuses(page)).toHaveCount(0);

  await cubeHit(page, 'front:1:1').click();
  const statuses = selectedStatuses(page);
  await expect(statuses).toBeVisible();
  const alive = statuses.getByRole('button', { name: 'Alive', exact: true });
  await alive.click();
  await expect(alive).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Move cube right' }).click();
  await expect(page.locator('.cube-2d-renderer')).toHaveAttribute('data-animating', 'true');
  await expect(page.locator('.cube-2d-renderer')).toHaveAttribute('data-animating', 'false', {
    timeout: 1000,
  });
  await expect(page.locator('.endgame-selection .stone-chip--black')).toHaveCount(1);
  await expect(alive).toHaveAttribute('aria-pressed', 'true');
});
