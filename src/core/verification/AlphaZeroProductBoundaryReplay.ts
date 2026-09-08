import { ManualEndgameClassifier } from '../endgame/ManualEndgameClassifier';
import { GameEngine, type MoveRejectionReason } from '../game/GameEngine';
import { GameSession, type GameSessionResult } from '../game/GameSession';
import type { BoardOccupancy, CaptureCounts, GameState } from '../game/types';
import { ChineseScoring } from '../scoring/ChineseScoring';
import { JapaneseScoring } from '../scoring/JapaneseScoring';
import type { Topology } from '../topology/Topology';
import type {
  ProductBoundaryAction,
  ProductBoundaryBoard,
  ProductBoundaryFixture,
  ProductBoundaryPassSnapshot,
  ProductBoundaryStep,
} from './AlphaZeroProductBoundary';

export interface ProductBoundaryReplayResult {
  readonly fixture: ProductBoundaryFixture;
  readonly session: GameSession;
  readonly states: readonly GameState[];
  readonly firstPassState: GameState;
  readonly secondPassState: GameState;
}

export class ProductBoundaryReplayError extends Error {
  constructor(
    readonly fixtureId: string,
    readonly stepIndex: number,
    message: string,
  ) {
    super(`V2 replay ${fixtureId} step ${stepIndex}: ${message}`);
    this.name = 'ProductBoundaryReplayError';
  }
}

const sorted = (points: readonly string[]): readonly string[] => [...points].sort();

const sameSet = (left: readonly string[], right: readonly string[]): boolean => {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === rightSet.size && [...leftSet].every((point) => rightSet.has(point));
};

const boardFromFixture = (
  engine: GameEngine,
  fixture: ProductBoundaryFixture,
): GameState => {
  const initial = engine.createInitialState();
  const board: Record<string, 'black' | 'white' | 'empty'> = { ...initial.board };
  for (const point of fixture.initialPosition.black) board[point] = 'black';
  for (const point of fixture.initialPosition.white) board[point] = 'white';
  return Object.freeze({
    ...initial,
    board: Object.freeze(board) as BoardOccupancy,
    currentPlayer: fixture.initialPlayer,
  });
};

export const createProductBoundarySession = (
  engine: GameEngine,
  fixture: ProductBoundaryFixture,
): GameSession => {
  const scoring = fixture.ruleSet === 'japanese'
    ? new JapaneseScoring(engine.logicalTopology())
    : new ChineseScoring(engine.logicalTopology());
  return new GameSession(
    engine,
    {
      endgameClassifier: new ManualEndgameClassifier(),
      scoringStrategy: scoring,
      boardSize: fixture.size,
      komi: fixture.komi,
    },
    boardFromFixture(engine, fixture),
  );
};

const actionLabel = (action: ProductBoundaryAction): string =>
  action.type === 'pass' ? 'pass' : `place ${action.pointId}`;

const boardText = (board: ProductBoundaryBoard): string =>
  `black=[${sorted(board.black).join(', ')}] white=[${sorted(board.white).join(', ')}]`;

const capturesText = (captures: CaptureCounts): string =>
  `black=${captures.black} white=${captures.white}`;

const boardDiff = (expected: ProductBoundaryBoard, actual: GameState): string => {
  const actualBlack = Object.entries(actual.board).filter(([, value]) => value === 'black').map(([point]) => point);
  const actualWhite = Object.entries(actual.board).filter(([, value]) => value === 'white').map(([point]) => point);
  const missingBlack = expected.black.filter((point) => !actualBlack.includes(point));
  const extraBlack = actualBlack.filter((point) => !expected.black.includes(point));
  const missingWhite = expected.white.filter((point) => !actualWhite.includes(point));
  const extraWhite = actualWhite.filter((point) => !expected.white.includes(point));
  const wrongColor = expected.black.filter((point) => actualWhite.includes(point))
    .concat(expected.white.filter((point) => actualBlack.includes(point)));
  return `expected ${boardText(expected)}; actual black=[${sorted(actualBlack).join(', ')}] white=[${sorted(actualWhite).join(', ')}]; missing black=[${missingBlack.join(', ')}] extra black=[${extraBlack.join(', ')}] missing white=[${missingWhite.join(', ')}] extra white=[${extraWhite.join(', ')}] wrong-color=[${wrongColor.join(', ')}]`;
};

