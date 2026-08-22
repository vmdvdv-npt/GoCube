import { expect, test, type Page } from '@playwright/test';

type StartOptions = Readonly<{
  size: '9' | '13' | '19';
  rules: 'chinese' | 'japanese';
  komi: string;
}>;

const startGame = async (page: Page, options: StartOptions): Promise<void> => {
  await page.goto('/');
  await expect(page.getByTestId('new-game-settings-grid')).toBeVisible();
  await page.getByLabel('Board size').selectOption(options.size);
  await page.getByLabel('Rules').selectOption(options.rules);
  await page.getByLabel('Komi').fill(options.komi);
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('.torus-game')).toBeVisible();
};

const clickPoint = async (page: Page, logicalPointId: string): Promise<void> => {
  const target = page.locator(
    `.torus-board__hit-target[data-logical-point-id="${logicalPointId}"][data-copy-role="primary"]`,
  );
  await expect(target).toHaveCount(1);
  await target.click();
};

const expectNoLegacyPassState = async (page: Page): Promise<void> => {
  await expect(page.getByText(/^Passes \d+$/)).toHaveCount(0);
};

const waitForPassGuard = async (page: Page): Promise<void> => {
  const pass = page.getByRole('button', { name: /^Pass(?: \(1\))?$/ });
  await expect(pass).toHaveText('Pass (1)');
  await expectNoLegacyPassState(page);
  await expect(pass).toBeDisabled();
  await expect(page.getByRole('progressbar', { name: 'Pass cooldown' })).toHaveCount(0);
  await expect(pass).toBeEnabled({ timeout: 2200 });
};

const classifyPoint = async (
  page: Page,
  logicalPointId: string,
  status: 'Alive' | 'Dead' | 'Seki',
): Promise<void> => {
  await clickPoint(page, logicalPointId);
  const controls = page.getByRole('group', { name: 'Selected group status' });
  await expect(controls).toBeVisible();
  await controls.getByRole('button', { name: status, exact: true }).click();
};

test('new game exposes every supported 0.1 torus size', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('new-game-settings-grid')).toBeVisible();
  await expect(page.getByLabel('Board size').locator('option')).toHaveText([
    '9×9',
    '13×13',
    '19×19',
  ]);
});

