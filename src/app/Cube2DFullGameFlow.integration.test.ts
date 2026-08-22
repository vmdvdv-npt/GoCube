import { describe, expect, it } from 'vitest';
import type { GameState } from '../core/game/types';
import { ChineseScoring } from '../core/scoring/ChineseScoring';
import { JapaneseScoring } from '../core/scoring/JapaneseScoring';
import { CubeTopology, cubePointId } from '../core/topology/CubeTopology';
import {
  createCube2DViewState,
  navigateCube2DViewState,
  setCube2DVerticalAnchorColumn,
} from '../presentation/cube/Cube2DNavigation';
import { Cube2DGameController } from './Cube2DGameController';

const allAlive = (controller: Cube2DGameController) =>
  Object.fromEntries(
    controller.endgameGroups().map((group) => [group.id, 'alive' as const]),
  );

const play = async (controller: Cube2DGameController, point: string) => {
  const result = await controller.placeStone(point);
  expect(result.accepted).toBe(true);
  return result;
};

const playCrossEdgeCapture = async (controller: Cube2DGameController) => {
  const frontEdge = cubePointId('front', 1, 2);
  const rightEdge = cubePointId('right', 1, 0);

  await play(controller, cubePointId('front', 1, 1));
  await play(controller, frontEdge);
  await play(controller, cubePointId('front', 0, 2));
  await play(controller, rightEdge);
  await play(controller, cubePointId('front', 2, 2));
  await play(controller, cubePointId('back', 1, 1));
  await play(controller, cubePointId('right', 0, 0));
  await play(controller, cubePointId('back', 0, 0));
  await play(controller, cubePointId('right', 2, 0));
  await play(controller, cubePointId('top', 1, 1));
  const capture = await play(controller, cubePointId('right', 1, 1));

  return { capture, frontEdge, rightEdge } as const;
};