const assertStateMatchesStep = (
  fixture: ProductBoundaryFixture,
  step: ProductBoundaryStep,
  state: GameState,
  captured: readonly string[],
): void => {
  const mismatches: string[] = [];
  if (state.currentPlayer !== step.nextPlayer) mismatches.push(`next player expected ${step.nextPlayer}, actual ${state.currentPlayer}`);
  if (state.consecutivePasses !== step.consecutivePasses) mismatches.push(`consecutive passes expected ${step.consecutivePasses}, actual ${state.consecutivePasses}`);
  if (state.captures.black !== step.captures.black || state.captures.white !== step.captures.white) {
    mismatches.push(`captures expected ${capturesText(step.captures)}, actual ${capturesText(state.captures)}`);
  }
  if (!sameSet(step.capturedPoints, captured)) mismatches.push(`captured points expected [${step.capturedPoints.join(', ')}], actual [${captured.join(', ')}]`);
  const actualBlack = Object.entries(state.board).filter(([, value]) => value === 'black').map(([point]) => point);
  const actualWhite = Object.entries(state.board).filter(([, value]) => value === 'white').map(([point]) => point);
  if (!sameSet(step.board.black, actualBlack) || !sameSet(step.board.white, actualWhite)) mismatches.push(boardDiff(step.board, state));
  if (mismatches.length > 0) {
    throw new ProductBoundaryReplayError(
      fixture.fixtureId,
      step.index,
      `player=${step.playerBefore} action=${actionLabel(step.action)}; ${mismatches.join('; ')}`,
    );
  }
};

const assertPassSnapshot = (
  fixtureId: string,
  stepIndex: number,
  expected: ProductBoundaryPassSnapshot,
  state: GameState,
): void => {
  const actualBlack = Object.entries(state.board).filter(([, value]) => value === 'black').map(([point]) => point);
  const actualWhite = Object.entries(state.board).filter(([, value]) => value === 'white').map(([point]) => point);
  if (
    !sameSet(expected.board.black, actualBlack) ||
    !sameSet(expected.board.white, actualWhite) ||
    expected.captures.black !== state.captures.black ||
    expected.captures.white !== state.captures.white ||
    expected.playerToMove !== state.currentPlayer ||
    expected.consecutivePasses !== state.consecutivePasses
  ) {
    throw new ProductBoundaryReplayError(
      fixtureId,
      stepIndex,
      `pass boundary mismatch; expected ${boardText(expected.board)}, captures=${capturesText(expected.captures)}, player=${expected.playerToMove}, passes=${expected.consecutivePasses}; actual ${boardDiff(expected.board, state)}, captures=${capturesText(state.captures)}, player=${state.currentPlayer}, passes=${state.consecutivePasses}`,
    );
  }
};

const executeAction = (
  session: GameSession,
  action: ProductBoundaryAction,
): Promise<GameSessionResult> => session.execute(
  action.type === 'pass'
    ? { type: 'pass' }
    : { type: 'place-stone', point: action.pointId! },
);

export const replayAlphaZeroFixture = async (
  engine: GameEngine,
  fixture: ProductBoundaryFixture,
): Promise<ProductBoundaryReplayResult> => {
  const topology: Topology = engine.logicalTopology();
  if (topology.id !== `${fixture.topology}-${fixture.size}x${fixture.size}`) {
    throw new ProductBoundaryReplayError(fixture.fixtureId, -1, `engine topology ${topology.id} does not match ${fixture.topology}-${fixture.size}x${fixture.size}`);
  }

  const session = createProductBoundarySession(engine, fixture);
  const states: GameState[] = [];
  for (const step of fixture.steps) {
    const result = await executeAction(session, step.action);
    if (!result.ok) {
      throw new ProductBoundaryReplayError(
        fixture.fixtureId,
        step.index,
        `player=${step.playerBefore} action=${actionLabel(step.action)} was rejected (${result.reason as MoveRejectionReason}) while AlphaZero marked it legal; expected ${boardText(step.board)}, captures=${capturesText(step.captures)}`,
      );
    }
    const captured = result.action === 'place-stone' ? result.captured : [];
    assertStateMatchesStep(fixture, step, result.state, captured);
    states.push(result.state);
  }

  const firstPassStep = fixture.steps.find((step) => step.consecutivePasses === 1);
  const secondPassStep = fixture.steps.find((step) => step.consecutivePasses === 2);
  if (!firstPassStep || !secondPassStep) {
    throw new ProductBoundaryReplayError(fixture.fixtureId, -1, 'missing pass steps');
  }
  const firstPassState = states[firstPassStep.index];
  const secondPassState = states[secondPassStep.index];
  if (!firstPassState || !secondPassState) throw new ProductBoundaryReplayError(fixture.fixtureId, -1, 'missing replayed pass states');
  assertPassSnapshot(fixture.fixtureId, firstPassStep.index, fixture.afterFirstPass, firstPassState);
  assertPassSnapshot(fixture.fixtureId, secondPassStep.index, fixture.afterSecondPass, secondPassState);
  if (secondPassState.phase !== 'endgame') {
    throw new ProductBoundaryReplayError(fixture.fixtureId, secondPassStep.index, `GoCube phase is ${secondPassState.phase}, expected endgame`);
  }
  assertPassSnapshot(fixture.fixtureId, secondPassStep.index, fixture.expectedProductBoundary, secondPassState);

  return Object.freeze({
    fixture,
    session,
    states: Object.freeze(states),
    firstPassState,
    secondPassState,
  });
};
