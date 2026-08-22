import { expect, test, type Locator, type Page } from '@playwright/test';

const cubeHit = (page: Page, pointId: string) =>
  page.locator(`.cube-2d-hit-area[data-point-id="${pointId}"]`);
