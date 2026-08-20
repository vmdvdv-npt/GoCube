import { describe, expect, it } from 'vitest';
import { TorusTopology } from '../core/topology/TorusTopology';
import {
  buildEndgameGroupEdges,
  endgameGroupForPoint,
  endgameGroupId,
  type EndgameGroupPresentation,
} from './EndgameGroupPresentation';

const topology = new TorusTopology(9);

const edges = (points: readonly string[]) => buildEndgameGroupEdges(points, topology);

describe('EndgameGroupPresentation', () => {
  it('builds the real logical neighbor edges for an ordinary connected group', () => {
    expect(edges(['1,1', '2,1', '3,1'])).toEqual([
      { from: '1,1', to: '2,1' },
      { from: '2,1', to: '3,1' },
    ]);
  });

  it('keeps a single-stone group edge-free for renderer singleton geometry', () => {
    expect(edges(['4,4'])).toEqual([]);
  });

  it('connects a two-stone group center-to-center exactly once', () => {
    expect(edges(['4,4', '5,4'])).toEqual([{ from: '4,4', to: '5,4' }]);
  });

  it('preserves every branch instead of reducing the group to one path', () => {
    expect(edges(['4,4', '3,4', '5,4', '4,3', '4,5'])).toEqual([
      { from: '3,4', to: '4,4' },
      { from: '4,3', to: '4,4' },
      { from: '4,4', to: '4,5' },
      { from: '4,4', to: '5,4' },
    ]);
  });

  it('uses topology wraparound for a horizontal torus seam', () => {
    expect(edges(['0,4', '8,4'])).toEqual([{ from: '0,4', to: '8,4' }]);
  });

  it('uses topology wraparound for a vertical torus seam', () => {
    expect(edges(['4,0', '4,8'])).toEqual([{ from: '4,0', to: '4,8' }]);
  });

  it('finds a whole logical group from any member PointId', () => {
    const group: EndgameGroupPresentation = {
      id: endgameGroupId(['1,1', '2,1']),
      points: ['1,1', '2,1'],
      color: 'black',
      edges: [{ from: '1,1', to: '2,1' }],
    };

    expect(endgameGroupForPoint([group], '2,1')).toBe(group);
    expect(endgameGroupForPoint([group], '7,7')).toBeNull();
  });
});
