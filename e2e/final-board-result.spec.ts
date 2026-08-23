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

const passTwice = async (page: Page): Promise<void> => {
  const pass = page.getByRole('button', { name: /^Pass(?: \(1\))?$/ });
  await pass.click();
  await expect(pass).toBeDisabled();
  await expect(pass).toBeEnabled({ timeout: 2_200 });
  await pass.click();
};

test('review shows resolved territory dots and finished board removes dead stones until Undo', async ({ page }) => {
  await startGame(page);

  // White 4,4 has one liberty at 4,5. Once it is marked Dead and the surrounding
  // Black group is Alive, the local region becomes unambiguous Black territory.
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
  await expect(page.getByRole('heading', { name: 'Assisted endgame review' })).toBeVisible();
  await expect(page.locator('.endgame-progress')).toContainText('Resolved');

  const statuses = page.getByRole('group', { name: 'Selected group status' });
  const primaryStoneIds = await page
    .locator('.torus-board__stone[data-copy-role="primary"]')
    .evaluateAll((nodes) =>
      [...new Set(nodes.map((node) => node.getAttribute('data-logical-point-id')).filter(Boolean))] as string[],
    );

  // Resolve every group Alive first, then override the target White group to Dead.
  // This also exercises the requirement that already-resolved groups stay editable.
  for (const logicalPointId of primaryStoneIds) {
    await point(page, logicalPointId).click();
    await statuses.getByRole('button', { name: 'Alive', exact: true }).click();
  }
  await point(page, '4,4').click();
  await statuses.getByRole('button', { name: 'Dead', exact: true }).click();

  const provisionalLibertyDot = page.locator(
    '.torus-board__territory-dot[data-logical-point-id="4,5"][data-territory-owner="black"]',
  );
  const provisionalDeadPointDot = page.locator(
    '.torus-board__territory-dot[data-logical-point-id="4,4"][data-territory-owner="black"]',
  );
  await expect(provisionalLibertyDot).toHaveCount(1);
  // During review the dead stone stays visible, so its occupied point has no dot yet.
  await expect(provisionalDeadPointDot).toHaveCount(0);
  await expect(
    page.locator('.torus-board__stone[data-logical-point-id="4,4"][data-copy-role="primary"]'),
  ).toHaveCount(1);

  await page.getByRole('button', { name: 'Finish scoring' }).click();

  const resultDialog = page.getByRole('dialog');
  await expect(resultDialog).toBeVisible();
  const dialogTheme = await resultDialog.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      color: style.color,
    };
  });
  expect(dialogTheme.backgroundColor).toBe('rgb(7, 16, 24)');
  expect(dialogTheme.color).toBe('rgb(238, 243, 247)');
  await expect(page.locator('.result-score-card')).toHaveCount(2);

  const blackTerritoryAtDeadStone = page.locator(
    '.torus-board__territory-dot[data-logical-point-id="4,4"][data-territory-owner="black"]',
  );
  const blackTerritoryAtLiberty = page.locator(
    '.torus-board__territory-dot[data-logical-point-id="4,5"][data-territory-owner="black"]',
  );
  const deadWhiteStone = page.locator(
    '.torus-board__stone[data-logical-point-id="4,4"][data-copy-role="primary"]',
  );

  await expect(blackTerritoryAtDeadStone).toHaveCount(1);
  await expect(blackTerritoryAtLiberty).toHaveCount(1);
  await expect(deadWhiteStone).toHaveCount(0);

  // Closing the result popup is presentation-only: final board markings stay.
  await page.getByRole('button', { name: 'Close game result' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(blackTerritoryAtDeadStone).toHaveCount(1);
  await expect(blackTerritoryAtLiberty).toHaveCount(1);
  await expect(deadWhiteStone).toHaveCount(0);

  // Undo of the finishing second Pass restores the pre-review board.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Black to move')).toBeVisible();
  await expect(page.locator('.torus-board__territory-dot')).toHaveCount(0);
  await expect(deadWhiteStone).toHaveCount(1);
});
