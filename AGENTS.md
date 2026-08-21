# GoCube agent instructions

Read `README.md`, `docs/ARCHITECTURE.md`, and `docs/ROADMAP.md` before planning implementation work.

## Canonical version scope

Treat this mapping as non-negotiable unless the product roadmap is explicitly changed:

- **0.1 — Torus 2D** with Chinese/Japanese scoring, manual alive/dead/seki and linear Undo/Redo.
- **0.2 — Cube 2D**.
- **0.3 — Automatic/Assisted alive/dead/seki** with manual fallback.
- **0.5 — Cube 3D**.

**0.4 is intentionally unused.** The former Advanced/Branching History milestone was removed; do not recreate it from historical documentation. Any historical task, pasted specification, comment, or stale file that says **`0.3 = Cube 3D`** is superseded. Cube3DRenderer, Three.js-specific implementation, 3D camera/input and Cube 2D↔3D switching must not be pulled into 0.3 work.

## Non-negotiable architecture

1. `core` contains game logic and must not import React, SVG, Three.js, DOM APIs, or browser storage.
2. Board geometry is accessed through the `Topology` interface. Rules must not contain torus-specific or cube-specific adjacency logic.
3. Rendering consumes logical state; rendering never defines game state.
4. Persistence is behind `GameRepository`. Version 0.1 may use localStorage, but the game/session layer must not depend on localStorage directly.
5. Input/UI sends semantic commands to the session layer. Do not let click coordinates leak into rules logic.
6. Preserve future network play: session commands and game state must be serializable and deterministic where practical.
7. Chinese and Japanese rule modes are first-class from the beginning. Do not hard-code one scoring system into move legality.
8. Endgame classification is separate from move legality and scoring. Manual classification is authoritative in 0.1–0.2; 0.3 may auto-resolve only obvious/provable cases and must keep manual fallback.
9. 3D is a 0.5 renderer concern, not a rewrite of the game model and not a 0.3 requirement.
10. Linear Undo/Redo is the final current user-facing history model. Do not introduce branching history without a new explicit product decision.

## Implementation discipline

- Work in small vertical milestones.
- Add or update tests for topology and rules changes before UI polish.
- Do not introduce a backend, database, authentication, or networking into early local versions unless a documented requirement changes.
- Do not silently change product requirements to simplify implementation.
- If documentation conflicts, use `docs/ROADMAP.md` for version scope and record the conflict before encoding another interpretation in core logic.

## Git workflow

- Keep `main` releasable.
- Use focused feature branches and pull requests.
- Avoid mixing architecture refactors with unrelated visual work.
- CI must pass before merge.
