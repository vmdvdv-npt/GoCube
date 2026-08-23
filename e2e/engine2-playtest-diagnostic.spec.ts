import { expect, test, type Locator, type Page } from '@playwright/test';

const cubeHit = (page: Page, logicalPointId: string): Locator =>
  page.locator(`.cube-2d-hit-area[data-point-id="${logicalPointId}"]`);

test('Engine 2 diagnostic runs on a selected real endgame group without changing its review status', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cube', exact: true }).click();
  await page.getByRole('button', { name: '2×2', exact: true }).click();
  await page.getByRole('button', { name: 'Start game' }).click();

  await cubeHit(page, 'front:0:0').click();
  await cubeHit(page, 'right:1:1').click();
  await page.getByRole('button', { name: 'Pass' }).click();
  await page.getByRole('button', { name: 'Pass (1)' }).click();
  await expect(page.getByRole('heading', { name: 'Assisted endgame review' })).toBeVisible();

  await cubeHit(page, 'front:0:0').click();
  const statusControl = page.getByTestId('endgame-group-control');
  await expect(statusControl).toBeVisible();
  const pressedBefore = await statusControl.locator('button[aria-pressed="true"]').count();

  const diagnostic = page.getByTestId('engine2-playtest-diagnostic');
  await expect(diagnostic).toBeVisible();
  await expect(diagnostic).toContainText('Diagnostic only · does not change scoring');
  await diagnostic.getByRole('button', { name: 'Analyze selected group' }).click();

  await expect(diagnostic.locator('.engine2-playtest-diagnostic__verdict')).toHaveText(
    /^(PROVEN DEAD|PROVEN ALIVE|PROVEN SEKI|FIRST-PLAYER DEPENDENT|KO DEPENDENT|BUDGET EXHAUSTED|UNRESOLVED)$/,
    { timeout: 15_000 },
  );
  await expect(diagnostic).toContainText('Attacker first');
  await expect(diagnostic).toContainText('Defender first');
  await expect(diagnostic).toContainText('Eye space');
  await expect(diagnostic).toContainText('Semeai / seki');

  expect(await statusControl.locator('button[aria-pressed="true"]').count()).toBe(pressedBefore);
});
