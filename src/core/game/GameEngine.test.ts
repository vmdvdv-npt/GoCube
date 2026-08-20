import { describe, expect, it } from 'vitest';
import type { PointId, Topology } from '../topology/Topology';
import { TORUS_SIZES, TorusTopology, type TorusSize } from '../topology/TorusTopology';
import { GameEngine } from './GameEngine';
import type { GameState, StoneColor } from './types';

const stateWith = (
  engine: GameEngine,
  stones: Record<PointId, StoneColor>,
): GameState => ({
  board: { ...engine.createInitialState().board, ...stones },
});

const expectSamePoints = (actual: readonly PointId[], expected: readonly PointId[]) => {
  expect(new Set(actual)).toEqual(new Set(expected));
};

class OpaqueTopology implements Topology {
  readonly id = 'opaque-3x3';
  private readonly allPoints = Object.freeze(
    Array.from({ length: 9 }, (_, index) => `p${index}`),
  );
  private readonly pointSet = new Set(this.allPoints);

  points(): readonly PointId[] {
    return this.allPoints;
  }

  has(point: PointId): boolean {
    return this.pointSet.has(point);
  }

  neighbors(point: PointId): readonly PointId[] {
    const index = this.allPoints.indexOf(point);
    if (index < 0) throw new Error(`Unknown point: ${point}`);

    const x = index % 3;
    const y = Math.floor(index / 3);
    const at = (nextX: number, nextY: number) =>
      this.allPoints[((nextY + 3) % 3) * 3 + ((nextX + 3) % 3)];

    return [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)];
  }
}

describe('GameEngine state and topology boundary', () => {
  it('creates a minimal JSON-serializable occupancy for every logical point', () => {
    const topology = new TorusTopology(9);
    const state = new GameEngine(topology).createInitialState();

    expect(Object.keys(state.board)).toHaveLength(topology.points().length);
    expect(topology.points().every((point) => state.board[point] === 'empty')).toBe(true);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('places a stone without mutating the input state', () => {
    const engine = new GameEngine(new TorusTopology(9));
    const state = engine.createInitialState();
    const result = engine.placeStone(state, '4,4', 'black');

    expect(state.board['4,4']).toBe('empty');
    expect(result.state.board['4,4']).toBe('black');
    expect(result.captured).toEqual([]);
  });

  it('rejects placement on an occupied point', () => {
    const engine = new GameEngine(new TorusTopology(9));
    const first = engine.placeStone(engine.createInitialState(), '4,4', 'black').state;

    expect(() => engine.placeStone(first, '4,4', 'white')).toThrow('Point is occupied: 4,4');
  });

  it('uses opaque PointIds and gets all connectivity only from Topology.neighbors()', () => {
    const engine = new GameEngine(new OpaqueTopology());
    const state = stateWith(engine, {
      p4: 'white',
      p3: 'black',
      p5: 'black',
      p1: 'black',
    });

    const result = engine.placeStone(state, 'p7', 'black');

    expect(result.captured).toEqual(['p4']);
    expect(result.state.board.p4).toBe('empty');
  });
});

describe('GameEngine groups and liberties', () => {
  it('finds a connected same-color group and all unique liberties', () => {
    const engine = new GameEngine(new TorusTopology(9));
    const state = stateWith(engine, {
      '1,1': 'white',
      '2,1': 'white',
    });

    const group = engine.groupAt(state, '1,1');

    expect(group?.color).toBe('white');
    expectSamePoints(group?.points ?? [], ['1,1', '2,1']);
    expectSamePoints(group?.liberties ?? [], [
      '0,1',
      '1,0',
      '1,2',
      '3,1',
      '2,0',
      '2,2',
    ]);
  });

  it('returns no group for an empty point', () => {
    const engine = new GameEngine(new TorusTopology(9));
    expect(engine.groupAt(engine.createInitialState(), '4,4')).toBeNull();
  });
});

describe('GameEngine captures', () => {
  it('captures a single stone whose last liberty is filled', () => {
    const engine = new GameEngine(new TorusTopology(9));
    const state = stateWith(engine, {
      '4,4': 'white',
      '3,4': 'black',
      '5,4': 'black',
      '4,3': 'black',
    });

    const result = engine.placeStone(state, '4,5', 'black');

    expect(result.captured).toEqual(['4,4']);
    expect(result.state.board['4,4']).toBe('empty');
  });

  it('captures an entire connected group', () => {
    const engine = new GameEngine(new TorusTopology(9));
    const state = stateWith(engine, {
      '3,4': 'white',
      '4,4': 'white',
      '2,4': 'black',
      '3,3': 'black',
      '3,5': 'black',
      '5,4': 'black',
      '4,3': 'black',
    });

    const result = engine.placeStone(state, '4,5', 'black');

    expectSamePoints(result.captured, ['3,4', '4,4']);
    expect(result.state.board['3,4']).toBe('empty');
    expect(result.state.board['4,4']).toBe('empty');
  });

  it('captures multiple neighboring opponent groups in one move', () => {
    const engine = new GameEngine(new TorusTopology(9));
    const state = stateWith(engine, {
      '3,4': 'white',
      '5,4': 'white',
      '2,4': 'black',
      '3,3': 'black',
      '3,5': 'black',
      '6,4': 'black',
      '5,3': 'black',
      '5,5': 'black',
    });

    const result = engine.placeStone(state, '4,4', 'black');

    expectSamePoints(result.captured, ['3,4', '5,4']);
  });
});

describe.each(TORUS_SIZES)('GameEngine torus seam captures %dx%d', (size: TorusSize) => {
  const create = () => {
    const topology = new TorusTopology(size);
    return { topology, engine: new GameEngine(topology) };
  };

  it('finds and captures a group crossing the left/right seam', () => {
    const { engine } = create();
    const last = size - 1;
    const mid = Math.floor(size / 2);
    const finalLiberty = `${last},${mid + 1}`;
    const state = stateWith(engine, {
      [`0,${mid}`]: 'white',
      [`${last},${mid}`]: 'white',
      [`1,${mid}`]: 'black',
      [`0,${mid - 1}`]: 'black',
      [`0,${mid + 1}`]: 'black',
      [`${last - 1},${mid}`]: 'black',
      [`${last},${mid - 1}`]: 'black',
    });

    const group = engine.groupAt(state, `0,${mid}`);
    expectSamePoints(group?.points ?? [], [`0,${mid}`, `${last},${mid}`]);
    expect(group?.liberties).toEqual([finalLiberty]);

    const result = engine.placeStone(state, finalLiberty, 'black');
    expectSamePoints(result.captured, [`0,${mid}`, `${last},${mid}`]);
  });

  it('finds and captures a group crossing the top/bottom seam', () => {
    const { engine } = create();
    const last = size - 1;
    const mid = Math.floor(size / 2);
    const finalLiberty = `${mid + 1},${last}`;
    const state = stateWith(engine, {
      [`${mid},0`]: 'white',
      [`${mid},${last}`]: 'white',
      [`${mid - 1},0`]: 'black',
      [`${mid + 1},0`]: 'black',
      [`${mid},1`]: 'black',
      [`${mid - 1},${last}`]: 'black',
      [`${mid},${last - 1}`]: 'black',
    });

    const group = engine.groupAt(state, `${mid},0`);
    expectSamePoints(group?.points ?? [], [`${mid},0`, `${mid},${last}`]);
    expect(group?.liberties).toEqual([finalLiberty]);

    const result = engine.placeStone(state, finalLiberty, 'black');
    expectSamePoints(result.captured, [`${mid},0`, `${mid},${last}`]);
  });
});
