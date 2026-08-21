# GoCube roadmap

This file is the repository source of truth for **which public version introduces a feature**. Historical tasks or comments that contradict this file must not be used to infer version scope.

## Canonical version order

`0.1 Torus 2D → 0.2 Cube 2D → 0.3 Automatic/Assisted alive-dead-seki → 0.5 Cube 3D`

**0.4 is intentionally unused in the current roadmap.** The former Advanced/Branching History milestone was removed. Linear Undo/Redo is the final user-facing history model beginning in 0.1. In particular, the old mapping **`0.3 = Cube 3D` is obsolete**.

## 0.1 — Torus 2D

Goal: prove the complete game architecture on the simplest boundaryless topology.

1. Project skeleton, CI, topology contract.
2. Torus point graph with wraparound and topology tests.
3. Minimal GameEngine: placement, liberties, groups, captures, suicide policy, ko/superko.
4. Turn flow and pass handling.
5. GameSession and linear Undo/Redo history.
6. Chinese and Japanese scoring strategies.
7. Endgame alive/dead/seki classification flow with manual user decision as the source of truth.
8. SVG 2D torus renderer and semantic input mapping.
9. One-line wrapped duplicate edge strips / infinite-board presentation behavior.
10. New game, settings, save/load via GameRepository/localStorage.
11. Result dialog and game statistics.
12. Integration/e2e coverage and release hardening.

No server, authentication, database, or network match service in 0.1.

## 0.2 — Cube 2D

Goal: add `CubeTopology` without changing the rules engine and make Cube Go fully playable in 2D.

- verify every logical point has the intended four-neighbor connectivity;
- use a 3×4 layout with exactly six unique cube faces and no permanent duplicate faces or duplicate logical points;
- implement infinite horizontal left/right gallery navigation plus up/down orientation changes through `CubeOrientation`;
- preserve renderer-neutral cube orientation/spatial mapping for future renderers;
- reuse GameSession, GameEngine, scoring, linear Undo/Redo and persistence;
- keep manual alive/dead/seki classification authoritative throughout 0.2.

Cube 3D is **not** part of 0.2.

## 0.3 — Automatic/Assisted alive-dead-seki

Goal: reduce manual endgame work after Cube 2D is stable, without making uncertain life/death guesses authoritative.

- add `AssistedEndgameClassifier` as a separate module from move legality and scoring;
- automatically accept only obvious/provable alive, dead and seki cases;
- send every uncertain or unproved case to the existing manual three-way classification flow;
- keep the player's manual answer authoritative for fallback cases;
- keep the classifier topology-independent and operate through the logical graph/`Topology` contract;
- cover both TorusTopology and CubeTopology with fixtures and regression tests;
- reuse the existing Chinese and Japanese scoring strategies through the same resolved life/death result.

**Cube 3D, Three.js, 2D↔3D switching and 3D camera/input are not part of 0.3.**

## 0.5 — Cube 3D

Goal: add a full 3D representation of the already-working cube game without changing game rules, scoring, history or endgame logic.

- add `Cube3DRenderer` over existing `CubeTopology`, logical PointIds and renderer-neutral spatial/orientation mapping;
- render six playable cube faces with the approved surface treatment;
- map picking/hit-testing back to existing logical PointIds;
- support rotation, zoom, reset view and controlled face-to-face navigation;
- add Cube 2D ↔ Cube 3D transitions while preserving the orientation anchor;
- render stones, move markers/numbers, endgame annotations and final territory consistently with Cube 2D;
- keep animations as presentation events, never as rules logic;
- preserve Chinese/Japanese scoring, assisted/manual alive-dead-seki, Undo/Redo and persistence unchanged.

## Later

- network accounts and matchmaking;
- remote persistence;
- multiplayer transport/session adapter;
- optional 3D torus only if separately approved;
- additional visual polish and optional platforms.
