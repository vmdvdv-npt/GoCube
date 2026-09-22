import { describe, expect, it } from 'vitest';
import { finalBoardViewModel } from '../presentation/EndgameTerritoryPresentation';
import type { EndgamePresentationModel } from '../presentation/EndgamePresentation';
import type { GameViewModel } from '../presentation/PresentationModel';
import { createCube3DFeaturePresentation } from './Cube3DFeaturePresentation';

const baseViewModel = (phase: GameViewModel['phase'] = 'playing'): GameViewModel =>
  Object.freeze({
    points: Object.freeze([
      Object.freeze({ logicalPointId: 'front:0:0', occupancy: 'black' as const, moveNumber: 1 }),
      Object.freeze({ logicalPointId: 'front:0:1', occupancy: 'white' as const, moveNumber: 3 }),
      Object.freeze({ logicalPointId: 'front:0:2', occupancy: 'empty' as const, moveNumber: null }),
      Object.freeze({ logicalPointId: 'front:1:0', occupancy: 'empty' as const, moveNumber: null }),
    ]),
    currentPlayer: 'black',
    moveNumber: 4,
    consecutivePasses: phase === 'playing' ? 0 : 2,
    phase,
    captures: Object.freeze({ black: 0, white: 0 }),
    ruleSet: 'chinese',
    komi: 0.5,
    finalScore: null,
    lastMovePointId: 'front:0:1',
  });

const endgamePresentation: EndgamePresentationModel = Object.freeze({
  groups: Object.freeze([
    Object.freeze({
      id: 'black-group',
      color: 'black' as const,
      points: Object.freeze(['front:0:0']),
      edges: Object.freeze([]),
      status: 'dead' as const,
      selected: true,
      hovered: false,
    }),
    Object.freeze({
      id: 'white-group',
      color: 'white' as const,
      points: Object.freeze(['front:0:1']),
      edges: Object.freeze([]),
      status: 'seki' as const,
      selected: false,
      hovered: true,
    }),
  ]),
  contours: Object.freeze([]),
  sekiRegions: Object.freeze([
    Object.freeze({
      id: 'seki:white-group',
      status: 'seki' as const,
      groupIds: Object.freeze(['white-group']),
      points: Object.freeze(['front:0:1', 'front:0:2']),
      edges: Object.freeze([]),
      contourColor: '#80878f',
      maskColor: '#80878f',
      maskOpacity: 0.6,
      selected: false,
      hovered: true,
    }),
  ]),
  territory: new Map([['front:1:0', 'black' as const]]),
});

describe('Cube3DFeaturePresentation', () => {
  it('uses shared move-number and last-move semantics', () => {
    const projection = createCube3DFeaturePresentation({
      viewModel: baseViewModel(),
      showMoveNumbers: true,
    });

    expect(projection.points.find((point) => point.pointId === 'front:0:0')).toMatchObject({
      moveNumber: 1,
      lastMove: false,
    });
    expect(projection.points.find((point) => point.pointId === 'front:0:1')).toMatchObject({
      moveNumber: null,
      lastMove: true,
    });
  });

  it('projects the authoritative endgame review statuses and provisional territory', () => {
    const projection = createCube3DFeaturePresentation({
      viewModel: baseViewModel('endgame'),
      endgamePresentation,
      showMoveNumbers: false,
    });

    expect(projection.points.find((point) => point.pointId === 'front:0:0')).toMatchObject({
      reviewStatus: 'dead',
      reviewSelected: true,
      reviewHovered: false,
    });
    expect(projection.points.find((point) => point.pointId === 'front:0:1')).toMatchObject({
      reviewStatus: 'seki',
      reviewHovered: true,
      sekiRegion: true,
    });
    expect(projection.points.find((point) => point.pointId === 'front:0:2')).toMatchObject({
      reviewStatus: null,
      sekiRegion: true,
    });
    expect(projection.points.find((point) => point.pointId === 'front:1:0')).toMatchObject({
      territoryOwner: 'black',
    });
  });

  it('uses final scoring territory while dead-stone removal stays presentation-only', () => {
    const finished = Object.freeze({
      ...baseViewModel('finished'),
      finalScore: Object.freeze({
        ruleSet: 'chinese' as const,
        black: 3,
        white: 1.5,
        komi: 0.5,
        territory: Object.freeze({ black: 2, white: 0, neutral: 0, seki: 1 }),
        territoryPoints: Object.freeze({
          black: Object.freeze(['front:0:0', 'front:1:0']),
          white: Object.freeze([]),
          neutral: Object.freeze([]),
          seki: Object.freeze(['front:0:2']),
        }),
        stonesOnBoard: Object.freeze({ black: 0, white: 1 }),
        captures: Object.freeze({ black: 0, white: 0 }),
        prisoners: null,
        deadStones: Object.freeze({ black: 1, white: 0 }),
        winner: 'black' as const,
        margin: 1.5,
      }),
    }) satisfies GameViewModel;

    const display = finalBoardViewModel(finished);
    const projection = createCube3DFeaturePresentation({
      viewModel: display,
      showMoveNumbers: true,
    });

    expect(projection.points.find((point) => point.pointId === 'front:0:0')).toMatchObject({
      occupancy: 'empty',
      moveNumber: null,
      territoryOwner: 'black',
    });
    expect(projection.points.find((point) => point.pointId === 'front:1:0')).toMatchObject({
      territoryOwner: 'black',
    });
    expect(projection.points.find((point) => point.pointId === 'front:0:2')).toMatchObject({
      territoryOwner: null,
    });
  });
});
