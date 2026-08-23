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

test('confidence auto endgame is immediately finishable while every logical group remains editable', async ({ page }) => {
  await startGame(page);

  // Black becomes one logical group through the horizontal torus seam.
  await point(page, '0,4').click();
  await point(page, '4,4').click();
  await point(page, '8,4').click();
  await point(page, '4,5').click();
  await page.getByRole('button', { name: 'Pass' }).click();
  await page.getByRole('button', { name: 'Pass' }).click();

  await expect(page.getByRole('heading', { name: 'Assisted endgame review' })).toBeVisible();
  await expect(page.getByText('Resolved 2 of 2')).toBeVisible();
  await expect(page.getByText('2 automatic proposals')).toBeVisible();
  await expect(page.locator('.torus-board__group-contour--unresolved')).toHaveCount(0);
  await expect(page.locator('.torus-board__group-contour')).toHaveCount(2);

  // E2-12c proposals are sufficient to finish immediately; no manual sweep is required.
  const finish = page.getByRole('button', { name: 'Finish scoring' });
  await expect(finish).toBeEnabled();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Clicking either stone of the seam-connected black group selects the same auto-classified group.
  await point(page, '0,4').click();
  await expect(page.locator('.endgame-selection .stone-chip--black')).toHaveCount(1);
  const statuses = page.getByRole('group', { name: 'Selected group status' });
  const selectedAutomatic = statuses.locator('button[aria-pressed="true"]');
  await expect(selectedAutomatic).toHaveCount(1);
  const automaticLabel = await selectedAutomatic.textContent();
  const overrideLabel = automaticLabel?.trim() === 'Dead' ? 'Alive' : 'Dead';
  await statuses.getByRole('button', { name: overrideLabel, exact: true }).click();
  await expect(statuses.getByRole('button', { name: overrideLabel, exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByText('Resolved 2 of 2')).toBeVisible();
  await expect(finish).toBeEnabled();

  // The other automatically classified group remains editable without becoming required manual work.
  await point(page, '4,4').click();
  await expect(page.locator('.endgame-selection .stone-chip--white')).toHaveCount(1);
  await expect(statuses.locator('button[aria-pressed="true"]')).toHaveCount(1);

  // Passive duplicate strips do not duplicate logical endgame contours.
  const contourCount = await page.locator('.torus-board__group-contour').count();
  await page.getByLabel('Показывать дублирующие области').check();
  await expect(page.locator('.torus-board')).toHaveAttribute('data-duplicate-regions-visible', 'true');
  await expect(page.locator('.torus-board__group-contour')).toHaveCount(contourCount);
  await expect(
    page.locator('.torus-board__edge-duplicate-stone[data-logical-point-id="8,4"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('.torus-board__edge-duplicate-stone[data-logical-point-id="0,4"]'),
  ).toHaveCount(1);

  await finish.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Assisted endgame review' })).toHaveCount(0);
});
