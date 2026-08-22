# Game Cube Go 0.2.0 — release audit

> **Release checklist, not a source of truth.** Before using this checklist, read the current live Roadmap, live Game Cube Go requirements, and live Architecture:
>
> - Roadmap: https://docs.google.com/document/d/1_z_L7-eOiMos5_6qDRjMrOokiXb2JcMk_tGZuWhiUXQ
> - Game Cube Go: https://docs.google.com/document/d/1Hz7cQ1FuS1JunFDpSZ3q6gnJW5fbXKxb906BcvjICwY
> - Architecture: https://docs.google.com/document/d/1XVhf5E354aH889UVyagBkchiKAns9jSNnQpd_wH6-pw
>
> If this checklist conflicts with a current live Google Doc, **the live Google Doc wins**. This checklist must be updated rather than used to override current requirements.

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

- [ ] Launch the application without query parameters and open **New Game**.
- [ ] Verify topology selection uses the current live labels/behavior for **Cube** and **Torus** and that changing topology shows the correct configured size set.
- [ ] Verify Cube size buttons are treated as UI configuration, not as a fundamental `CubeTopology` limit. Do not fail the architecture merely because the configured UI set has changed since this checklist was written.
- [ ] Switch to **Torus** and verify 9×9 / 13×13 / 19×19 are available.
- [ ] Start a Cube game with Japanese rules and komi 7.5.
- [ ] Verify exactly six physical Cube boards are visible in stable state and every `CubeFace` appears exactly once.
- [ ] Verify the stable layout is the canonical 3-row × 4-column cross: TOP above CENTER, BOTTOM below CENTER, and LEFT / CENTER / RIGHT / BACK across the middle row.
- [ ] Verify the six remaining layout slots are empty: no board, grid, hover/drop target, or manual face-placement control is rendered there.
- [ ] Verify there is **no movable vertical anchor** and no user interaction that relocates TOP/BOTTOM into another column.
- [ ] Place stones, including a capture within one face and a capture crossing a Cube edge.
- [ ] Verify hover preview, forbidden marker, last-move marker, and move numbers map to exactly one visual representation per logical `PointId`.
- [ ] Verify Undo and Redo restore captures, move/action number, player, ko/repetition state, pass state, endgame state, and counters.
- [ ] Navigate left repeatedly and right repeatedly. Verify the four side boards behave as an infinite cyclic gallery and do not accumulate permanent duplicate boards or hit targets.
- [ ] Navigate up/down. Verify TOP/BOTTOM becomes the new CENTER through `CubeOrientation`, the cross is rebuilt, and the final stable state again contains exactly six unique faces.
- [ ] During horizontal wrap, if an animation-only clone is used, verify it is non-interactive, outside stable `Cube2DLayout`, and removed after the transition.
- [ ] Verify navigation changes only presentation/orientation state: stones, turn, captures, history, logical `PointId`, and Cube adjacency remain unchanged.
- [ ] Zoom/pan as currently defined by the live requirements and verify hover/click still target the intended logical intersection.
- [ ] Verify Cube 2D uses the same shared board/stone visual assets and semantics as Torus 2D rather than an independent board theme.
- [ ] Verify the application uses the same shared main `GameControlPanel` component for Torus 2D and Cube 2D.
- [ ] Reload during normal play, choose Continue where the current product flow offers it, and verify the rule-relevant game state is restored correctly.
- [ ] Pass, play a normal move, then Pass/Pass and verify manual alive/dead/seki classification remains authoritative in 0.2.
- [ ] Finish scoring and verify Result, territory/dead-stone presentation, winner/margin, and reopenable result behavior.
- [ ] Repeat a complete short Cube game under Chinese rules.

## Parameterization / headless contract audit

0.2 is not complete if Cube works only for the exact sizes currently exposed as buttons.

- [ ] `CubeTopology(N)` passes the shared Topology Contract for multiple sizes.
- [ ] Test coverage includes even and odd `N` and at least one technical size outside the UI-configured set.
- [ ] Adding another reasonable Cube size does not require separate GameEngine rules or a new CubeTopology algorithm branch.
- [ ] Edge/corner transitions, four distinct neighbors, symmetry/connectivity, and stable PointIds are covered independently of Renderer.
- [ ] `CubeOrientation` / spatial mapping / `Cube2DLayout` can be tested headlessly without SVG/DOM.
- [ ] Stable `Cube2DLayout` always has 12 slots, 6 occupied cells, 6 nulls, 6 unique faces, and exactly `6 × N × N` logical visual points.

## Torus 0.1 regression checklist

- [ ] New Torus game works for 9×9 / 13×13 / 19×19.
- [ ] Existing placement, capture, suicide/ko/repetition, Pass, Undo, Redo, and endgame behavior remains correct.
- [ ] Chinese and Japanese scoring still complete normally.
- [ ] Torus persistence/Continue restores exact rule-relevant state through the same application lifecycle.
- [ ] One-line duplicate edge strips, where enabled, remain renderer-only and non-interactive.
- [ ] Result dialog and final board visualization remain correct.

## Architecture audit

- UI sends semantic commands through `GameSession`; it does not mutate `GameState` or call `GameEngine` directly.
- `GameEngine`, `GameSession`, History, scoring, endgame, and persistence contracts remain shared between Torus and Cube.
- `GameState` contains rule-relevant serializable state; Cube orientation/layout/zoom/pan remain `ViewState` / presentation concerns.
- `CubeTopology` is parameterized by `N` and does not use the UI button list as its domain contract.
- Cube 2D keeps exactly six physical faces in stable state and creates no permanent visual face duplicates.
- The shared `GameControlPanel` is reused rather than copied for Cube.
- Shared `BoardTheme` / stone artwork / common 2D visual semantics are reused rather than forked.
- The technical Cube 2D preview/debug route, if retained, remains development-only and cannot define a parallel product behavior that contradicts the main application.

## Documentation gate

Before tagging 0.2.0:

1. Re-read the three live Google Docs.
2. Confirm this checklist and repository summaries do not contradict them.
3. If a live requirement changed, update this checklist; do not preserve an obsolete release expectation merely because it appeared in an older repository file.
4. Run the full automated gate on the exact candidate commit.
5. Play the required manual Cube/Torus smoke scenarios on the candidate build.

Do not create the 0.2.0 tag/release until these gates pass.
