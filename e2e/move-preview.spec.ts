import { expect, test, type Locator, type Page } from '@playwright/test';

const point = (
  page: Page,
  logicalPointId: string,
  copyRole: 'primary' | 'duplicate' = 'primary',
): Locator =>
  page.locator(
    `.torus-board__hit-target[data-logical-point-id="${logicalPointId}"][data-copy-role="${copyRole}"]`,
  ).first();

const startGame = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.getByLabel('Board size').selectOption('9');
  await page.getByRole('button', { name: 'Start game' }).click();
};

test('legal hover uses a 50% stone, occupied has no preview, and duplicates stay synchronized', async ({ page }) => {
  await startGame(page);

  await point(page, '0,0').hover();
  let previews = page.locator('.torus-board__preview-stone[data-logical-point-id="0,0"]');
  await expect(previews).toHaveCount(1);
  await expect(previews.first()).toHaveAttribute('opacity', '0.5');

  await point(page, '0,0').click();
  await point(page, '0,0').hover();
  await expect(page.locator('.torus-board__preview-stone')).toHaveCount(0);
  await expect(page.locator('.torus-board__forbidden-marker')).toHaveCount(0);

  await page.getByLabel('Показывать дублирующие области').check();
  await point(page, '1,1').hover();
  previews = page.locator('.torus-board__preview-stone[data-logical-point-id="1,1"]');
  const visibleCopies = await page.locator(
    '.torus-board__hit-target[data-logical-point-id="1,1"]',
  ).count();
  await expect(previews).toHaveCount(visibleCopies);
});

test('suicide hover replaces the stone preview with one opaque red marker', async ({ page }) => {
  await startGame(page);

  // Build a suicide at 4,4 for Black.
  for (const id of ['0,0', '4,3', '0,1', '3,4', '0,2', '5,4', '0,3', '4,5']) {
    await point(page, id).click();
  }

  await point(page, '4,4').hover();
  await expect(page.locator('.torus-board__preview-stone')).toHaveCount(0);
  const marker = page.locator('.torus-board__forbidden-marker');
  await expect(marker).toHaveCount(1);
  await expect(marker).toHaveAttribute('fill', '#ff0000');
  await expect(marker).toHaveAttribute('opacity', '1');
});
