# Game Cube Go 0.2.0 — release audit

Version 0.2 makes Cube 2D a normal application mode while preserving Torus 2D and the shared domain/session stack.

## Automated gate

Run from a clean checkout:

```bash
npm ci
npm run lint
npm test
npm run build
npm run test:e2e
```

All commands must pass before tagging 0.2.0.

## Cube 2D manual smoke checklist

- [ ] Launch the application without query parameters and open **New game**.
- [ ] Select **Cube 2D** and verify only 2×2 / 3×3 / 4×4 / 5×5 are offered.
- [ ] Switch to **Torus 2D** and verify only 9×9 / 13×13 / 19×19 are offered.
- [ ] Start Cube 4×4 with Japanese rules and komi 7.5.
- [ ] Verify exactly six physical `.cube-2d-board` elements and no diagnostic face labels.
- [ ] Place stones, including a capture within one face and a capture crossing a Cube edge.
- [ ] Verify Undo and Redo restore captures, move number, player, ko/repetition state and counters.
- [ ] Navigate left/right/up/down and move the vertical anchor; verify six physical faces remain invariant.
- [ ] Zoom out/in/reset and verify hover/click still target the intended logical intersection.
- [ ] Reload during normal play, choose Continue and verify stones, player, move number, captures, rules, komi and history.
- [ ] Pass, play a normal move, then Pass/Pass and verify manual Alive/Dead/Seki classification.
- [ ] Reload while manual classification is pending and verify classification can still be completed.
- [ ] Finish scoring and verify Result, territory/dead-stone presentation and winner/margin.
- [ ] Close Result and verify final board presentation remains.
- [ ] Reload a finished Cube game and verify the same FinalScore can be reopened.
- [ ] Repeat a complete short Cube game under Chinese rules.

## Torus 0.1 regression checklist

- [ ] New Torus game works for 9×9 / 13×13 / 19×19.
- [ ] Existing placement, capture, suicide/ko, Pass, Undo, Redo and endgame behavior is unchanged.
- [ ] Chinese and Japanese scoring still complete normally.
- [ ] Torus autosave/Continue restores the exact session through the same application lifecycle.
- [ ] Result dialog and final board visualization remain unchanged.

## Architecture audit

- One production `App` chooses the surface before constructing the controller/topology.
- `GameEngine`, `GameSession`, History, scoring, endgame and persistence contracts remain shared.
- `gameMode` lives in the application save envelope, not `GameState`.
- Cube orientation, vertical anchor and zoom remain presentation state and are intentionally reset on reload.
- Cube 2D keeps exactly six physical faces and creates no visual face duplicates.
- The technical `?cube2d-preview=1` route remains available only for development diagnostics.

Do not create the 0.2.0 tag/release until the first manual games have been played successfully.
