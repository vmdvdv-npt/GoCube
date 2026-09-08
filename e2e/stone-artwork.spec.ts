import { expect, test, type Locator, type Page } from '@playwright/test';

const point = (page: Page, logicalPointId: string): Locator =>
  page.locator(
    `.torus-board__hit-target[data-logical-point-id="${logicalPointId}"][data-copy-role="primary"]`,
  ).first();

const stone = (page: Page, logicalPointId: string): Locator =>
  page.locator(
    `.torus-board__stone[data-logical-point-id="${logicalPointId}"][data-copy-role="primary"]`,
  ).first();

const playPoint = async (page: Page, logicalPointId: string): Promise<void> => {
  await point(page, logicalPointId).click();
  await expect(stone(page, logicalPointId)).toHaveCount(1);
};

const startGame = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.getByLabel('Board size').selectOption('9');
  await page.getByLabel('Rules').selectOption('chinese');
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('.torus-board')).toBeVisible();
};

test('uses matte black SVG artwork without a highlight and preserves the white highlight', async ({ page }) => {
  await startGame(page);

  await playPoint(page, '4,4');
  await playPoint(page, '5,4');

  const blackStone = stone(page, '4,4');
  const whiteStone = stone(page, '5,4');

  await expect(blackStone).toHaveAttribute('data-stone-artwork', 'custom-svg');
  await expect(whiteStone).toHaveAttribute('data-stone-artwork', 'custom-svg');
  await expect(blackStone).toHaveAttribute('fill', /url\(#torus-stone-artwork-\d+-black\)/);
  await expect(whiteStone).toHaveAttribute('fill', /url\(#torus-stone-artwork-\d+-white\)/);
  await expect(blackStone).toHaveAttribute('stroke', 'none');
  await expect(whiteStone).toHaveAttribute('stroke', 'none');

  const defs = page.locator('defs[data-torus-stone-artwork="true"]');
  await expect(defs).toHaveCount(1);

  const blackGradient = defs.locator('radialGradient[id$="-black-gradient"]');
  await expect(blackGradient).toHaveAttribute('cx', '35%');
  await expect(blackGradient).toHaveAttribute('cy', '28%');
  await expect(blackGradient).toHaveAttribute('r', '97%');
  await expect(blackGradient.locator('stop')).toHaveCount(3);
  await expect(blackGradient.locator('stop').nth(0)).toHaveAttribute('offset', '0');
  await expect(blackGradient.locator('stop').nth(0)).toHaveAttribute('stop-color', '#42474d');
  await expect(blackGradient.locator('stop').nth(1)).toHaveAttribute('offset', '0.35');
  await expect(blackGradient.locator('stop').nth(1)).toHaveAttribute('stop-color', '#15181b');
  await expect(blackGradient.locator('stop').nth(2)).toHaveAttribute('offset', '0.72');
  await expect(blackGradient.locator('stop').nth(2)).toHaveAttribute('stop-color', '#050607');

  await expect(defs.locator('pattern[id$="-black"] ellipse')).toHaveCount(0);
  await expect(defs.locator('pattern[id$="-white"] ellipse')).toHaveAttribute('opacity', '0.65');

  await point(page, '6,4').hover();
  const preview = page.locator('.torus-board__preview-stone--black').first();
  await expect(preview).toHaveAttribute('data-stone-artwork', 'custom-svg');
  await expect(preview).toHaveAttribute('fill', /url\(#torus-stone-artwork-\d+-black\)/);
  await expect(preview).toHaveAttribute('stroke', 'none');
  await expect(preview).toHaveAttribute('opacity', '0.5');
});

test('snaps the forbidden marker to the illegal intersection instead of the pointer', async ({ page }) => {
  await startGame(page);

  await playPoint(page, '0,0');
  await playPoint(page, '4,3');
  await playPoint(page, '0,1');
  await playPoint(page, '3,4');
  await playPoint(page, '0,2');
  await playPoint(page, '5,4');
  await playPoint(page, '0,3');
  await playPoint(page, '4,5');

  const forbiddenPoint = point(page, '4,4');
  const rightPoint = point(page, '5,4');
  await expect(forbiddenPoint).toBeVisible();
  await expect(rightPoint).toBeVisible();
  const forbiddenBox = await forbiddenPoint.boundingBox();
  const rightBox = await rightPoint.boundingBox();
  if (!forbiddenBox || !rightBox) throw new Error('Expected board hit targets to be visible');

  const forbiddenCenterX = forbiddenBox.x + forbiddenBox.width / 2;
  const forbiddenCenterY = forbiddenBox.y + forbiddenBox.height / 2;
  const rightCenterX = rightBox.x + rightBox.width / 2;
  await page.mouse.move(
    forbiddenCenterX + (rightCenterX - forbiddenCenterX) * 0.3,
    forbiddenCenterY,
  );

  const marker = page.locator('.torus-board__forbidden-marker').first();
  await expect(marker).toHaveAttribute('data-logical-point-id', '4,4');
  await expect(marker).toHaveAttribute('data-snapped-to-intersection', 'true');
  await expect(marker).toHaveAttribute('cx', await forbiddenPoint.getAttribute('cx') ?? '');
  await expect(marker).toHaveAttribute('cy', await forbiddenPoint.getAttribute('cy') ?? '');
});
