import type { GroupStatus } from '../core/endgame/EndgameClassifier';
import type { FinalProofSearchProgressSource } from '../core/endgame/FinalProofSearchRunController';
import type { GameSessionPersistenceConfig } from '../core/game/GameSession';
import type { RuleSet } from '../core/game/types';
import type { GameSessionSnapshot } from '../core/persistence/GameSessionSnapshot';
import { CubeTopology, isValidCubeSize, type CubeSize } from '../core/topology/CubeTopology';
import type { PointId } from '../core/topology/Topology';
import type { EndgameTerritoryOwner } from '../presentation/EndgameTerritoryPresentation';
import type { GameResultViewModel } from '../presentation/GameResultModel';
import type { GameViewModel } from '../presentation/PresentationModel';
import {
  GameSessionControllerFacade,
  type EndgameReviewReadyListener,
  type SharedEndgameDecisions,
  type SharedEndgameGroup,
  type SharedGameActionResult,
  type SharedMoveAvailability,
} from './GameSessionControllerFacade';

export interface Cube2DGameControllerOptions {
  readonly size?: CubeSize;
  readonly ruleSet?: RuleSet;
  readonly komi?: number;
  readonly persistence?: GameSessionPersistenceConfig;
  readonly snapshot?: GameSessionSnapshot;
}

export type Cube2DGameActionResult = SharedGameActionResult;
export type Cube2DMoveAvailability = SharedMoveAvailability;
export type Cube2DEndgameGroup = SharedEndgameGroup;
export type Cube2DEndgameDecisions = SharedEndgameDecisions;

export class Cube2DGameController {
  readonly size: CubeSize;
  readonly topology: CubeTopology;
  private readonly gameplay: GameSessionControllerFacade;

  constructor(options: Cube2DGameControllerOptions = {}) {
    const snapshot = options.snapshot;
    const requestedSize = snapshot?.boardSize ?? options.size ?? 4;
    if (!isValidCubeSize(requestedSize)) {
      throw new Error(`Unsupported cube size: ${String(requestedSize)}`);
    }

    this.size = requestedSize;
    this.topology = new CubeTopology(this.size);
    this.gameplay = new GameSessionControllerFacade({
      topology: this.topology,
      boardSize: this.size,
      ruleSet: snapshot?.ruleSet ?? options.ruleSet ?? 'chinese',
      komi: snapshot?.komi ?? options.komi ?? 7.5,
      persistence: options.persistence,
      snapshot,
    });
  }

  finalAnalysisProgressSource(): FinalProofSearchProgressSource {
    return this.gameplay.finalAnalysisProgressSource();
  }

  subscribeEndgameReviewReady(listener: EndgameReviewReadyListener): () => void {
    return this.gameplay.subscribeEndgameReviewReady(listener);
  }

  cancelFinalAnalysis(): void {
    this.gameplay.cancelFinalAnalysis();
  }

  dispose(): void {
    this.gameplay.dispose();
  }

  viewModel(): GameViewModel {
    return this.gameplay.viewModel();
  }

  snapshot(): GameSessionSnapshot {
    return this.gameplay.snapshot();
  }

  resultModel(): GameResultViewModel | null {
    return this.gameplay.resultModel();
  }

  canUndo(): boolean {
    return this.gameplay.canUndo();
  }

  canRedo(): boolean {
    return this.gameplay.canRedo();
  }

  endgameReviewReady(): boolean {
    return this.gameplay.endgameReviewReady();
  }

  canFinishEndgame(): boolean {
    return this.gameplay.canFinishEndgame();
  }

  endgameGroups(): readonly Cube2DEndgameGroup[] {
    return this.gameplay.endgameGroups();
  }

  endgameDecisions(): Cube2DEndgameDecisions {
    return this.gameplay.endgameDecisions();
  }

  endgameTerritory(): ReadonlyMap<PointId, EndgameTerritoryOwner> {
    return this.gameplay.endgameTerritory();
  }

  endgameManualGroupIds(): readonly string[] {
    return this.gameplay.endgameManualGroupIds();
  }

  nextUnresolvedEndgameGroupId(): string | null {
    return this.gameplay.nextUnresolvedEndgameGroupId();
  }

  setEndgameDecision(groupId: string, status: GroupStatus): Promise<void> {
    return this.gameplay.setEndgameDecision(groupId, status);
  }

  moveAvailability(point: PointId): Cube2DMoveAvailability {
    return this.gameplay.moveAvailability(point);
  }

  placeStone(point: PointId): Promise<Cube2DGameActionResult> {
    return this.gameplay.placeStone(point);
  }

  pass(): Promise<Cube2DGameActionResult> {
    return this.gameplay.pass();
  }

  finishEndgame(decisions?: Cube2DEndgameDecisions): Promise<Cube2DGameActionResult> {
    return this.gameplay.finishEndgame(decisions);
  }

  undo(): Promise<Cube2DGameActionResult> {
    return this.gameplay.undo();
  }

  redo(): Promise<Cube2DGameActionResult> {
    return this.gameplay.redo();
  }
}
