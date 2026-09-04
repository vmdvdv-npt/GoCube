import { expect, test, type Locator, type Page } from '@playwright/test';

const startGame = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.getByLabel('Board size').selectOption('9');
  await page.getByRole('button', { name: 'Start game' }).click();
};

const point = (page: Page, logicalPointId: string): Locator =>
  page.locator(
    `.torus-board__hit-target[data-logical-point-id="${logicalPointId}"][data-copy-role="primary"]`,
  );

test('assisted endgame keeps every logical group editable until explicit scoring finish', async ({ page }) => {
  await startGame(page);

  // Black becomes one logical group through the horizontal torus seam.
  await point(page, '0,4').click();
  await point(page, '4,4').click();
  await point(page, '8,4').click();
  await point(page, '4,5').click();
  await page.getByRole('button', { name: 'Pass' }).click();
  await page.getByRole('button', { name: 'Pass' }).click();

  await expect(page.getByRole('heading', { name: 'Assisted endgame review' })).toBeVisible();
  await expect(page.getByText('Resolved 0 of 2')).toBeVisible();

  // Same-status groups of opposite stone colors keep separate contours so the
  // black/white boundary remains visible even though both contours are salad-green.
  const unresolvedContours = page.locator('.torus-board__group-contour--unresolved');
  await expect(unresolvedContours).toHaveCount(2);
  await expect(
    page.locator('.torus-board__group-contour--unresolved[data-endgame-color="black"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('.torus-board__group-contour--unresolved[data-endgame-color="white"]'),
  ).toHaveCount(1);

  // Clicking either stone of the seam-connected black group selects the same group.
  await point(page, '0,4').click();
  await expect(page.locator('.endgame-selection .stone-chip--black')).toHaveCount(1);
  const statuses = page.getByRole('group', { name: 'Selected group status' });
  await statuses.getByRole('button', { name: 'Seki', exact: true }).click();

  await expect(page.getByText('Resolved 1 of 2')).toBeVisible();
  await expect(page.locator('.torus-board__group-contour--seki')).toHaveCount(1);
  await expect(page.locator('.torus-board__seki-mask')).toHaveAttribute('opacity', '0.6');

  await point(page, '4,4').click();
  await expect(page.locator('.endgame-selection .stone-chip--white')).toHaveCount(1);
  await statuses.getByRole('button', { name: 'Alive', exact: true }).click();
  await expect(page.getByText('Resolved 2 of 2')).toBeVisible();

  // Resolving the last group no longer ends review. A previously resolved group
  // remains selectable and can still override its prior/manual/automatic status.
  const finish = page.getByRole('button', { name: 'Finish scoring' });
  await expect(finish).toBeEnabled();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await point(page, '8,4').click();
  await expect(page.locator('.endgame-selection .stone-chip--black')).toHaveCount(1);
  await statuses.getByRole('button', { name: 'Dead', exact: true }).click();
  await expect(page.locator('.torus-board__group-contour--dead')).toHaveCount(1);
  await expect(page.locator('.torus-board__group-contour--seki')).toHaveCount(0);

  // Main-game endgame rendering remains canonical and never leaks duplicate-region UI.
  const contourCount = await page.locator('.torus-board__group-contour').count();
  await expect(page.getByText(/duplicate regions/i)).toHaveCount(0);
  await expect(page.getByText('Показывать дублирующие области')).toHaveCount(0);
  await expect(page.locator('.torus-board')).toHaveAttribute('data-duplicate-regions-visible', 'false');
  await expect(page.locator('.torus-board__edge-duplicates')).toHaveCount(0);
  await expect(page.locator('.torus-board__group-contour')).toHaveCount(contourCount);

  await finish.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Assisted endgame review' })).toHaveCount(0);
});
