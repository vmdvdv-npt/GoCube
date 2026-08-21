import type { StoneColor } from '../core/game/types';

const SVG_NS = 'http://www.w3.org/2000/svg';
const STONE_ARTWORK_SELECTOR = [
  '.torus-board__stone',
  '.torus-board__captured-stone',
  '.torus-board__preview-stone',
].join(', ');
const FORBIDDEN_MARKER_SELECTOR = '.torus-board__forbidden-marker';
const HIT_TARGET_SELECTOR = '.torus-board__hit-target';

interface StoneArtworkIds {
  readonly blackPatternId: string;
  readonly whitePatternId: string;
}

let stoneArtworkInstanceCounter = 0;
const stoneArtworkIdsBySvg = new WeakMap<SVGSVGElement, StoneArtworkIds>();
const dynamicOverlayObserversBySvg = new WeakMap<SVGSVGElement, MutationObserver>();

const setAttributes = (element: Element, attributes: Readonly<Record<string, string>>): void => {
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
};

const appendStop = (
  gradient: SVGRadialGradientElement,
  offset: string,
  color: string,
): void => {
  const stop = gradient.ownerDocument.createElementNS(SVG_NS, 'stop');
  setAttributes(stop, { offset, 'stop-color': color });
  gradient.appendChild(stop);
};

const appendStonePaint = (
  defs: SVGDefsElement,
  color: StoneColor,
  gradientId: string,
  patternId: string,
): void => {
  const document = defs.ownerDocument;
  const gradient = document.createElementNS(SVG_NS, 'radialGradient');
  setAttributes(gradient, {
    id: gradientId,
    cx: '35%',
    cy: '25%',
    r: '70%',
  });

  if (color === 'black') {
    appendStop(gradient, '0', '#555');
    appendStop(gradient, '0.35', '#111');
    appendStop(gradient, '1', '#000');
  } else {
    appendStop(gradient, '0', '#fff');
    appendStop(gradient, '0.45', '#eee');
    appendStop(gradient, '1', '#cfcfcf');
  }
  defs.appendChild(gradient);

  const pattern = document.createElementNS(SVG_NS, 'pattern');
  setAttributes(pattern, {
    id: patternId,
    x: '0',
    y: '0',
    width: '1',
    height: '1',
    patternUnits: 'objectBoundingBox',
    viewBox: '16 16 224 224',
    preserveAspectRatio: 'xMidYMid meet',
  });

  const body = document.createElementNS(SVG_NS, 'circle');
  setAttributes(body, {
    cx: '128',
    cy: '128',
    r: '112',
    fill: `url(#${gradientId})`,
  });
  pattern.appendChild(body);

  const highlight = document.createElementNS(SVG_NS, 'ellipse');
  setAttributes(highlight, {
    cx: '96',
    cy: '72',
    rx: '24',
    ry: '14',
    fill: '#fff',
    opacity: color === 'black' ? '0.18' : '0.65',
  });
  pattern.appendChild(highlight);
  defs.appendChild(pattern);
};

const ensureStoneArtwork = (svg: SVGSVGElement): StoneArtworkIds => {
  let ids = stoneArtworkIdsBySvg.get(svg);
  if (!ids) {
    const prefix = `torus-stone-artwork-${stoneArtworkInstanceCounter}`;
    stoneArtworkInstanceCounter += 1;
    ids = Object.freeze({
      blackPatternId: `${prefix}-black`,
      whitePatternId: `${prefix}-white`,
    });
    stoneArtworkIdsBySvg.set(svg, ids);
  }

  const existing = svg.querySelector('defs[data-torus-stone-artwork="true"]');
  if (existing) return ids;

  const defs = svg.ownerDocument.createElementNS(SVG_NS, 'defs');
  defs.setAttribute('data-torus-stone-artwork', 'true');
  defs.setAttribute('pointer-events', 'none');
  appendStonePaint(defs, 'black', `${ids.blackPatternId}-gradient`, ids.blackPatternId);
  appendStonePaint(defs, 'white', `${ids.whitePatternId}-gradient`, ids.whitePatternId);
  svg.insertBefore(defs, svg.firstChild);
  return ids;
};

const stoneColor = (stone: SVGCircleElement): StoneColor | null => {
  const occupancy = stone.getAttribute('data-occupancy');
  if (occupancy === 'black' || occupancy === 'white') return occupancy;
  if (stone.classList.contains('torus-board__preview-stone--black')) return 'black';
  if (stone.classList.contains('torus-board__preview-stone--white')) return 'white';
  return null;
};

