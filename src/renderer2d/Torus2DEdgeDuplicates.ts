export {
  TORUS_EDGE_DUPLICATE_GRID_DASH,
  TORUS_EDGE_DUPLICATE_STONE_OPACITY,
  isTorus2DPrimaryBoardClientPosition,
} from './Torus2DEdgeDuplicatesBase';

import type { GameViewModel } from '../presentation/PresentationModel';
import type { Torus2DSize, Torus2DViewState } from './Torus2DRenderer';
import {
  renderTorus2DEdgeDuplicates as renderBaseTorus2DEdgeDuplicates,
} from './Torus2DEdgeDuplicatesBase';

type DeferredDuplicateRender = Readonly<{
  viewModel: GameViewModel;
  size: Torus2DSize;
  viewState: Torus2DViewState;
  visible: boolean;
  observer: MutationObserver | null;
}>;

const deferredRenders = new WeakMap<SVGSVGElement, DeferredDuplicateRender>();

/**
 * Keeps duplicate-region visual changes stable while a Torus navigation burst is
 * active. The checkbox may change immediately, but only the final requested state
 * is rendered once the active shift and its queued shifts are fully complete.
 */
export const renderTorus2DEdgeDuplicates = (
  svg: SVGSVGElement,
  viewModel: GameViewModel,
  size: Torus2DSize,
  viewState: Torus2DViewState,
  visible: boolean,
): void => {
  if (svg.getAttribute('data-navigation-busy') !== 'true') {
    deferredRenders.get(svg)?.observer?.disconnect();
    deferredRenders.delete(svg);
    renderBaseTorus2DEdgeDuplicates(svg, viewModel, size, viewState, visible);
    return;
  }

  svg.setAttribute('data-duplicate-regions-requested', visible ? 'true' : 'false');
  const previous = deferredRenders.get(svg);
  previous?.observer?.disconnect();

  const Observer = svg.ownerDocument.defaultView?.MutationObserver;
  const observer = Observer
    ? new Observer(() => {
        if (svg.getAttribute('data-navigation-busy') === 'true') return;
        const pending = deferredRenders.get(svg);
        pending?.observer?.disconnect();
        deferredRenders.delete(svg);
        if (!pending) return;
        renderBaseTorus2DEdgeDuplicates(
          svg,
          pending.viewModel,
          pending.size,
          pending.viewState,
          pending.visible,
        );
      })
    : null;

  deferredRenders.set(
    svg,
    Object.freeze({ viewModel, size, viewState, visible, observer }),
  );
  observer?.observe(svg, {
    attributes: true,
    attributeFilter: ['data-navigation-busy'],
  });
};