test('release acceptance covers capture, Pass/Undo and board-first manual endgame statuses', async ({ page }) => {
  await startGame(page, { size: '9', rules: 'chinese', komi: '7.5' });

  for (const point of ['1,1', '0,1', '5,5', '1,0', '5,6', '2,1', '6,5', '1,2']) {
    await clickPoint(page, point);
  }

  await expect(page.getByText('Black to move')).toBeVisible();
  await expect(page.getByText('Move 8')).toBeVisible();
  await expect(page.getByLabel('Black stones captured: 1')).toBeVisible();
  await expect(
    page.locator(
      '.torus-board__stone[data-logical-point-id="1,1"][data-copy-role="primary"]',
    ),
  ).toHaveCount(0);

  await page.getByRole('button', { name: 'Pass' }).click();
  await expect(page.getByText('White to move')).toBeVisible();
  await expect(page.getByText('Move 9')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pass (1)', exact: true })).toBeVisible();
  await expectNoLegacyPassState(page);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Black to move')).toBeVisible();
  await expect(page.getByText('Move 8')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pass', exact: true })).toBeVisible();
  await expectNoLegacyPassState(page);
  await expect(page.getByLabel('Black stones captured: 1')).toBeVisible();

  await page.getByRole('button', { name: 'Pass' }).click();
  await waitForPassGuard(page);
  await page.getByRole('button', { name: 'Pass' }).click();
  await expect(page.getByRole('heading', { name: 'Manual endgame classification' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
  await expect(page.getByText(/Group 1/)).toHaveCount(0);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('White to move')).toBeVisible();
  await expect(page.getByText('Move 9')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pass (1)', exact: true })).toBeVisible();
  await expectNoLegacyPassState(page);

  await page.getByRole('button', { name: 'Pass' }).click();
  await expect(page.getByRole('heading', { name: 'Manual endgame classification' })).toBeVisible();

  // The black group is connected through 5,5-5,6-6,5 and can be reclassified freely.
  await clickPoint(page, '5,5');
  const selectedStatus = page.getByRole('group', { name: 'Selected group status' });
  await selectedStatus.getByRole('button', { name: 'Alive', exact: true }).click();
  await expect(page.locator('.torus-board__endgame-line[data-endgame-status="alive"]')).not.toHaveCount(0);
  await selectedStatus.getByRole('button', { name: 'Dead', exact: true }).click();
  await expect(page.locator('.torus-board__endgame-line[data-endgame-status="dead"]')).not.toHaveCount(0);
  await selectedStatus.getByRole('button', { name: 'Seki', exact: true }).click();
  await expect(page.locator('.torus-board__endgame-line[data-endgame-status="seki"]')).not.toHaveCount(0);

  await classifyPoint(page, '0,1', 'Dead');
  await classifyPoint(page, '1,0', 'Seki');
  await classifyPoint(page, '2,1', 'Alive');
  await classifyPoint(page, '1,2', 'Alive');

  await expect(page.getByText('Classified 5 of 5')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Calculate final score' })).toBeEnabled();
  await page.getByRole('button', { name: 'Calculate final score' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Chinese', { exact: true })).toBeVisible();
  await expect(dialog.getByText('9×9', { exact: true })).toBeVisible();
  await expect(
    dialog.getByText('Black stones captured by White').locator('..').getByText('1', { exact: true }),
  ).toBeVisible();

  await dialog.getByRole('button', { name: 'Close game result' }).click();
  await expect(page.getByRole('button', { name: 'Game result' })).toBeVisible();
  await page.getByRole('button', { name: 'Game result' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close game result' }).click();

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('White to move')).toBeVisible();
  await expect(page.getByText('Move 9')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pass (1)', exact: true })).toBeVisible();
  await expectNoLegacyPassState(page);
  await expect(page.getByLabel('Black stones captured: 1')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Game result' })).toHaveCount(0);
});

test('board input, persistence and restore work through the browser UI', async ({ page }) => {
  await startGame(page, { size: '19', rules: 'japanese', komi: '5.5' });

  const board = page.getByRole('img', { name: '19 by 19 repeating torus Go board' });
  await expect(board).toBeVisible();
  await board.click();

  await expect(page.getByText('White to move')).toBeVisible();
  await expect(page.getByText('Move 1')).toBeVisible();

  await board.click();
  await expect(page.locator('.game-feedback')).toHaveCount(0);
  await expect(page.getByText('White to move')).toBeVisible();
  await expect(page.getByText('Move 1')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Continue saved game?' })).toBeVisible();
  await expect(page.getByText(/19×19 · Japanese · Komi 5\.5 · Move 1/)).toBeVisible();

  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('White to move')).toBeVisible();
  await expect(page.getByText('19×19', { exact: true })).toBeVisible();
  await expect(page.getByText('Japanese rules')).toBeVisible();
  await expect(page.getByText('Komi 5.5')).toBeVisible();
});

test('Chinese game reaches result, can reopen it, and Undo restores play', async ({ page }) => {
  await startGame(page, { size: '9', rules: 'chinese', komi: '7.5' });

  await page.getByRole('button', { name: 'Pass' }).click();
  await expect(page.getByText('White to move')).toBeVisible();
  await waitForPassGuard(page);
  await page.getByRole('button', { name: 'Pass' }).click();

  await expect(page.getByRole('heading', { name: 'Manual endgame classification' })).toBeVisible();
  await expect(page.getByText('There are no stone groups to classify.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('White to move')).toBeVisible();
  await expect(page.getByText('Move 1')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pass (1)', exact: true })).toBeVisible();
  await expectNoLegacyPassState(page);

  await page.getByRole('button', { name: 'Pass' }).click();
  await expect(page.getByRole('heading', { name: 'Manual endgame classification' })).toBeVisible();
  await page.getByRole('button', { name: 'Calculate final score' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'White wins by 7.5' })).toBeVisible();
  await expect(dialog.getByRole('cell', { name: 'Area subtotal' })).toBeVisible();
  await expect(dialog.getByText('Chinese', { exact: true })).toBeVisible();

  await dialog.getByRole('button', { name: 'Close game result' }).click();
  await expect(page.getByRole('button', { name: 'Game result' })).toBeVisible();
  await page.getByRole('button', { name: 'Game result' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close game result' }).click();

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('White to move')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Game result' })).toHaveCount(0);
});

test('Japanese scoring completes with the selected board size and komi', async ({ page }) => {
  await startGame(page, { size: '13', rules: 'japanese', komi: '6.5' });

  await page.getByRole('button', { name: 'Pass' }).click();
  await waitForPassGuard(page);
  await page.getByRole('button', { name: 'Pass' }).click();
  await page.getByRole('button', { name: 'Calculate final score' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'White wins by 6.5' })).toBeVisible();
  await expect(dialog.getByRole('cell', { name: 'Prisoners' })).toBeVisible();
  await expect(dialog.getByText('13×13', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Japanese', { exact: true })).toBeVisible();
});

test('corrupted local save is discarded without blocking startup', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('gocube:game:current', '{broken-json');
  });

  await page.goto('/');
  await expect(page.getByTestId('new-game-settings-grid')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('gocube:game:current'))).toBeNull();
});
