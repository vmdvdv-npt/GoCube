import type { StoneColor } from '../core/game/types';
import type { PointId } from '../core/topology/Topology';
import type { GameViewModel } from '../presentation/PresentationModel';

const SVG_NS = 'http://www.w3.org/2000/svg';
const ANNOTATION_CLASS = 'torus-board__stone-annotation';

const contrastColor = (color: StoneColor): string =>
  color === 'black' ? '#ffffff' : '#111111';

const pointMoveNumbers = (viewModel: GameViewModel): ReadonlyMap<PointId, number> =>
  new Map(
    viewModel.points.flatMap((point) =>
      point.occupancy !== 'empty' && typeof point.moveNumber === 'number'
        ? [[point.logicalPointId, point.moveNumber] as const]
        : [],
    ),
  );

const directStoneCircles = (stoneLayer: Element): readonly SVGCircleElement[] =>
  Array.from(stoneLayer.children).filter(
    (child): child is SVGCircleElement =>
      child instanceof SVGElement && child.classList.contains('torus-board__stone'),
  );

/**
 * Adds renderer-only annotations to every visible stone copy. The function works
 * for both the normal board and the temporary pan-transition stone layers.
 */
export const renderTorus2DStoneAnnotations = (
  svg: SVGSVGElement,
  viewModel: GameViewModel,
  showMoveNumbers: boolean,
): void => {
  const moveNumbers = pointMoveNumbers(viewModel);
  const lastMovePointId = viewModel.lastMovePointId ?? null;

  for (const stoneLayer of svg.querySelectorAll('.torus-board__stones')) {
    for (const existing of stoneLayer.querySelectorAll(`.${ANNOTATION_CLASS}`)) {
      existing.remove();
    }

    for (const stone of directStoneCircles(stoneLayer)) {
      const logicalPointId = stone.getAttribute('data-logical-point-id');
      const occupancy = stone.getAttribute('data-occupancy') as StoneColor | null;
      const cx = stone.getAttribute('cx');
      const cy = stone.getAttribute('cy');
      const radius = Number(stone.getAttribute('r'));
      if (!logicalPointId || !occupancy || !cx || !cy || !Number.isFinite(radius)) continue;

      if (logicalPointId === lastMovePointId) {
        const marker = svg.ownerDocument.createElementNS(SVG_NS, 'circle');
        marker.setAttribute('cx', cx);
        marker.setAttribute('cy', cy);
        marker.setAttribute('r', String(Math.max(2.5, radius * 0.16)));
        marker.setAttribute('fill', contrastColor(occupancy));
        marker.setAttribute('pointer-events', 'none');
        marker.setAttribute('data-logical-point-id', logicalPointId);
        marker.setAttribute('data-last-move-marker', 'true');
        marker.setAttribute('class', `${ANNOTATION_CLASS} torus-board__last-move-marker`);
        stoneLayer.appendChild(marker);
        continue;
      }

      if (!showMoveNumbers) continue;
      const moveNumber = moveNumbers.get(logicalPointId);
      if (moveNumber === undefined) continue;

      const label = svg.ownerDocument.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', cx);
      label.setAttribute('y', cy);
      label.setAttribute('fill', contrastColor(occupancy));
      label.setAttribute('font-size', String(Math.max(8, radius * 0.72)));
      label.setAttribute('font-weight', '700');
      label.setAttribute('font-family', 'system-ui, sans-serif');
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('dominant-baseline', 'central');
      label.setAttribute('pointer-events', 'none');
      label.setAttribute('data-logical-point-id', logicalPointId);
      label.setAttribute('data-move-number', String(moveNumber));
      label.setAttribute('class', `${ANNOTATION_CLASS} torus-board__move-number`);
      label.textContent = String(moveNumber);
      stoneLayer.appendChild(label);
    }
  }
};
