import { expect, test } from '@playwright/test';

const checkpoint = {
  id: 'torus9-panel-e2e',
  runName: 'torus9-panel-e2e',
  iteration: 93,
  topology: 'torus',
  size: 9,
  ruleSet: 'chinese',
  komi: 0.5,
  lineageStatus: 'ACTIVE',
} as const;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

test('Play vs bot launcher is a four-zone panel and starts with the selected model', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Play vs bot panel acceptance is a Chromium gate.');

  await page.route('http://127.0.0.1:8765/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }

    if (url.pathname === '/v1/health') {
      await route.fulfill({
        status: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          protocolVersion: 1,
          status: 'ok',
          service: 'gocube-alphazero',
          device: 'test',
          capabilities: { generateGame: true, selectMove: true },
        }),
      });
      return;
    }

    if (url.pathname === '/v1/checkpoints') {
      await route.fulfill({
        status: 200,
        headers: corsHeaders,
        body: JSON.stringify({ protocolVersion: 1, checkpoints: [checkpoint] }),
      });
      return;
    }

    await route.fulfill({ status: 404, headers: corsHeaders, body: '{}' });
  });

  await page.goto('/');
  await page.getByLabel('Rules').selectOption('chinese');
  await page.getByLabel('Komi').fill('0.5');

  const panel = page.locator('.play-vs-bot-card');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Play as' })).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Difficulty' })).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Model' })).toBeVisible();

  const black = panel.getByRole('button', { name: 'Black', exact: true });
  await expect(black).toHaveAttribute('aria-pressed', 'true');

  const mcts = panel.getByLabel('MCTS simulations');
  await expect(mcts).toHaveValue('128');
  await mcts.fill('0');
  await expect(panel.getByRole('button', { name: 'Choose model', exact: true })).toBeDisabled();
  await expect(panel.getByRole('button', { name: 'Play vs bot', exact: true })).toBeDisabled();
  await mcts.fill('128');

  await panel.getByRole('button', { name: 'Choose model', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'AlphaZero' });
  await expect(dialog.getByText('Connected', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Bot checkpoint')).toHaveValue(checkpoint.id);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();

  await expect(panel.getByRole('button', { name: 'M93 · Torus 9×9', exact: true })).toBeVisible();
  const play = panel.getByRole('button', { name: 'Play vs bot', exact: true });
  await expect(play).toBeEnabled();
  await play.click();

  await expect(page.locator('.torus-game')).toBeVisible();
});
