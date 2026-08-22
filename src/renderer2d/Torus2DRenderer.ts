export * from './Torus2DRendererBase';

import type { GameViewModel } from '../presentation/PresentationModel';
import {
  Torus2DRenderer as BaseTorus2DRenderer,
  buildTorus2DEndgameSegments,
  buildTorus2DScene,
  endgameGroupFromTorusViewBoxPosition,
  endgameLineStyle,
  TORUS_ENDGAME_LINE_WIDTH_PX,
  type Torus2DEndgameOverlay,
  type Torus2DEndgameSegment,
  type Torus2DScene,
  type Torus2DSize,
  type Torus2DViewState,
} from './Torus2DRendererBase';

const SVG_NS = 'http://www.w3.org/2000/svg';
const EMPTY_ENDGAME_SEGMENTS: readonly Torus2DEndgameSegment[] = Object.freeze([]);

const sameViewState = (
  left: Torus2DViewState | null,
  right: Torus2DViewState,
): boolean =>
  left?.offsetX === right.offsetX && left.offsetY === right.offsetY;

const setAttributes = (
  element: Element,
  attributes: Readonly<Record<string, string>>,
): void => {
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
};

/**
 * Product-level Torus adapter.
 *
 * The base renderer already ignores navigation requests while a shift animation
 * is active, so this adapter deliberately does not queue arrow commands.
 *
 * Endgame hover/selection changes are presentation-only. Rebuilding the entire
 * SVG for those changes can replace a hit target between pointer-down and click
 * in Chromium/WebKit, so the adapter updates only the endgame overlay while the
 * board, stones and hit targets remain stable.
 */
export class Torus2DRenderer extends BaseTorus2DRenderer {
  private latestViewModel: GameViewModel | null = null;
  private latestScene: Torus2DScene | null = null;
  private renderedViewState: Torus2DViewState | null = null;
  private duplicateRegionsVisibleState = false;
  private renderedDuplicateRegionsVisible = false;
  private overlayState: Torus2DEndgameOverlay | null = null;
  private overlaySegments: readonly Torus2DEndgameSegment[] = EMPTY_ENDGAME_SEGMENTS;

  constructor(
    private readonly navigationRoot: SVGSVGElement,
    size: Torus2DSize,
  ) {
    super(navigationRoot, size);
    navigationRoot.setAttribute('data-navigation-busy', 'false');
    navigationRoot.setAttribute('data-navigation-queue-length', '0');
  }

  override setDuplicateRegionsVisible(visible: boolean): void {
    this.duplicateRegionsVisibleState = visible;
    super.setDuplicateRegionsVisible(visible);
  }

  override setEndgameOverlay(overlay: Torus2DEndgameOverlay | null): void {
    this.overlayState = overlay;
    super.setEndgameOverlay(overlay);
    this.refreshEndgameSegments();
    this.renderEndgameOverlay();
  }

  override render(viewModel: GameViewModel): void {
    const currentViewState = this.viewState();
    const coreSceneIsCurrent =
      this.latestViewModel === viewModel &&
      sameViewState(this.renderedViewState, currentViewState) &&
      this.renderedDuplicateRegionsVisible === this.duplicateRegionsVisibleState;

    if (coreSceneIsCurrent) {
      return;
    }

    super.render(viewModel);
    this.latestViewModel = viewModel;
    this.renderedViewState = this.viewState();
    this.renderedDuplicateRegionsVisible = this.duplicateRegionsVisibleState;
    this.latestScene = buildTorus2DScene(
      viewModel,
      this.size,
      this.renderedViewState,
      this.duplicateRegionsVisibleState,
    );
    this.refreshEndgameSegments();
  }

  override endgameGroupFromClientPosition(x: number, y: number): string | null {
    const scene = this.latestScene;
    if (!scene) return super.endgameGroupFromClientPosition(x, y);

    const bounds = this.navigationRoot.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return null;

    return endgameGroupFromTorusViewBoxPosition(
      this.overlaySegments,
      ((x - bounds.left) / bounds.width) * scene.viewBoxSize,
      ((y - bounds.top) / bounds.height) * scene.viewBoxSize,
    );
  }

  private refreshEndgameSegments(): void {
    const scene = this.latestScene;
    const overlay = this.overlayState;
    this.overlaySegments =
      scene && overlay
        ? buildTorus2DEndgameSegments(scene, overlay)
        : EMPTY_ENDGAME_SEGMENTS;
  }

  private renderEndgameOverlay(): void {
    if (!this.latestScene) return;
    if (this.navigationRoot.getAttribute('data-pan-animating') === 'true') return;
    if (typeof this.navigationRoot.querySelector !== 'function') return;

    this.navigationRoot.querySelector('.torus-board__endgame-lines')?.remove();
    if (this.overlaySegments.length === 0) return;

    const document = this.navigationRoot.ownerDocument;
    const endgameLines = document.createElementNS(SVG_NS, 'g');
    endgameLines.setAttribute('class', 'torus-board__endgame-lines');

    for (const segment of this.overlaySegments) {
      const style = endgameLineStyle(
        segment.status,
        segment.groupColor,
        segment.temporary,
      );
      const line = document.createElementNS(SVG_NS, 'line');
      const attributes: Record<string, string> = {
        x1: String(segment.x1),
        y1: String(segment.y1),
        x2: String(segment.x2),
        y2: String(segment.y2),
        stroke: style.stroke,
        'stroke-width': String(TORUS_ENDGAME_LINE_WIDTH_PX),
        'stroke-linecap': 'butt',
        'vector-effect': 'non-scaling-stroke',
        'pointer-events': 'none',
        opacity: String(style.opacity),
        'data-endgame-group-id': segment.groupId,
        'data-endgame-status': segment.status ?? 'preview',
        'data-endgame-temporary': segment.temporary ? 'true' : 'false',
        class: 'torus-board__endgame-line',
      };
      if (style.strokeDasharray) {
        attributes['stroke-dasharray'] = style.strokeDasharray;
      }
      setAttributes(line, attributes);
      endgameLines.appendChild(line);
    }

    this.navigationRoot.appendChild(endgameLines);
  }
}
