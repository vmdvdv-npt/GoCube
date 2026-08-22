import type { ReactElement } from 'react';
import type { StoneColor } from '../core/game/types';

const SVG_NS = 'http://www.w3.org/2000/svg';
const TORUS_STONE_SELECTOR = [
  '.torus-board__stone',
  '.torus-board__captured-stone',
  '.torus-board__preview-stone',
].join(', ');
const FORBIDDEN_MARKER_SELECTOR = '.torus-board__forbidden-marker';
const HIT_TARGET_SELECTOR = '.torus-board__hit-target';

export const SHARED_STONE_ARTWORK = Object.freeze({
  gradient: Object.freeze({ cx: '35%', cy: '25%', r: '70%' }),
  blackStops: Object.freeze([
    Object.freeze({ offset: '0', color: '#555' }),
    Object.freeze({ offset: '0.35', color: '#111' }),
    Object.freeze({ offset: '1', color: '#000' }),
  ]),
  whiteStops: Object.freeze([
    Object.freeze({ offset: '0', color: '#fff' }),
    Object.freeze({ offset: '0.45', color: '#eee' }),
    Object.freeze({ offset: '1', color: '#cfcfcf' }),
  ]),
  patternViewBox: '16 16 224 224',
  body: Object.freeze({ cx: 128, cy: 128, r: 112 }),
  highlight: Object.freeze({ cx: 96, cy: 72, rx: 24, ry: 14, fill: '#fff' }),
  highlightOpacity: Object.freeze({ black: 0.18, white: 0.65 }),
});

export interface StoneArtworkIds {
  readonly blackGradientId: string;
  readonly whiteGradientId: string;
  readonly blackPatternId: string;
  readonly whitePatternId: string;
}

export const stoneArtworkIds = (prefix: string): StoneArtworkIds =>
  Object.freeze({
    blackGradientId: `${prefix}-black-gradient`,
    whiteGradientId: `${prefix}-white-gradient`,
    blackPatternId: `${prefix}-black`,
    whitePatternId: `${prefix}-white`,
  });

export const stoneArtworkFill = (prefix: string, color: StoneColor): string => {
  const ids = stoneArtworkIds(prefix);
  return `url(#${color === 'black' ? ids.blackPatternId : ids.whitePatternId})`;
};

const stopsFor = (color: StoneColor) =>
  color === 'black' ? SHARED_STONE_ARTWORK.blackStops : SHARED_STONE_ARTWORK.whiteStops;

const paintPattern = (
  ids: StoneArtworkIds,
  color: StoneColor,
): ReactElement => {
  const gradientId = color === 'black' ? ids.blackGradientId : ids.whiteGradientId;
  const patternId = color === 'black' ? ids.blackPatternId : ids.whitePatternId;
  return (
    <>
      <radialGradient
        id={gradientId}
        cx={SHARED_STONE_ARTWORK.gradient.cx}
        cy={SHARED_STONE_ARTWORK.gradient.cy}
        r={SHARED_STONE_ARTWORK.gradient.r}
      >
        {stopsFor(color).map((stop) => (
          <stop key={`${color}:${stop.offset}`} offset={stop.offset} stopColor={stop.color} />
        ))}
      </radialGradient>
      <pattern
        id={patternId}
        x="0"
        y="0"
        width="1"
        height="1"
        patternUnits="objectBoundingBox"
        viewBox={SHARED_STONE_ARTWORK.patternViewBox}
        preserveAspectRatio="xMidYMid meet"
      >
        <circle
          cx={SHARED_STONE_ARTWORK.body.cx}
          cy={SHARED_STONE_ARTWORK.body.cy}
          r={SHARED_STONE_ARTWORK.body.r}
          fill={`url(#${gradientId})`}
        />
        <ellipse
          cx={SHARED_STONE_ARTWORK.highlight.cx}
          cy={SHARED_STONE_ARTWORK.highlight.cy}
          rx={SHARED_STONE_ARTWORK.highlight.rx}
          ry={SHARED_STONE_ARTWORK.highlight.ry}
          fill={SHARED_STONE_ARTWORK.highlight.fill}
          opacity={SHARED_STONE_ARTWORK.highlightOpacity[color]}
        />
      </pattern>
    </>
  );
};

