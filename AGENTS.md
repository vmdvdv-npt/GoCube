# GoCube agent instructions

## Mandatory source-of-truth workflow

Before planning, reviewing, editing, or implementing project work, read the **current live Google Docs** relevant to the task. Do this before relying on repository documentation, historical tasks, issue/PR text, chat excerpts, cached copies, exports, or previous reads.

Authoritative live documents:

- **Architecture** — https://docs.google.com/document/d/1XVhf5E354aH889UVyagBkchiKAns9jSNnQpd_wH6-pw
- **Roadmap** — https://docs.google.com/document/d/1_z_L7-eOiMos5_6qDRjMrOokiXb2JcMk_tGZuWhiUXQ
- **Game Cube Go requirements** — https://docs.google.com/document/d/1Hz7cQ1FuS1JunFDpSZ3q6gnJW5fbXKxb906BcvjICwY

Authority rules:

1. **Current live Google Docs are the project source of truth.**
2. `README.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, release checklists, issues, PR descriptions, comments, pasted specifications, snapshots, exports, and historical tasks are non-authoritative repository/reference material.
3. If any repository or historical source conflicts with a current live Google Doc, **the live Google Doc wins**.
4. If a required live Google Doc cannot be accessed, stop and report that problem. Do not fall back to an older repository copy and guess.
5. Within the live documents, the live **Roadmap** controls `introducedIn` / version scope, the live **Game Cube Go** document controls detailed product behavior, and the live **Architecture** document controls architectural boundaries and contracts.
6. Repository documentation should be kept aligned with the live documents, but synchronization never changes the authority hierarchy above.

After reading the live documents, use repository files for implementation-specific paths, current code structure, tests, and local development instructions.

## Canonical version boundary

The current live roadmap defines this public order:

- **0.1 — Torus 2D** with Chinese/Japanese scoring, manual alive/dead/seki and linear Undo/Redo.
- **0.2 — Cube 2D**.
- **0.3 — Automatic/Assisted alive/dead/seki** with manual fallback for everything unproved or uncertain.
- **0.5 — Cube 3D**.

**0.4 is intentionally unused.** The former Advanced/Branching History milestone was removed. Linear Undo/Redo is the final current user-facing history model from 0.1. Historical material that says `0.3 = Cube 3D` is obsolete; Cube 3D, Three.js-specific implementation, 3D input/camera, and Cube 2D ↔ Cube 3D switching belong to 0.5.

## Non-negotiable architecture summary

This section is only a repository summary of the live Architecture. Re-read the live Architecture before architecture-sensitive work.

1. UI/Input sends semantic commands to `GameSession`; UI does not mutate `GameState` and does not call `GameEngine` directly.
2. `GameSession` coordinates one game and orchestrates command execution, History, persistence, endgame, scoring, and presentation.
3. The command-execution boundary must remain replaceable: a thin `LocalGameAuthority` may call `GameEngine` now; a future `RemoteGameAuthority` may use network transport without rewriting UI or domain logic.
4. `GameEngine` owns domain move mechanics only. It may depend on logical contracts such as `Topology` and `RepetitionPolicy`, but not on Renderer, React/DOM, SVG/Canvas/Three.js, storage, endgame UI, scoring presentation, or network transport.
5. `Topology` defines logical connectivity only. Renderer-specific coordinates and visual layout do not belong in the topology contract.
6. `GameState` and `ViewState` are separate. Rule-relevant state must be serializable and deterministic; camera, zoom, pan, Cube orientation/layout, and animation state are presentation concerns.
7. `PresentationModel` converts domain/session state plus view state into renderer-facing data. Renderer displays state and maps interaction back to logical `PointId`; it does not decide rules.
8. Endgame classification and scoring are separate: `EndgameClassifier` produces alive/dead/seki classification; `ChineseScoring` / `JapaneseScoring` consume the resolved classification. Manual classification is authoritative in 0.1–0.2; 0.3 adds assistance only for obvious/provable cases and retains manual fallback.
9. History is linear Undo/Redo and must restore exact rule-relevant state, including Pass/endgame transitions and redo semantics.
10. Persistence stays behind `GameStorage` / `GameRepository`-level abstractions. Domain logic must not read browser storage directly.
11. Starting in 0.1, all gameplay modes use **one physically shared `GameControlPanel` (or equivalent common component)**. Do not create independent Torus/Cube/2D/3D copies of the main control panel.
12. If a new mode/control cannot fit or conflicts with the shared panel, **do not silently create an exception or second panel**. Report the conflict to the user prominently before implementation and wait for an explicit product/design decision.
13. Starting in 0.2, Torus 2D and Cube 2D share the approved `BoardTheme`, stone SVG artwork, and common visual semantics. Do not create an independent Cube 2D theme for shared board/stone behavior.
14. `CubeTopology` is parameterized as `N×N`; the UI size list is configuration, not a fundamental topology limit.
15. Stable Cube 2D uses a fixed 3-row × 4-column slot matrix with exactly six unique physical faces and six empty slots:

    ```text
    null   TOP     null    null
    LEFT   CENTER  RIGHT   BACK
    null   BOTTOM  null    null
    ```

    Each `CubeFace` appears exactly once. Permanent duplicate faces, duplicate logical points, duplicate cells, and duplicate hit targets are forbidden. A non-interactive animation-only clone may exist temporarily outside `Cube2DLayout` only to make horizontal wrap visually continuous and must be removed after the transition.
16. `CubeOrientation` / renderer-neutral spatial mapping determines face roles and rotations. `moveLeft()` / `moveRight()` are visualized as an infinite cyclic gallery of the four side faces; `moveUp()` / `moveDown()` make TOP/BOTTOM the new CENTER and rebuild the cross.
17. 3D is a 0.5 renderer concern and must not require rewriting GameEngine, scoring, history, endgame classification, or GameState.
18. Future networking attaches outside the domain core; do not implement server/auth/database/network features in early local versions merely as preparation.

## Implementation discipline

- Before detailed planning of a major version, perform the live-roadmap-required **Library/Reuse Review**. Before each technical checkpoint, perform the smaller targeted reuse search required by the live documents.
- Use the version workflow **Core → Functional UI → Polish**. Prove domain/contracts before visual polish.
- Add/update contract, fixture, regression, property-based/fuzz, and integration tests appropriate to the changed layer.
- Keep layers independently testable: GameEngine without UI, CubeTopology/CubeOrientation/Cube2DLayout without Renderer, and future assisted endgame without endgame UI.
- Do not silently simplify or reinterpret product requirements because implementation is inconvenient.
- When an old task or implementation contradicts a live document, record/fix the discrepancy rather than encoding the stale interpretation into new core logic.

## Git workflow

- Keep `main` releasable.
- Use focused feature branches and pull requests.
- Avoid mixing unrelated architecture, behavior, and visual changes.
- CI must pass before merge.
