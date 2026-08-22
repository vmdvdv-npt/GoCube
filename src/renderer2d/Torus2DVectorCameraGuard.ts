const TORUS_SCENE_SIZE = 1000;

const expectedCameraViewBox = (svg: SVGSVGElement): string | null => {
  if (svg.getAttribute('data-vector-camera') !== 'viewBox') return null;

  const scale = Number(svg.getAttribute('data-vector-camera-scale'));
  if (!Number.isFinite(scale) || scale <= 0) return null;

  const span = TORUS_SCENE_SIZE / scale;
  const origin = (TORUS_SCENE_SIZE - span) / 2;
  return `${origin} ${origin} ${span} ${span}`;
};

const restoreVectorCamera = (svg: SVGSVGElement): void => {
  const expected = expectedCameraViewBox(svg);
  if (expected === null || svg.getAttribute('viewBox') === expected) return;
  svg.setAttribute('viewBox', expected);
};

/**
 * Torus2DRenderer owns the logical 0..1000 scene and still writes its legacy
 * default viewBox during parts of its render lifecycle. The application owns
 * user zoom. This guard makes that ownership boundary explicit: once the
 * application has installed a vector camera, a later renderer redraw may not
 * replace it with the legacy default camera.
 */
export const installTorus2DVectorCameraGuard = (root: Document = document): (() => void) => {
  const MutationObserverConstructor = root.defaultView?.MutationObserver;
  if (!MutationObserverConstructor) return () => undefined;

  const observer = new MutationObserverConstructor((records) => {
    for (const record of records) {
      if (record.type !== 'attributes' || record.attributeName !== 'viewBox') continue;
      const target = record.target;
      if (!(target instanceof SVGSVGElement) || !target.classList.contains('torus-board')) continue;
      restoreVectorCamera(target);
    }
  });

  observer.observe(root.documentElement, {
    attributes: true,
    attributeFilter: ['viewBox'],
    subtree: true,
  });

  return () => observer.disconnect();
};