export function StoneArtworkDefs({ idPrefix }: { readonly idPrefix: string }): ReactElement {
  const ids = stoneArtworkIds(idPrefix);
  return (
    <defs aria-hidden="true" data-stone-artwork-defs="shared-svg">
      {paintPattern(ids, 'black')}
      {paintPattern(ids, 'white')}
    </defs>
  );
}

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
    cx: SHARED_STONE_ARTWORK.gradient.cx,
    cy: SHARED_STONE_ARTWORK.gradient.cy,
    r: SHARED_STONE_ARTWORK.gradient.r,
  });
  for (const stop of stopsFor(color)) appendStop(gradient, stop.offset, stop.color);
  defs.appendChild(gradient);

  const pattern = document.createElementNS(SVG_NS, 'pattern');
  setAttributes(pattern, {
    id: patternId,
    x: '0',
    y: '0',
    width: '1',
    height: '1',
    patternUnits: 'objectBoundingBox',
    viewBox: SHARED_STONE_ARTWORK.patternViewBox,
    preserveAspectRatio: 'xMidYMid meet',
  });

  const body = document.createElementNS(SVG_NS, 'circle');
  setAttributes(body, {
    cx: String(SHARED_STONE_ARTWORK.body.cx),
    cy: String(SHARED_STONE_ARTWORK.body.cy),
    r: String(SHARED_STONE_ARTWORK.body.r),
    fill: `url(#${gradientId})`,
  });
  pattern.appendChild(body);

  const highlight = document.createElementNS(SVG_NS, 'ellipse');
  setAttributes(highlight, {
    cx: String(SHARED_STONE_ARTWORK.highlight.cx),
    cy: String(SHARED_STONE_ARTWORK.highlight.cy),
    rx: String(SHARED_STONE_ARTWORK.highlight.rx),
    ry: String(SHARED_STONE_ARTWORK.highlight.ry),
    fill: SHARED_STONE_ARTWORK.highlight.fill,
    opacity: String(SHARED_STONE_ARTWORK.highlightOpacity[color]),
  });
  pattern.appendChild(highlight);
  defs.appendChild(pattern);
};

let stoneArtworkInstanceCounter = 0;
const stoneArtworkIdsBySvg = new WeakMap<SVGSVGElement, StoneArtworkIds>();
const dynamicOverlayObserversBySvg = new WeakMap<SVGSVGElement, MutationObserver>();

const ensureStoneArtwork = (svg: SVGSVGElement): StoneArtworkIds => {
  let ids = stoneArtworkIdsBySvg.get(svg);
  if (!ids) {
    ids = stoneArtworkIds(`torus-stone-artwork-${stoneArtworkInstanceCounter}`);
    stoneArtworkInstanceCounter += 1;
    stoneArtworkIdsBySvg.set(svg, ids);
  }

  const existing = svg.querySelector('defs[data-stone-artwork-defs="shared-svg"]');
  if (existing) return ids;

  const defs = svg.ownerDocument.createElementNS(SVG_NS, 'defs');
  defs.setAttribute('data-stone-artwork-defs', 'shared-svg');
  defs.setAttribute('data-torus-stone-artwork', 'true');
  defs.setAttribute('pointer-events', 'none');
  appendStonePaint(defs, 'black', ids.blackGradientId, ids.blackPatternId);
  appendStonePaint(defs, 'white', ids.whiteGradientId, ids.whitePatternId);
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
  if (root.matches(TORUS_STONE_SELECTOR)) stones.push(root as SVGCircleElement);
  stones.push(...root.querySelectorAll<SVGCircleElement>(TORUS_STONE_SELECTOR));
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

/** Shared black/white stone artwork for every 2D renderer and animation layer. */
export const applyStoneArtwork = (svg: SVGSVGElement): void => {
  const ids = ensureStoneArtwork(svg);
  polishDynamicOverlayWithin(svg, svg, ids);
  ensureDynamicOverlayObserver(svg, ids);
};
