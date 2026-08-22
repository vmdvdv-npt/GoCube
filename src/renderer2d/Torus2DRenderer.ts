export * from './Torus2DRendererBase';

import {
  Torus2DRenderer as BaseTorus2DRenderer,
  type Torus2DPanDirection,
  type Torus2DSize,
  type Torus2DViewState,
} from './Torus2DRendererBase';

/** Maximum number of navigation commands waiting behind the active Torus shift. */
export const TORUS_NAVIGATION_QUEUE_LIMIT = 6;

type StyledSvg = SVGSVGElement & Readonly<{ style?: CSSStyleDeclaration }>;
type AttributeReadableSvg = SVGSVGElement &
  Readonly<{ getAttribute?: (name: string) => string | null }>;

/**
 * Adds the product-level Torus navigation queue around the low-level renderer.
 * The base renderer remains responsible for one physical shift animation; this
 * adapter preserves every accepted arrow command in order and starts the next
 * shift only after the previous one has completed.
 */
export class Torus2DRenderer extends BaseTorus2DRenderer {
  private readonly navigationQueue: Torus2DPanDirection[] = [];
  private readonly navigationObserver: MutationObserver | null;
  private navigationBusy = false;
  private pointerEventsBeforeNavigation = '';

  constructor(
    private readonly navigationRoot: SVGSVGElement,
    size: Torus2DSize,
  ) {
    super(navigationRoot, size);

    navigationRoot.setAttribute('data-navigation-busy', 'false');
    navigationRoot.setAttribute('data-navigation-queue-length', '0');

    const Observer = navigationRoot.ownerDocument.defaultView?.MutationObserver;
    this.navigationObserver = Observer
      ? new Observer(() => this.handleAnimationStateChange())
      : null;
    this.navigationObserver?.observe(navigationRoot, {
      attributes: true,
      attributeFilter: ['data-pan-animating'],
    });
  }

  override pan(direction: Torus2DPanDirection): Torus2DViewState {
    // Unit-level renderer fakes deliberately expose only the minimal SVG surface.
    // Queueing is a browser interaction concern, so preserve the base synchronous
    // renderer contract when attribute reads are unavailable.
    if (!this.canReadAttributes()) return super.pan(direction);

    if (this.navigationBusy) {
      if (this.navigationQueue.length < TORUS_NAVIGATION_QUEUE_LIMIT) {
        this.navigationQueue.push(direction);
        this.syncNavigationAttributes();
      }
      return this.viewState();
    }

    this.navigationBusy = true;
    this.pointerEventsBeforeNavigation = this.style()?.pointerEvents ?? '';
    this.setPointerEvents('none');
    this.syncNavigationAttributes();

    const next = super.pan(direction);
    if (this.navigationRoot.getAttribute('data-pan-animating') !== 'true') {
      this.finishNavigationBurst();
    }
    return next;
  }

  private handleAnimationStateChange(): void {
    if (!this.navigationBusy || !this.canReadAttributes()) return;
    if (this.navigationRoot.getAttribute('data-pan-animating') === 'true') return;

    const nextDirection = this.navigationQueue.shift();
    if (!nextDirection) {
      this.finishNavigationBurst();
      return;
    }

    // Base renderer restores pointer-events at the end of each individual shift.
    // Keep gameplay input blocked across the whole queued navigation burst.
    this.setPointerEvents('none');
    this.syncNavigationAttributes();
    super.pan(nextDirection);
  }

  private finishNavigationBurst(): void {
    this.navigationQueue.length = 0;
    this.navigationBusy = false;
    this.setPointerEvents(this.pointerEventsBeforeNavigation);
    this.pointerEventsBeforeNavigation = '';
    this.syncNavigationAttributes();
  }

  private canReadAttributes(): boolean {
    return typeof (this.navigationRoot as AttributeReadableSvg).getAttribute === 'function';
  }

  private style(): CSSStyleDeclaration | undefined {
    return (this.navigationRoot as StyledSvg).style;
  }

  private setPointerEvents(value: string): void {
    const style = this.style();
    if (style) style.pointerEvents = value;
  }

  private syncNavigationAttributes(): void {
    this.navigationRoot.setAttribute(
      'data-navigation-busy',
      this.navigationBusy ? 'true' : 'false',
    );
    this.navigationRoot.setAttribute(
      'data-navigation-queue-length',
      String(this.navigationQueue.length),
    );
  }
}
