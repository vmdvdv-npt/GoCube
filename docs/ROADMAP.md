# GoCube roadmap

> **Repository summary — not the source of truth.**
>
> The authoritative roadmap is the current live Google Doc:
> https://docs.google.com/document/d/1_z_L7-eOiMos5_6qDRjMrOokiXb2JcMk_tGZuWhiUXQ
>
> Before planning or assigning version scope, read that live document. The detailed live product requirements are at:
> https://docs.google.com/document/d/1Hz7cQ1FuS1JunFDpSZ3q6gnJW5fbXKxb906BcvjICwY
>
> Architectural boundaries are defined by the live Architecture:
> https://docs.google.com/document/d/1XVhf5E354aH889UVyagBkchiKAns9jSNnQpd_wH6-pw
>
> If this repository file, an issue, PR, old task, comment, pasted specification, cached copy, snapshot, or export conflicts with a current live Google Doc, **the live Google Doc wins**. If the live Roadmap cannot be accessed, do not use this file as a fallback authority for `introducedIn` decisions.

This file is a compact repository-oriented reflection of the live roadmap. In the live documentation, the **live Roadmap** is authoritative for which version introduces a feature; the **live Game Cube Go** document describes detailed behavior after introduction.

## Canonical version order

`0.1 Torus 2D → 0.2 Cube 2D → 0.3 Automatic/Assisted alive-dead-seki → 0.5 Cube 3D`

**0.4 is intentionally unused.** The former Advanced/Branching History milestone was removed. Linear Undo/Redo is the final current user-facing history model beginning in 0.1. The old mapping **`0.3 = Cube 3D` is obsolete** and must not be restored from historical material.

## 0.1 — Torus 2D

Goal: deliver the first complete playable local game and prove the shared domain/session architecture on Torus topology.

Current live scope includes:

- Torus 2D with 9×9 / 13×13 / 19×19 sizes and a four-neighbor toroidal `Topology` contract;
- placement, groups, liberties, captures, suicide rejection, ko/repetition policy, turn switching and Pass;
- Chinese area scoring and Japanese territory scoring from the first version; Japanese is the default choice for a new game and default komi is 7.5;
- explicit game phase flow `PLAYING → ENDGAME_REVIEW → FINISHED`;
- manual alive/dead/seki classification as the authoritative endgame resolution in 0.1–0.2;
- linear Undo/Redo, including Pass and endgame transitions; new accepted game action after Undo clears redo future;
- local persistence behind a storage/repository abstraction;
- one shared gameplay control panel, with a compact left service panel and board area on the right;
- Torus 2D presentation including visible system cursor, 50% stone hover preview, forbidden marker, move numbers, last-move marker, capture animation, and optional one-line non-interactive wrapped duplicate edge strips;
- separation of `GameState` and `ViewState`;
- Topology Contract, fixtures, unit/scenario tests, property-based/fuzz checks, headless engine tests, and a developer/debug renderer.

Not in 0.1: Cube topology, any 3D mode, assisted/automatic life/death classification, server/auth/database/network matches, or 3D Torus.

## 0.2 — Cube 2D

Goal: add a real Cube topology beside Torus, keep the existing rules/session/scoring stack, and make Cube Go fully playable in 2D.

Current live scope includes:

- `CubeTopology(N)` parameterized by board size rather than hard-coded to a fixed button list;
- the same universal four-neighbor Topology Contract plus Cube edge/corner transition checks;
- Cube/Torus selection in New Game with equal selectable controls and lightweight icons;
- a fixed Cube 2D screen model of **3 rows × 4 columns** with exactly six occupied physical faces and six empty slots:

  ```text
  null   TOP     null    null
  LEFT   CENTER  RIGHT   BACK
  null   BOTTOM  null    null
  ```

- exactly one stable visual representation of every `CubeFace` and logical `PointId`; permanent duplicate faces/cells/hit targets are forbidden;
- a renderer-neutral `CubeOrientation` / spatial mapping contract that determines face roles and rotation;
- `moveLeft()` / `moveRight()` as an infinite cyclic horizontal gallery of the four side faces;
- `moveUp()` / `moveDown()` as a CENTER change through TOP/BOTTOM and rebuild of the cross;
- a temporary non-interactive animation-only clone only when needed for seamless horizontal gallery wrap; it is outside stable `Cube2DLayout` and removed after transition;
- one shared `BoardTheme`, stone SVG artwork, and common visual semantics between Torus 2D and Cube 2D;
- reuse of `GameSession`, `GameEngine`, Chinese/Japanese scoring, manual alive/dead/seki, linear Undo/Redo, and persistence;
- parameterization tests across multiple `N`, including even/odd values and at least one technical size outside the current UI configuration;
- full Torus 0.1 regression coverage.

The set of Cube sizes exposed as UI buttons is **configuration, not an architecture or roadmap limit**. The live documents explicitly allow that UI set to change after play testing; adding another reasonable `N` must not require a fundamental `CubeTopology` or `GameEngine` rewrite.

Cube 3D is **not** part of 0.2.

### Current internal 0.2 checkpoints

The live roadmap currently describes the implementation sequence as:

