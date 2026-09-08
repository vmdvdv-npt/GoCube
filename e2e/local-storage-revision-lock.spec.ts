import { expect, test } from '@playwright/test';

test('LocalStorageGameRepository persists through the browser cross-tab lock boundary', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async () => {
    const module = await import('/src/app/persistence/LocalStorageGameRepository.ts');
    const repository = new module.LocalStorageGameRepository<{
      readonly sessionRevision: number;
      readonly marker: string;
    }>('e2e:revision-lock:');

    try {
      await repository.save({
        id: 'current',
        savedAt: '2026-09-08T00:00:00.000Z',
        state: { sessionRevision: 1, marker: 'browser-save' },
      });

      return {
        ok: true as const,
        secureContext: window.isSecureContext,
        hasWebLocks: Boolean(
          (navigator as Navigator & { readonly locks?: unknown }).locks,
        ),
        hasIndexedDb: typeof indexedDB !== 'undefined',
        stored: localStorage.getItem('e2e:revision-lock:current'),
      };
    } catch (error) {
      return {
        ok: false as const,
        secureContext: window.isSecureContext,
        hasWebLocks: Boolean(
          (navigator as Navigator & { readonly locks?: unknown }).locks,
        ),
        hasIndexedDb: typeof indexedDB !== 'undefined',
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      };
    }
  });

  expect(result, JSON.stringify(result)).toMatchObject({
    ok: true,
    secureContext: true,
  });
  if (result.ok) {
    expect(JSON.parse(result.stored ?? 'null')).toMatchObject({
      id: 'current',
      state: { sessionRevision: 1, marker: 'browser-save' },
    });
  }
});