const applyStoneArtworkToCircle = (
  stone: SVGCircleElement,
  ids: StoneArtworkIds,
): void => {
  const color = stoneColor(stone);
  if (!color) return;

  stone.setAttribute(
    'fill',
    `url(#${color === 'black' ? ids.blackPatternId : ids.whitePatternId})`,
  );
  stone.setAttribute('stroke', 'none');
  stone.removeAttribute('stroke-width');
  stone.setAttribute('data-stone-artwork', 'custom-svg');
};

const stoneCirclesWithin = (root: Element): readonly SVGCircleElement[] => {
  const stones: SVGCircleElement[] = [];
  if (root.matches(STONE_ARTWORK_SELECTOR)) stones.push(root as SVGCircleElement);
  stones.push(...root.querySelectorAll<SVGCircleElement>(STONE_ARTWORK_SELECTOR));
  return stones;
};

const forbiddenMarkersWithin = (root: Element): readonly SVGCircleElement[] => {
  const markers: SVGCircleElement[] = [];
  if (root.matches(FORBIDDEN_MARKER_SELECTOR)) markers.push(root as SVGCircleElement);
  markers.push(...root.querySelectorAll<SVGCircleElement>(FORBIDDEN_MARKER_SELECTOR));
  return markers;
};

const snapForbiddenMarkerToIntersection = (
  svg: SVGSVGElement,
  marker: SVGCircleElement,
): void => {
  const logicalPointId = marker.getAttribute('data-logical-point-id');
  const markerX = Number(marker.getAttribute('cx'));
  const markerY = Number(marker.getAttribute('cy'));
  if (!logicalPointId || !Number.isFinite(markerX) || !Number.isFinite(markerY)) return;

  let closestTarget: SVGCircleElement | null = null;
  let closestDistanceSquared = Number.POSITIVE_INFINITY;
  for (const target of svg.querySelectorAll<SVGCircleElement>(HIT_TARGET_SELECTOR)) {
    if (target.getAttribute('data-logical-point-id') !== logicalPointId) continue;

    const targetX = Number(target.getAttribute('cx'));
    const targetY = Number(target.getAttribute('cy'));
    if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) continue;

    const distanceSquared = (markerX - targetX) ** 2 + (markerY - targetY) ** 2;
    if (distanceSquared >= closestDistanceSquared) continue;

    closestTarget = target;
    closestDistanceSquared = distanceSquared;
  }

  if (!closestTarget) return;
  const targetX = closestTarget.getAttribute('cx');
  const targetY = closestTarget.getAttribute('cy');
  if (targetX === null || targetY === null) return;

  marker.setAttribute('cx', targetX);
  marker.setAttribute('cy', targetY);
  marker.setAttribute('data-snapped-to-intersection', 'true');
};

const polishDynamicOverlayWithin = (
  svg: SVGSVGElement,
  root: Element,
  ids: StoneArtworkIds,
): void => {
  for (const stone of stoneCirclesWithin(root)) applyStoneArtworkToCircle(stone, ids);
  for (const marker of forbiddenMarkersWithin(root)) snapForbiddenMarkerToIntersection(svg, marker);
};

const ensureDynamicOverlayObserver = (
  svg: SVGSVGElement,
  ids: StoneArtworkIds,
): void => {
  if (dynamicOverlayObserversBySvg.has(svg)) return;

  const MutationObserverConstructor = svg.ownerDocument.defaultView?.MutationObserver;
  if (!MutationObserverConstructor) return;

  const observer = new MutationObserverConstructor((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        polishDynamicOverlayWithin(svg, node as Element, ids);
      }
    }
  });
  observer.observe(svg, { childList: true, subtree: true });
  dynamicOverlayObserversBySvg.set(svg, observer);
};

/**
 * Applies the supplied lightweight SVG artwork to the existing renderer circles.
 * Keeping the circle itself as the stone preserves move markers, move numbers,
 * placement/capture animations, dead-stone opacity and all existing selectors.
 *
 * Move previews are created after the normal annotation pass, so a small DOM observer
 * applies the same artwork to newly-created translucent previews. It also snaps the
 * forbidden marker to the nearest matching board intersection instead of leaving it
 * at the raw pointer coordinates.
 */
export const applyTorus2DStoneArtwork = (svg: SVGSVGElement): void => {
  const ids = ensureStoneArtwork(svg);
  polishDynamicOverlayWithin(svg, svg, ids);
  ensureDynamicOverlayObserver(svg, ids);
};