- **01.01 — CubeTopology**: logical Cube foundation;
- **01.02.1 — Cube2DLayout correction/canonicalization** while preserving `CubeOrientation` and rotations;
- **01.03 — Cube2DRenderer** over the corrected six-face layout;
- **01.04 — Cube 2D navigation**: horizontal cyclic gallery and vertical cross rebuild.

These are internal technical checkpoints; the public version remains 0.2. Always re-read the live Roadmap before assuming a checkpoint description is still current.

## 0.3 — Automatic/Assisted alive-dead-seki

Goal: reduce manual endgame work after Cube 2D is stable without making uncertain guesses authoritative.

Current live scope includes:

- an assisted classifier separate from move legality and scoring;
- automatic classification only for obvious/provable alive, dead, and seki cases;
- mandatory manual three-way fallback for every uncertain/unproved case;
- user's manual answer remains final for fallback cases;
- topology-independent analysis through the logical `Topology` graph, with both Torus and Cube fixtures/regressions;
- the same resolved life/death result consumed by existing Chinese and Japanese scoring strategies.

**Cube 3D, Three.js, 2D ↔ 3D switching, 3D camera, and 3D input are not part of 0.3.**

## 0.5 — Cube 3D

Goal: add a full 3D representation of the already-working Cube game without changing domain rules, scoring, history, or endgame semantics.

Current live scope includes:

- `Cube3DRenderer` over existing `CubeTopology`, logical `PointId`, renderer-neutral Cube spatial mapping, and orientation anchor;
- six playable, mostly flat Cube faces with controlled edge treatment;
- picking/hit-testing mapped back to existing logical PointIds;
- mouse rotation/zoom, reset view, and controlled face-to-face navigation;
- Cube 2D ↔ Cube 3D transitions that preserve spatial/orientation anchor without changing `GameState`;
- feature parity for stones, last move, move numbers, endgame annotations, final territory/dead-stone state, scoring, history, and persistence;
- presentation-only animations/effects.

## Future Online Multiplayer

Online play is after the current numbered roadmap. Early versions preserve inexpensive seams for it but do not implement server infrastructure merely as preparation.

Future direction includes server-authoritative commands/state, remote persistence, transport/session adapters, accounts/matchmaking/reconnect/etc. as external layers around the shared domain engine.

A possible 3D Torus is also outside the current 0.1 / 0.2 / 0.3 / 0.5 roadmap and requires a separate product decision.

## Permanent engineering rules

The live Roadmap applies these rules across versions:

### One shared control panel

All game modes use one physically shared `GameControlPanel` (or equivalent main control component). Mode-specific capabilities may hide/disable inapplicable controls, but separate Torus/Cube/2D/3D panel copies are forbidden.

If a new function cannot fit or conflicts with the shared panel, the agent must report the problem prominently to the user **before implementation**. Do not silently invent a second panel, move required controls elsewhere, hide functionality, or create a one-mode-only layout workaround.

### GameState and ViewState are separate

Rule-relevant, replayable, serializable state belongs in `GameState`. Zoom, pan, camera, Cube orientation/layout, display options, and animation state belong in `ViewState`. GameEngine, scoring, repetition, and history must not depend on ViewState.

### Explicit game phase state machine

Use an explicit canonical phase such as `PLAYING → ENDGAME_REVIEW → FINISHED`, not contradictory independent booleans. Undo/Redo restore exact phase and related endgame/result state.

### Contracts, fixtures, property-based/fuzz tests

Topology Contract, internal fixture format, property-based/fuzz invariants, deterministic replay/serialization checks, and minimized regression fixtures are permanent development tools and expand as new topologies/features arrive.

### Developer/debug renderer

A development-only diagnostic view may expose PointIds, neighbors, groups, liberties, empty regions, Cube face/role/slot/rotation mappings, and Torus edge-copy source mappings. It never becomes a source of game logic.

### Core → Functional UI → Polish

Every major version/checkpoint first proves logic/contracts, then completes usable functional UI, then adds visual polish. Animation cannot substitute for unfinished domain correctness.

### Independently testable layers

CubeTopology/CubeOrientation/Cube2DLayout must be testable without Renderer; GameEngine without UI; assisted alive/dead/seki without endgame UI; future Renderer3D without modifying GameEngine. A layer that cannot be tested until a later layer exists indicates a suspicious boundary.

### `introducedIn` discipline

New/changed requirements carry the minimum version in which they are required. **The current live Roadmap is authoritative for `introducedIn`.** Do not infer version scope from this repository summary when the live Roadmap says otherwise.

## Mandatory Library/Reuse Review

Before detailed planning of every major version, the live roadmap requires a current Library/Reuse Review. Search mature libraries/primitives and record whether each serious candidate is used, adapted, kept as a reference/test oracle, or rejected, including licensing and integration risks.

Before each technical checkpoint, run a smaller targeted reuse search for that checkpoint's standard problems. Do not first design substantial custom low-level code and only then perform a ceremonial library search.

The current live documents name candidates such as standard React/Vite/Vitest/Playwright tooling, property-based testing libraries, runtime schema validation, 2D rendering/animation options, Go libraries/oracles, and future Three.js/R3F/Drei primitives, but the candidate list is not a frozen mandatory stack and must be refreshed when the relevant work begins.
