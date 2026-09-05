import { expect, test, type Locator, type Page } from '@playwright/test';
import { TorusTopology } from '../src/core/topology/TorusTopology';
import { EndgameTestLab } from '../src/core/endgame/testlab/EndgameTestLab';

const torusPoint = (page: Page, logicalPointId: string): Locator =>
  page.locator(
    `.torus-board__hit-target[data-logical-point-id="${logicalPointId}"][data-copy-role="primary"]`,
  );

test('final proof search keeps the browser event loop responsive while final analysis is visible', async ({ page }) => {
  const topology = new TorusTopology(9);
  const fixture = new EndgameTestLab().generate({
    kind: 'endgame-position',
    topology,
    seed: 'final-proof-bench:torus9',
    maxMoves: 72,
  });
  const placements = fixture.commands.filter(
    (command): command is Extract<(typeof fixture.commands)[number], { type: 'place-stone' }> =>
      command.type === 'place-stone',
  );
  expect(placements.length).toBeGreaterThan(20);

  await page.goto('/');
  await page.getByLabel('Board size').selectOption('9');
  await page.getByRole('button', { name: 'Start game' }).click();

  for (const command of placements) {
    await torusPoint(page, command.point).click();
  }

  const undo = page.getByRole('button', { name: 'Undo' });
  await expect(undo).toBeEnabled();
  await page.getByRole('button', { name: 'Pass', exact: true }).click();
  const secondPass = page.getByRole('button', { name: 'Pass (1)' });
  await expect(secondPass).toBeEnabled({ timeout: 2_500 });

  await page.evaluate(() => {
    const probe = { frames: 0, ticks: 0, running: true };
    const probeWindow = window as Window & {
      __finalProofProbe?: typeof probe;
    };
    probeWindow.__finalProofProbe = probe;
    const frame = (): void => {
      if (!probe.running) return;
      probe.frames += 1;
      window.requestAnimationFrame(frame);
    };
    window.requestAnimationFrame(frame);
    window.setInterval(() => {
      if (probe.running) probe.ticks += 1;
    }, 10);
  });

  await secondPass.click();
  const analysisStatus = page.getByText('Analyzing final position…', { exact: true });
  await expect(analysisStatus).toBeVisible({ timeout: 1_500 });
  await expect(page.getByRole('button', { name: /^Pass/ })).toBeDisabled();
  await expect(undo).toBeDisabled();
  await expect(page.getByRole('button', { name: 'New game' })).toBeDisabled();

  const before = await page.evaluate(() => {
    const probe = (window as Window & {
      __finalProofProbe?: { frames: number; ticks: number; running: boolean };
    }).__finalProofProbe;
    if (!probe) throw new Error('Missing Final Proof Search responsiveness probe');
    return { frames: probe.frames, ticks: probe.ticks };
  });

  await page.waitForTimeout(150);

  const after = await page.evaluate(() => {
    const probe = (window as Window & {
      __finalProofProbe?: { frames: number; ticks: number; running: boolean };
    }).__finalProofProbe;
    if (!probe) throw new Error('Missing Final Proof Search responsiveness probe');
    return { frames: probe.frames, ticks: probe.ticks };
  });
  expect(after.frames - before.frames).toBeGreaterThanOrEqual(2);
  expect(after.ticks - before.ticks).toBeGreaterThanOrEqual(2);
  await expect(analysisStatus).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Assisted endgame review' })).toBeVisible({
    timeout: 7_000,
  });
  await expect(analysisStatus).toHaveCount(0);

  await page.evaluate(() => {
    const probe = (window as Window & {
      __finalProofProbe?: { frames: number; ticks: number; running: boolean };
    }).__finalProofProbe;
    if (probe) probe.running = false;
  });
});
