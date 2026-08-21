import { describe, expect, it } from 'vitest';
import type { GameRepository, SavedGame } from '../core/persistence/GameRepository';
import { GameApplication, type ApplicationSavedState } from './GameApplication';
class Repo implements GameRepository<ApplicationSavedState> { saved: SavedGame<ApplicationSavedState> | null = null; removes=0; async save(g: SavedGame<ApplicationSavedState>){this.saved=structuredClone(g)} async load(){return this.saved ? structuredClone(this.saved):null} async remove(){this.saved=null;this.removes++} }

describe('GameApplication persistence edge cases', () => {
  it('restores Cube manual endgame after Pass/Pass', async () => {
    const repo=new Repo(), app=new GameApplication(repo); const active=await app.createNewGame({gameMode:'cube-2d',size:2,ruleSet:'japanese',komi:7.5});
    if(active.gameMode!=='cube-2d') throw new Error('Cube expected'); await active.controller.placeStone('front:0:0'); await active.controller.pass(); await active.controller.pass();
    expect(active.controller.viewModel().phase).toBe('endgame'); const restored=await new GameApplication(repo).restoreSavedGame();
    if(!restored||restored.gameMode!=='cube-2d') throw new Error('Cube restore failed'); expect(restored.controller.viewModel().phase).toBe('endgame'); expect(restored.controller.endgameGroups().length).toBeGreaterThan(0);
  });

  it('restores a finished Cube result', async () => {
    const repo=new Repo(), app=new GameApplication(repo); const active=await app.createNewGame({gameMode:'cube-2d',size:2,ruleSet:'chinese',komi:7.5});
    if(active.gameMode!=='cube-2d') throw new Error('Cube expected'); await active.controller.pass(); await active.controller.pass(); await active.controller.finishEndgame({});
    const restored=await new GameApplication(repo).restoreSavedGame(); if(!restored||restored.gameMode!=='cube-2d') throw new Error('Cube restore failed'); expect(restored.controller.viewModel().phase).toBe('finished'); expect(restored.controller.resultModel()).not.toBeNull();
  });

  it('removes ambiguous legacy/corrupted save without guessing topology from size', async () => {
    const repo=new Repo(); repo.saved={id:'current',savedAt:new Date().toISOString(),state:{version:2,snapshot:{version:1,boardSize:4,ruleSet:'japanese',komi:7.5,history:[]}} as unknown as ApplicationSavedState};
    const app=new GameApplication(repo); await expect(app.findSavedGame()).resolves.toBeNull(); expect(repo.saved).toBeNull(); expect(repo.removes).toBe(1);
  });
});