describe('Cube2D full game flow', () => {
  it('routes Pass, ordinary move, Undo and Redo through the same GameSession', async () => {
    const controller = new Cube2DGameController({ size: 3 });
    const point = cubePointId('front', 1, 1);

    const pass = await controller.pass();
    expect(pass.viewModel).toMatchObject({
      phase: 'playing',
      moveNumber: 1,
      consecutivePasses: 1,
      currentPlayer: 'white',
    });

    const placed = await controller.placeStone(point);
    expect(placed.viewModel).toMatchObject({
      phase: 'playing',
      moveNumber: 2,
      consecutivePasses: 0,
      currentPlayer: 'black',
    });

    const undone = await controller.undo();
    expect(undone.viewModel).toMatchObject({
      moveNumber: 1,
      consecutivePasses: 1,
      currentPlayer: 'white',
    });
    expect(
      undone.viewModel.points.find((candidate) => candidate.logicalPointId === point)?.occupancy,
    ).toBe('empty');

    const redone = await controller.redo();
    expect(redone.viewModel).toMatchObject({
      moveNumber: 2,
      consecutivePasses: 0,
      currentPlayer: 'black',
    });
    expect(
      redone.viewModel.points.find((candidate) => candidate.logicalPointId === point)?.occupancy,
    ).toBe('white');
  });

  it('restores a capture through a physical cube edge with Undo and reapplies it with Redo', async () => {
    const controller = new Cube2DGameController({ size: 3 });
    const { capture, frontEdge, rightEdge } = await playCrossEdgeCapture(controller);

    expect(new Set(capture.captured)).toEqual(new Set([frontEdge, rightEdge]));
    expect(capture.viewModel.captures.black).toBe(2);

    const undone = await controller.undo();
    const undoOccupancy = new Map(
      undone.viewModel.points.map((point) => [point.logicalPointId, point.occupancy]),
    );
    expect(undoOccupancy.get(frontEdge)).toBe('white');
    expect(undoOccupancy.get(rightEdge)).toBe('white');
    expect(undone.viewModel.captures.black).toBe(0);

    const redone = await controller.redo();
    const redoOccupancy = new Map(
      redone.viewModel.points.map((point) => [point.logicalPointId, point.occupancy]),
    );
    expect(redoOccupancy.get(frontEdge)).toBe('empty');
    expect(redoOccupancy.get(rightEdge)).toBe('empty');
    expect(redone.viewModel.captures.black).toBe(2);
  });

  it.each(['chinese', 'japanese'] as const)(
    'runs manual edge-connected group classification and %s scoring through shared services',
    async (ruleSet) => {
      const controller = new Cube2DGameController({ size: 3, ruleSet, komi: 6.5 });
      const frontEdge = cubePointId('front', 1, 2);
      const rightEdge = cubePointId('right', 1, 0);

      await play(controller, frontEdge);
      await play(controller, cubePointId('back', 0, 0));
      await play(controller, rightEdge);
      await play(controller, cubePointId('back', 2, 2));
      await controller.pass();
      const endgame = await controller.pass();

      expect(endgame.viewModel.phase).toBe('endgame');
      const edgeGroup = controller
        .endgameGroups()
        .find((group) => group.points.includes(frontEdge));
      expect(edgeGroup).toBeDefined();
      expect(new Set(edgeGroup?.points)).toEqual(new Set([frontEdge, rightEdge]));
      expect(edgeGroup?.edges).toContainEqual({ from: frontEdge, to: rightEdge });

      const finished = await controller.finishEndgame(allAlive(controller));
      expect(finished.viewModel.phase).toBe('finished');
      expect(finished.viewModel.finalScore).toMatchObject({ ruleSet, komi: 6.5 });
      expect(controller.resultModel()).toMatchObject({
        score: { ruleSet, komi: 6.5 },
        statistics: { boardSize: 3, ruleSet },
      });
    },
  );

  it('undoes the finishing second Pass without changing the presentation-only Cube view state', async () => {
    const controller = new Cube2DGameController({ size: 4, ruleSet: 'chinese' });
    const viewState = setCube2DVerticalAnchorColumn(
      navigateCube2DViewState(createCube2DViewState(), 'right'),
      3,
    );

    await controller.pass();
    await controller.pass();
    const finished = await controller.finishEndgame({});
    expect(finished.viewModel.phase).toBe('finished');
    expect(controller.resultModel()).not.toBeNull();

    const undone = await controller.undo();
    expect(undone.viewModel).toMatchObject({
      phase: 'playing',
      moveNumber: 1,
      consecutivePasses: 1,
      currentPlayer: 'white',
      finalScore: null,
    });
    expect(controller.resultModel()).toBeNull();
    expect(viewState.orientation.centerFace).toBe('right');
    expect(viewState.verticalAnchorColumn).toBe(3);

    const redone = await controller.redo();
    expect(redone.viewModel.phase).toBe('finished');
    expect(redone.viewModel.finalScore).not.toBeNull();
    expect(viewState.orientation.centerFace).toBe('right');
    expect(viewState.verticalAnchorColumn).toBe(3);
  });

  it.each([
    ['chinese', (topology: CubeTopology) => new ChineseScoring(topology)],
    ['japanese', (topology: CubeTopology) => new JapaneseScoring(topology)],
  ] as const)('continues %s territory through a real cube edge', (_ruleSet, createScoring) => {
    const topology = new CubeTopology(2);
    const frontEdge = cubePointId('front', 0, 1);
    const rightEdge = cubePointId('right', 0, 0);
    expect(topology.neighbors(frontEdge)).toContain(rightEdge);

    const board = Object.fromEntries(
      topology.points().map((point) => [
        point,
        point === frontEdge || point === rightEdge ? 'empty' : 'black',
      ]),
    ) as GameState['board'];
    const state: GameState = Object.freeze({
      board: Object.freeze(board),
      currentPlayer: 'black',
      moveNumber: 0,
      consecutivePasses: 0,
      phase: 'finished',
      captures: Object.freeze({ black: 0, white: 0 }),
    });

    const score = createScoring(topology).score(state, Object.freeze([]), 0);
    expect(score.territory.black).toBe(2);
    expect(new Set(score.territoryPoints.black)).toEqual(new Set([frontEdge, rightEdge]));
  });

  it.each([0, 6.5, 7.5, 3.25])('preserves komi %s through final scoring', async (komi) => {
    const controller = new Cube2DGameController({ size: 2, komi });
    await controller.pass();
    await controller.pass();
    const finished = await controller.finishEndgame({});

    expect(finished.viewModel.finalScore?.komi).toBe(komi);
  });

  it('restores a saved Cube session snapshot without serializing Cube2DViewState', async () => {
    const controller = new Cube2DGameController({ size: 5, ruleSet: 'japanese', komi: 0 });
    const point = cubePointId('top', 4, 4);
    await play(controller, point);
    await controller.pass();

    const restored = new Cube2DGameController({ snapshot: controller.snapshot() });
    expect(restored.size).toBe(5);
    expect(restored.viewModel()).toEqual(controller.viewModel());
    expect(restored.snapshot().ruleSet).toBe('japanese');
    expect(restored.snapshot().komi).toBe(0);
  });
});
