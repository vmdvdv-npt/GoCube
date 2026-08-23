import { describe, expect, it } from 'vitest';
import { TorusTopology } from '../core/topology/TorusTopology';
import {
  buildEndgameGroupEdges,
  type EndgameGroupRenderState,
} from './EndgameGroupPresentation';
import { buildEndgameSekiRegions } from './EndgameSekiPresentation';

const topology = new TorusTopology(9);

const group = (
  id: string,
  color: 'black' | 'white',
  points: readonly string[],
  status: EndgameGroupRenderState['status'] = 'seki',
): EndgameGroupRenderState => ({
  id,
  color,
  points,
  edges: buildEndgameGroupEdges(points, topology),
  status,
});

describe('buildEndgameSekiRegions', () => {
  it('merges opposing Seki groups and paints their shared liberties as one region', () => {
    const regions = buildEndgameSekiRegions(
      [
        group('black-seki', 'black', ['3,3', '3,4']),
        group('white-seki', 'white', ['5,3', '5,4']),
      ],
      topology,
    );

    expect(regions).toHaveLength(1);
    expect(regions[0]?.groupIds).toEqual(['black-seki', 'white-seki']);
    expect(regions[0]?.points).toEqual(
      expect.arrayContaining(['3,3', '3,4', '4,3', '4,4', '5,3', '5,4']),
    );
    expect(regions[0]?.points).not.toContain('2,3');
    expect(regions[0]?.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: '3,3', to: '4,3' }),
        expect.objectContaining({ from: '4,3', to: '5,3' }),
        expect.objectContaining({ from: '4,3', to: '4,4' }),
      ]),
    );
  });

  it('fills an internal eye even when that liberty is bordered by only one Seki color', () => {
    const blackRing = ['1,1', '2,1', '3,1', '1,2', '3,2', '1,3', '2,3', '3,3'];
    const regions = buildEndgameSekiRegions(
      [
        group('black-ring', 'black', blackRing),
        group('white-touching', 'white', ['4,2']),
      ],
      topology,
    );

    expect(regions).toHaveLength(1);
    expect(regions[0]?.groupIds).toEqual(['black-ring', 'white-touching']);
    expect(regions[0]?.points).toContain('2,2');
    expect(regions[0]?.points).not.toContain('0,0');
  });

  it('merges directly touching opposing Seki stones without creating an internal border', () => {
    const regions = buildEndgameSekiRegions(
      [
        group('black-touching', 'black', ['3,3']),
        group('white-touching', 'white', ['4,3']),
      ],
      topology,
    );

    expect(regions).toHaveLength(1);
    expect(regions[0]?.points).toEqual(['3,3', '4,3']);
    expect(regions[0]?.edges).toEqual([{ from: '3,3', to: '4,3' }]);
  });

  it('keeps unrelated Seki groups separate and does not absorb ordinary outside liberties', () => {
    const regions = buildEndgameSekiRegions(
      [
        group('black-seki', 'black', ['3,3', '3,4']),
        group('white-seki', 'white', ['5,3', '5,4']),
        group('remote-seki', 'black', ['7,7']),
      ],
      topology,
    );

    expect(regions).toHaveLength(2);
    const pair = regions.find((region) => region.groupIds.includes('black-seki'))!;
    const remote = regions.find((region) => region.groupIds.includes('remote-seki'))!;
    expect(pair.groupIds).toEqual(['black-seki', 'white-seki']);
    expect(pair.points).not.toContain('3,2');
    expect(remote.points).toEqual(['7,7']);
  });

  it('does not gray a shared-looking liberty when a non-Seki group also borders it', () => {
    const regions = buildEndgameSekiRegions(
      [
        group('black-seki', 'black', ['3,3', '3,4']),
        group('white-seki', 'white', ['5,3', '5,4']),
        group('alive-boundary', 'black', ['4,2'], 'alive'),
      ],
      topology,
    );

    expect(regions).toHaveLength(1);
    expect(regions[0]?.points).not.toContain('4,3');
    expect(regions[0]?.points).toContain('4,4');
  });
});
