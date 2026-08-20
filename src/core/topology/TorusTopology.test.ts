import { describe, expect, it } from 'vitest';
import { TorusTopology } from './TorusTopology';

describe('TorusTopology', () => {
  it('creates size² points', () => {
    expect(new TorusTopology(9).points()).toHaveLength(81);
  });

  it('gives every point four neighbors', () => {
    const topology = new TorusTopology(9);
    for (const point of topology.points()) {
      expect(topology.neighbors(point)).toHaveLength(4);
    }
  });

  it('wraps across horizontal and vertical boundaries', () => {
    const topology = new TorusTopology(9);
    expect(topology.neighbors('0,0')).toEqual(
      expect.arrayContaining(['8,0', '1,0', '0,8', '0,1']),
    );
  });
});
