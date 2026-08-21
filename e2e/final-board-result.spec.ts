import { expect, test, type Locator, type Page } from '@playwright/test';

const point = (page: Page, logicalPointId: string): Locator =>
  page.locator(
    `.torus-board__hit-target[data-logical-point-id="${logicalPointId}"][data-copy-role="primary"]`,
  ).first();

const startGame = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.getByLabel('Board size').selectOption('9');
  await page.getByLabel('Rules').selectOption('chinese');
  await page.getByLabel('Komi').fill('0');
  await page.getByRole('button', { name: 'Start game' }).click();
};

const classify = async (
  page: Page,
  logicalPointId: string,
  status: 'Alive' | 'Dead' | 'Seki',
): Promise<void> => {
  await point(page, logicalPointId).click();
  const controls = page.getByRole('group', { name: 'Selected group status' });
  await expect(controls).toBeVisible();
  await controls.getByRole('button', { name: status, exact: true }).click();
};

const passTwice = async (page: Page): Promise<void> => {
  const pass = page.getByRole('button', { name: 'Pass', exact: true });
  await pass.click();
  await expect(pass).toBeDisabled();
  await expect(pass).toBeEnabled({ timeout: 4_000 });
  await pass.click();
};

test('finished board keeps territory and dead stones visible until Undo', async ({ page }) => {
  await startGame(page);

  // Leave White 4,4 on the board with one liberty at 4,5. When it is manually
  // classified Dead, scoring removes it and the two-point region 4,4 + 4,5 is Black territory.
  for (const logicalPointId of [
    '4,3', '0,0',
    '3,4', '1,0',
    '5,4', '2,0',
    '3,5', '4,4',
    '5,5', '3,0',
    '4,6',
  ]) {
    await point(page, logicalPointId).click();
  }

  await passTwice(page);
  await expect(page.getByRole('heading', { name: 'Manual endgame classification' })).toBeVisible();

  await classify(page, '4,3', 'Alive');
  await classify(page, '3,4', 'Alive');
  await classify(page, '5,4', 'Alive');
  await classify(page, '4,6', 'Alive');
  await classify(page, '0,0', 'Alive');
  await classify(page, '4,4', 'Dead');

  await expect(page.getByText('Classified 6 of 6')).toBeVisible();
  await page.getByRole('button', { name: 'Calculate final score' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  const board = page.locator('.torus-board');
  const blackTerritoryAtDeadStone = page.locator(
    '.torus-board__final-territory-point[data-logical-point-id="4,4"][data-territory-owner="black"]',
  );
  const blackTerritoryAtLiberty = page.locator(
    '.torus-board__final-territory-point[data-logical-point-id="4,5"][data-territory-owner="black"]',
  );
  const deadWhiteStone = page.locator(
    '.torus-board__stone[data-logical-point-id="4,4"][data-dead-stone="true"]',
  );

  await expect(board).toHaveAttribute('data-final-territory-visible', 'true');
  await expect(blackTerritoryAtDeadStone.first()).toHaveAttribute('opacity', '0.2');
  await expect(blackTerritoryAtLiberty.first()).toHaveAttribute('opacity', '0.2');
  await expect(deadWhiteStone.first()).toHaveAttribute('opacity', '0.38');

  // Closing the result popup is presentation-only: the final-board markings stay.
  await page.getByRole('button', { name: 'Close game result' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(board).toHaveAttribute('data-final-territory-visible', 'true');
  await expect(blackTerritoryAtDeadStone).not.toHaveCount(0);
  await expect(deadWhiteStone).not.toHaveCount(0);

  // Duplicate mode now shows only the immediately wrapped row/column. A central
  // point therefore has one copy until navigation brings it to a visible edge.
  await page.getByLabel('Показывать дублирующие области').check();
  expect(
    await blackTerritoryAtDeadStone.evaluateAll((nodes) =>
      nodes.every((node) => node.getAttribute('opacity') === '0.2'),
    ),
  ).toBe(true);
  expect(
    await deadWhiteStone.evaluateAll((nodes) =>
      nodes.every((node) => node.getAttribute('opacity') === '0.38'),
    ),
  ).toBe(true);

  const shiftRight = page.getByRole('button', { name: 'Shift torus view right' });
  for (let index = 0; index < 4; index += 1) {
    await shiftRight.click();
    await expect(board).toHaveAttribute('data-pan-animating', 'true');
    await expect(blackTerritoryAtDeadStone).not.toHaveCount(0);
    await expect(deadWhiteStone).not.toHaveCount(0);
    await expect(board).toHaveAttribute('data-pan-animating', 'false', { timeout: 2_000 });
  }

  // After four steps logical 4,4 reaches the current left edge. The right-side
  // one-line strip must now show the synchronized wrapped territory and dead stone.
  await expect.poll(() => blackTerritoryAtDeadStone.count()).toBeGreaterThan(1);
  await expect.poll(() => deadWhiteStone.count()).toBeGreaterThan(1);
  expect(
    await blackTerritoryAtDeadStone.evaluateAll((nodes) =>
      nodes.every((node) => node.getAttribute('opacity') === '0.2'),
    ),
  ).toBe(true);
  expect(
    await deadWhiteStone.evaluateAll((nodes) =>
      nodes.every((node) => node.getAttribute('opacity') === '0.38'),
    ),
  ).toBe(true);

  // Undo of the finishing second Pass restores the pre-finish ViewModel, so no final markings remain.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Black to move')).toBeVisible();
  await expect(board).toHaveAttribute('data-final-territory-visible', 'false');
  await expect(page.locator('.torus-board__final-territory-point')).toHaveCount(0);
  await expect(page.locator('.torus-board__stone[data-dead-stone="true"]')).toHaveCount(0);
});
