import type { GroupStatus } from '../core/endgame/EndgameClassifier';
import type { FinalProofSearchProgressSource } from '../core/endgame/FinalProofSearchRunController';
import type { GameSessionPersistenceConfig } from '../core/game/GameSession';
import type { RuleSet } from '../core/game/types';
import type { GameSessionSnapshot } from '../core/persistence/GameSessionSnapshot';
import type { PointId } from '../core/topology/Topology';
import { TORUS_SIZES, TorusTopology, type TorusSize } from '../core/topology/TorusTopology';
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

export interface TorusGameControllerOptions {
  readonly size?: TorusSize;
  readonly ruleSet?: RuleSet;
  readonly komi?: number;
  readonly persistence?: GameSessionPersistenceConfig;
  readonly snapshot?: GameSessionSnapshot;
}

export type TorusGameActionResult = SharedGameActionResult;
export type TorusMoveAvailability = SharedMoveAvailability;
export type TorusEndgameGroup = SharedEndgameGroup;
export type TorusEndgameDecisions = SharedEndgameDecisions;

const isTorusSize = (value: number): value is TorusSize =>
  TORUS_SIZES.some((size) => size === value);

export class TorusGameController {
  readonly size: TorusSize;
  readonly topology: TorusTopology;
  private readonly gameplay: GameSessionControllerFacade;

  constructor(options: TorusGameControllerOptions = {}) {
    const snapshot = options.snapshot;
    const requestedSize = snapshot?.boardSize ?? options.size ?? 9;
    if (!isTorusSize(requestedSize)) {
      throw new Error(`Unsupported saved torus size: ${String(requestedSize)}`);
    }

    this.size = requestedSize;
    this.topology = new TorusTopology(this.size);
    this.gameplay = new GameSessionControllerFacade({
      topology: this.topology,
      boardSize: this.size,
      ruleSet: snapshot?.ruleSet ?? options.ruleSet ?? 'chinese',
      komi: snapshot?.komi ?? options.komi ?? 0.5,
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

  resumeRestoredEndgame(): Promise<void> {
    return this.gameplay.resumeRestoredEndgame();
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

  endgameGroups(): readonly TorusEndgameGroup[] {
    return this.gameplay.endgameGroups();
  }

  endgameDecisions(): TorusEndgameDecisions {
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

  moveAvailability(point: PointId): TorusMoveAvailability {
    return this.gameplay.moveAvailability(point);
  }

  placeStone(point: PointId): Promise<TorusGameActionResult> {
    return this.gameplay.placeStone(point);
  }

  pass(): Promise<TorusGameActionResult> {
    return this.gameplay.pass();
  }

  finishEndgame(): Promise<TorusGameActionResult> {
    return this.gameplay.finishEndgame();
  }

  undo(): Promise<TorusGameActionResult> {
    return this.gameplay.undo();
  }

  redo(): Promise<TorusGameActionResult> {
    return this.gameplay.redo();
  }
}
