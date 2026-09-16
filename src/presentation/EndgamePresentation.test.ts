import { describe, expect, it } from 'vitest';
import type { GroupStatus } from '../core/endgame/EndgameClassifier';
import { TorusTopology } from '../core/topology/TorusTopology';
import { buildEndgameGroupEdges, type EndgameGroupPresentation } from './EndgameGroupPresentation';
import {
  ENDGAME_PRESENTATION_STYLES,
  buildEndgamePresentation,
  normalizeEndgamePresentationStatus,
} from './EndgamePresentation';

const topology = new TorusTopology(9);

const group = (
  id: string,
  points: readonly string[],
  color: 'black' | 'white',
): EndgameGroupPresentation => Object.freeze({
  id,
  points: Object.freeze([...points]),
  color,
  edges: buildEndgameGroupEdges(points, topology),
});

const build = (
  groups: readonly EndgameGroupPresentation[],
  decisions: Readonly<Partial<Record<string, GroupStatus>>> = {},
  selectedGroupId: string | null = null,
  hoveredGroupId: string | null = null,
) => buildEndgamePresentation({
  groups,
  decisions,
  topology,
  selectedGroupId,
  hoveredGroupId,
});

describe('EndgamePresentation', () => {
  it('normalizes every renderer-facing status to one explicit representation', () => {
    expect(normalizeEndgamePresentationStatus('alive')).toBe('alive');
    expect(normalizeEndgamePresentationStatus('dead')).toBe('dead');
    expect(normalizeEndgamePresentationStatus('seki')).toBe('seki');
    expect(normalizeEndgamePresentationStatus(undefined)).toBe('unresolved');
  });

  it('owns the canonical semantic colors, visibility, and Seki mask', () => {
    expect(ENDGAME_PRESENTATION_STYLES.alive.contourVisible).toBe(false);
    expect(ENDGAME_PRESENTATION_STYLES.dead).toMatchObject({
      contourVisible: true,
      contourColor: '#e52b2b',
    });
    expect(ENDGAME_PRESENTATION_STYLES.seki).toMatchObject({
      contourVisible: true,
      contourColor: '#80878f',
      maskColor: '#80878f',
      maskOpacity: 0.6,
    });
    expect(ENDGAME_PRESENTATION_STYLES.unresolved).toMatchObject({
      contourVisible: true,
      contourColor: '#f8cf4d',
    });
  });

  it('does not expose null or unknown when a decision is missing', () => {
    const model = build([
      group('alive', ['1,1'], 'black'),
      group('dead', ['3,1'], 'white'),
      group('seki', ['5,1'], 'black'),
      group('unresolved', ['7,1'], 'white'),
    ], {
      alive: 'alive',
      dead: 'dead',
      seki: 'seki',
    });

    expect(model.groups.map(({ id, status }) => [id, status])).toEqual([
      ['alive', 'alive'],
      ['dead', 'dead'],
      ['seki', 'seki'],
      ['unresolved', 'unresolved'],
    ]);
    expect(model.contours.some((contour) => contour.groupIds.includes('alive'))).toBe(false);
    expect(model.contours.find((contour) => contour.groupIds.includes('dead'))?.contourColor)
      .toBe('#e52b2b');
    expect(model.contours.find((contour) => contour.groupIds.includes('unresolved'))?.contourColor)
      .toBe('#f8cf4d');
  });

  it('builds one mixed-color Seki region with shared liberties and one style', () => {
    const black = group('black-seki', ['3,4'], 'black');
    const white = group('white-seki', ['5,4'], 'white');
    const model = build([black, white], {
      'black-seki': 'seki',
      'white-seki': 'seki',
    });

    expect(model.sekiRegions).toHaveLength(1);
    expect(model.sekiRegions[0]).toMatchObject({
      status: 'seki',
      groupIds: ['black-seki', 'white-seki'],
      contourColor: '#80878f',
      maskColor: '#80878f',
      maskOpacity: 0.6,
    });
    expect(model.sekiRegions[0]?.points).toContain('4,4');
  });

  it('keeps semantic status stable when selection and hover change', () => {
    const unresolved = group('g', ['2,2', '3,2'], 'black');
    const model = build([unresolved], {}, 'g', 'g');

    expect(model.groups[0]).toMatchObject({
      status: 'unresolved',
      selected: true,
      hovered: true,
    });
    expect(model.contours[0]).toMatchObject({
      status: 'unresolved',
      selected: true,
      hovered: true,
      contourColor: '#f8cf4d',
    });
  });
});
