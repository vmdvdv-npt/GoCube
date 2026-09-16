import { describe, expect, it } from 'vitest';
import { CubeTopology } from '../core/topology/CubeTopology';
import { TorusTopology } from '../core/topology/TorusTopology';
import type { PointId, Topology } from '../core/topology/Topology';
import {
  buildEndgamePresentation,
  ENDGAME_PRESENTATION_STYLES,
} from './EndgamePresentation';
import {
  buildEndgameGroupEdges,
  type EndgameGroupPresentation,
} from './EndgameGroupPresentation';

const group = (
  topology: Topology,
  id: string,
  point: PointId,
  color: 'black' | 'white',
): EndgameGroupPresentation => ({
  id,
  color,
  points: [point],
  edges: buildEndgameGroupEdges([point], topology),
});

const semanticProjection = (model: ReturnType<typeof buildEndgamePresentation>) => ({
  groups: model.groups.map(({ id, color, status, selected, hovered }) => ({
    id,
    color,
    status,
    selected,
    hovered,
    visible: ENDGAME_PRESENTATION_STYLES[status].contourVisible,
  })),
  contours: model.contours.map(({
    status,
    color,
    groupIds,
    contourColor,
    selected,
    hovered,
  }) => ({ status, color, groupIds, contourColor, selected, hovered })),
  sekiRegions: model.sekiRegions.map(({
    status,
    groupIds,
    contourColor,
    maskColor,
    maskOpacity,
    selected,
    hovered,
  }) => ({
    status,
    groupIds,
    contourColor,
    maskColor,
    maskOpacity,
    selected,
    hovered,
  })),
  territoryOwners: [...model.territory.values()].sort(),
});

describe('EndgamePresentation Cube/Torus semantic parity', () => {
  it('keeps every non-geometric endgame property identical across topology adapters', () => {
    const cube = new CubeTopology(3);
    const torus = new TorusTopology(9);
    const decisions = {
      alive: 'alive',
      dead: 'dead',
      seki: 'seki',
    } as const;

    const cubeModel = buildEndgamePresentation({
      topology: cube,
      groups: [
        group(cube, 'alive', 'front:1:1', 'black'),
        group(cube, 'dead', 'back:1:1', 'white'),
        group(cube, 'seki', 'left:1:1', 'black'),
        group(cube, 'unresolved', 'right:1:1', 'black'),
      ],
      decisions,
      territory: new Map<PointId, 'black' | 'white'>([
        ['top:1:1', 'black'],
        ['bottom:1:1', 'white'],
      ]),
      selectedGroupId: 'unresolved',
      hoveredGroupId: 'dead',
    });

    const torusModel = buildEndgamePresentation({
      topology: torus,
      groups: [
        group(torus, 'alive', '1,1', 'black'),
        group(torus, 'dead', '3,3', 'white'),
        group(torus, 'seki', '5,5', 'black'),
        group(torus, 'unresolved', '7,7', 'black'),
      ],
      decisions,
      territory: new Map<PointId, 'black' | 'white'>([
        ['2,2', 'black'],
        ['6,6', 'white'],
      ]),
      selectedGroupId: 'unresolved',
      hoveredGroupId: 'dead',
    });

    expect(semanticProjection(cubeModel)).toEqual(semanticProjection(torusModel));
    expect(semanticProjection(cubeModel)).toMatchObject({
      groups: [
        { id: 'alive', status: 'alive', visible: false },
        { id: 'dead', status: 'dead', visible: true, hovered: true },
        { id: 'seki', status: 'seki', visible: true },
        { id: 'unresolved', status: 'unresolved', visible: true, selected: true },
      ],
      territoryOwners: ['black', 'white'],
    });
  });
});
