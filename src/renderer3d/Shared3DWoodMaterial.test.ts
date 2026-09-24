import { afterEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createShared3DWoodMaterial } from './Shared3DWoodMaterial';

const installWindowTimers = (): void => {
  vi.stubGlobal('window', {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  });
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('waits for the walnut texture before reporting ready and reports only once', () => {
  vi.useFakeTimers();
  installWindowTimers();

  let finishLoad: ((texture: THREE.Texture) => void) | undefined;
  const walnut = new THREE.Texture();
  vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation(
    (_url, onLoad) => {
      finishLoad = onLoad;
      return walnut;
    },
  );

  const onReady = vi.fn();
  const material = createShared3DWoodMaterial(onReady, 8);

  expect(material.map).toBeInstanceOf(THREE.DataTexture);
  expect(onReady).not.toHaveBeenCalled();

  finishLoad?.(walnut);

  expect(material.map).toBe(walnut);
  expect(onReady).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(3_000);
  expect(onReady).toHaveBeenCalledTimes(1);

  material.dispose();
});

it('uses the bounded readiness fallback when TextureLoader stays silent', () => {
  vi.useFakeTimers();
  installWindowTimers();

  vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation(
    () => new THREE.Texture(),
  );

  const onReady = vi.fn();
  const material = createShared3DWoodMaterial(onReady, 4);

  vi.advanceTimersByTime(2_999);
  expect(onReady).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(onReady).toHaveBeenCalledTimes(1);

  material.dispose();
  vi.advanceTimersByTime(3_000);
  expect(onReady).toHaveBeenCalledTimes(1);
});
