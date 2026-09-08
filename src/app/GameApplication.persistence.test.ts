import { describe, expect, it } from 'vitest';
import type { ActiveGameRepository, SavedGame } from '../core/persistence/GameRepository';
import { GameApplication, type ApplicationSavedState } from './GameApplication';
class Repo implements ActiveGameRepository<ApplicationSavedState> { saved: SavedGame<ApplicationSavedState> | null = null; removes=0; async save(g: SavedGame<ApplicationSavedState>){this.saved=structuredClone(g)} async activate(g: SavedGame<ApplicationSavedState>){this.saved=structuredClone(g)} async load(){return this.saved ? structuredClone(this.saved):null} async remove(){this.saved=null;this.removes++} }

describe('GameApplication persistence edge cases', () => {
  it('restores Cube manual endgame after Pass/Pass', async () => {
    const repo=new Repo(), app=new GameApplication(repo, undefined, () => 'cube-manual'); const active=await app.createNewGame({gameMode:'cube-2d',size:2,ruleSet:'japanese',komi:7.5});
    if(active.gameMode!=='cube-2d') throw new Error('Cube expected'); await active.controller.placeStone('front:0:0'); await active.controller.pass(); await active.controller.pass();
    expect(active.controller.viewModel().phase).toBe('endgame'); const restored=await new GameApplication(repo, undefined, () => 'unused').restoreSavedGame();
    if(!restored||restored.gameMode!=='cube-2d') throw new Error('Cube restore failed'); expect(restored.controller.viewModel().phase).toBe('endgame'); expect(restored.controller.endgameGroups().length).toBeGreaterThan(0);
  });

  it('restores a finished Cube result', async () => {
    const repo=new Repo(), app=new GameApplication(repo, undefined, () => 'cube-finished'); const active=await app.createNewGame({gameMode:'cube-2d',size:2,ruleSet:'chinese',komi:7.5});
    if(active.gameMode!=='cube-2d') throw new Error('Cube expected'); await active.controller.pass(); await active.controller.pass(); await active.controller.finishEndgame({});
    const restored=await new GameApplication(repo, undefined, () => 'unused').restoreSavedGame(); if(!restored||restored.gameMode!=='cube-2d') throw new Error('Cube restore failed'); expect(restored.controller.viewModel().phase).toBe('finished'); expect(restored.controller.resultModel()).not.toBeNull();
  });

  it('removes ambiguous legacy/corrupted save without guessing topology from size', async () => {
    const repo=new Repo(); repo.saved={id:'current',savedAt:new Date().toISOString(),state:{version:2,snapshot:{version:1,boardSize:4,ruleSet:'japanese',komi:7.5,history:[]}} as unknown as ApplicationSavedState};
    const app=new GameApplication(repo, undefined, () => 'unused'); await expect(app.findSavedGame()).resolves.toBeNull(); expect(repo.saved).toBeNull(); expect(repo.removes).toBe(1);
  });

  it('removes a corrupted redo payload instead of exposing an unusable Continue state', async () => {
    const repo=new Repo(), app=new GameApplication(repo, undefined, () => 'redo-session'); const active=await app.createNewGame({gameMode:'torus-2d',size:9,ruleSet:'japanese',komi:7.5});
    if(active.gameMode!=='torus-2d') throw new Error('Torus expected'); await active.controller.placeStone('0,0');
    if(!repo.saved) throw new Error('Expected saved game');
    const corrupted=structuredClone(repo.saved) as unknown as { state: { snapshot: { redo: unknown } } };
    corrupted.state.snapshot.redo={not:'an-array'};
    repo.saved=corrupted as unknown as SavedGame<ApplicationSavedState>;
    await expect(new GameApplication(repo, undefined, () => 'unused').findSavedGame()).resolves.toBeNull(); expect(repo.saved).toBeNull(); expect(repo.removes).toBe(1);
  });

  it('accepts a legacy application v2 save without sessionId as the explicit legacy generation', async () => {
    const repo = new Repo();
    const modern = new GameApplication(repo, undefined, () => 'source-session');
    await modern.createNewGame({gameMode:'torus-2d',size:9,ruleSet:'japanese',komi:7.5});
    if (!repo.saved) throw new Error('Expected saved game');
    const legacy = structuredClone(repo.saved);
    delete (legacy.state as { sessionId?: string }).sessionId;
    repo.saved = legacy;

    const restored = await new GameApplication(repo, undefined, () => 'unused').restoreSavedGame();
    expect(restored?.gameMode).toBe('torus-2d');
  });
});
