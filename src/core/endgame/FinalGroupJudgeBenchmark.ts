import {
  analyzeFinalGroupJudge,
  type FinalGroupJudgeDiagnostics,
} from './AssistedEndgameClassifier';
import { GameEngine } from '../game/GameEngine';
import type { GameState, PointOccupancy } from '../game/types';
import { CubeTopology } from '../topology/CubeTopology';
import type { PointId, Topology } from '../topology/Topology';
import { TorusTopology } from '../topology/TorusTopology';

export interface FinalGroupJudgeBenchmarkSample extends FinalGroupJudgeDiagnostics {
  readonly name: string;
  readonly topologyId: string;
  readonly logicalPointCount: number;
}

const makeState = (topology: Topology): GameState => {
  const board: Record<PointId, PointOccupancy> = {};
  const points = topology.points();
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]!;
    board[point] =
      index % 7 === 0 ? 'empty' : index % 2 === 0 ? 'black' : 'white';
  }
  return Object.freeze({
    board: Object.freeze(board),
    currentPlayer: 'black',
    moveNumber: 0,
    consecutivePasses: 2,
    phase: 'endgame',
    captures: Object.freeze({ black: 0, white: 0 }),
  });
};

const collectGroups = (
  topology: Topology,
  state: GameState,
): readonly (readonly PointId[])[] => {
  const engine = new GameEngine(topology);
  const visited = new Set<PointId>();
  const groups: (readonly PointId[])[] = [];
  for (const point of topology.points()) {
    if (visited.has(point) || state.board[point] === 'empty') continue;
    const group = engine.groupAt(state, point);
    if (!group) continue;
    const points = Object.freeze([...group.points].sort());
    for (const groupPoint of points) visited.add(groupPoint);
    groups.push(points);
  }
  return Object.freeze(groups);
};

const runSample = async (
  name: string,
  topology: Topology,
): Promise<FinalGroupJudgeBenchmarkSample> => {
  const state = makeState(topology);
  const analysis = await analyzeFinalGroupJudge({
    state,
    topology,
    groups: collectGroups(topology, state),
  });
  return Object.freeze({
    name,
    topologyId: topology.id,
    logicalPointCount: topology.points().length,
    ...analysis.diagnostics,
  });
};

export const runFinalGroupJudgeBrowserBenchmark = async (): Promise<
  readonly FinalGroupJudgeBenchmarkSample[]
> =>
  Object.freeze([
    await runSample('Cube 4', new CubeTopology(4)),
    await runSample('Cube 7', new CubeTopology(7)),
    await runSample('Torus 9', new TorusTopology(9)),
    await runSample('Torus 19', new TorusTopology(19)),
  ]);
