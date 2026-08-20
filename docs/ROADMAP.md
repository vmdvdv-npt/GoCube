# GoCube roadmap

## 0.1 — Torus 2D

Goal: prove the complete game architecture on the simplest boundaryless topology.

1. Project skeleton, CI, topology contract.
2. Torus point graph with wraparound and topology tests.
3. Minimal GameEngine: placement, liberties, groups, captures, suicide policy, ko/superko.
4. Turn flow and pass handling.
5. GameSession and history/undo.
6. Chinese and Japanese scoring strategies.
7. Endgame alive/dead/seki classification flow with manual user decision where needed.
8. SVG 2D torus renderer and semantic input mapping.
9. Duplicate border regions / infinite-board presentation behavior.
10. New game, settings, save/load via GameRepository/localStorage.
11. Result dialog and game statistics.
12. Integration/e2e coverage and release hardening.

No server, authentication, database, or network match service in 0.1.

## 0.2 — Cube 2D

Goal: add `CubeTopology` without changing the rules engine.

- verify every logical point has the intended four-neighbor connectivity;
- implement cube unfolding and duplicate-face presentation;
- infinite left/right/up/down navigation;
- preserve central face across view changes;
- reuse GameSession, GameEngine, scoring, history and persistence.

## 0.3 — Cube 3D

Goal: add a Three.js renderer without changing game rules.

- six planar faces with slightly rounded visual edges;
- point selection mapped to existing logical IDs;
- controlled face-to-face rotation;
- 2D ↔ 3D view transition preserving central face;
- capture animations as presentation events, not rules logic.

## Later

- richer life/death assistance;
- network accounts and matchmaking;
- remote persistence;
- multiplayer transport/session adapter;
- additional visual polish and optional platforms.
