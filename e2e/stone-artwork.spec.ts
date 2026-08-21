import { expect, test, type Locator, type Page } from '@playwright/test';

const point = (page: Page, logicalPointId: string): Locator =>
  page.locator(
    `.torus-board__hit-target[data-logical-point-id="${logicalPointId}"][data-copy-role="primary"]`,
  ).first();

const startGame = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.getByLabel('Board size').selectOption('9');
  await page.getByLabel('Rules').selectOption('chinese');
  await page.getByRole('button', { name: 'Start game' }).click();
};

test('uses the supplied gradient-and-highlight SVG artwork for black and white stones', async ({ page }) => {
  await startGame(page);

  await point(page, '4,4').click();
  await point(page, '5,4').click();

  const blackStone = page.locator(
    '.torus-board__stone[data-logical-point-id="4,4"][data-copy-role="primary"]',
  ).first();
  const whiteStone = page.locator(
    '.torus-board__stone[data-logical-point-id="5,4"][data-copy-role="primary"]',
  ).first();

  await expect(blackStone).toHaveAttribute('data-stone-artwork', 'custom-svg');
  await expect(whiteStone).toHaveAttribute('data-stone-artwork', 'custom-svg');
  await expect(blackStone).toHaveAttribute('fill', /url\(#torus-stone-artwork-\d+-black\)/);
  await expect(whiteStone).toHaveAttribute('fill', /url\(#torus-stone-artwork-\d+-white\)/);
  await expect(blackStone).toHaveAttribute('stroke', 'none');
  await expect(whiteStone).toHaveAttribute('stroke', 'none');

  const defs = page.locator('defs[data-torus-stone-artwork="true"]');
  await expect(defs).toHaveCount(1);
  await expect(defs.locator('pattern[id$="-black"] ellipse')).toHaveAttribute('opacity', '0.18');
  await expect(defs.locator('pattern[id$="-white"] ellipse')).toHaveAttribute('opacity', '0.65');

  await point(page, '6,4').hover();
  const preview = page.locator('.torus-board__preview-stone--black').first();
  await expect(preview).toHaveAttribute('data-stone-artwork', 'custom-svg');
  await expect(preview).toHaveAttribute('fill', /url\(#torus-stone-artwork-\d+-black\)/);
  await expect(preview).toHaveAttribute('opacity', '0.5');
});
