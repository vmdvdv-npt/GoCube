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

test('assisted endgame selects unresolved groups sequentially and finishes after the last answer', async ({ page }) => {
  await startGame(page);

  // Black becomes one logical group through the horizontal torus seam.
  await point(page, '0,4').click();
  await point(page, '4,4').click();
  await point(page, '8,4').click();
  await point(page, '4,5').click();
  await page.getByRole('button', { name: 'Pass' }).click();
  await page.getByRole('button', { name: 'Pass' }).click();

  await expect(page.getByRole('heading', { name: 'Assisted endgame review' })).toBeVisible();
  await expect(page.getByText('Manual review 0 of 2')).toBeVisible();
  await expect(page.locator('.endgame-selection .stone-chip--black')).toHaveCount(1);

  // Hovering either seam stone still highlights the complete logical group.
  await point(page, '0,4').hover();
  const preview = page.locator(
    '.torus-board__endgame-line[data-endgame-status="preview"][data-endgame-temporary="true"]',
  );
  await expect(preview).toHaveCount(2);
  await expect(preview.first()).toHaveAttribute('opacity', '0.42');

  const statuses = page.getByRole('group', { name: 'Selected group status' });
  await statuses.getByRole('button', { name: 'Seki', exact: true }).click();

  const blackLines = page.locator('.torus-board__endgame-line[data-endgame-status="seki"]');
  await expect(blackLines).toHaveCount(2);
  await expect(blackLines.first()).toHaveAttribute('stroke', '#7a7a7a');
  await expect(page.getByText('Manual review 1 of 2')).toBeVisible();
  await expect(page.locator('.endgame-selection .stone-chip--white')).toHaveCount(1);

  // Duplicate regions remain renderer-only and do not duplicate endgame geometry.
  const cleanLineCount = await blackLines.count();
  const cleanGeometry = await blackLines.evaluateAll((lines) =>
    lines.map((line) => [
      line.getAttribute('x1'),
      line.getAttribute('y1'),
      line.getAttribute('x2'),
      line.getAttribute('y2'),
    ]),
  );
  await page.getByLabel('Показывать дублирующие области').check();
  await expect(page.locator('.torus-board')).toHaveAttribute('data-duplicate-regions-visible', 'true');
  await expect(blackLines).toHaveCount(cleanLineCount);
  const duplicateGeometry = await blackLines.evaluateAll((lines) =>
    lines.map((line) => [
      line.getAttribute('x1'),
      line.getAttribute('y1'),
      line.getAttribute('x2'),
      line.getAttribute('y2'),
    ]),
  );
  expect(duplicateGeometry).toEqual(cleanGeometry);
  await expect(
    page.locator('.torus-board__edge-duplicate-stone[data-logical-point-id="8,4"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('.torus-board__edge-duplicate-stone[data-logical-point-id="0,4"]'),
  ).toHaveCount(1);

  // The last required answer completes scoring immediately; there is no extra calculate button.
  await statuses.getByRole('button', { name: 'Alive', exact: true }).click();
  await expect(page.getByText('Final result')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Assisted endgame review' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Calculate final score' })).toHaveCount(0);
});
