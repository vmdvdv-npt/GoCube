# GoCube agent instructions

Read `README.md`, `docs/ARCHITECTURE.md`, and `docs/ROADMAP.md` before planning implementation work.

## Non-negotiable architecture

1. `core` contains game logic and must not import React, SVG, Three.js, DOM APIs, or browser storage.
2. Board geometry is accessed through the `Topology` interface. Rules must not contain torus-specific or cube-specific adjacency logic.
3. Rendering consumes logical state; rendering never defines game state.
4. Persistence is behind `GameRepository`. Version 0.1 may use localStorage, but the game/session layer must not depend on localStorage directly.
5. Input/UI sends semantic commands to the session layer. Do not let click coordinates leak into rules logic.
6. Preserve future network play: session commands and game state must be serializable and deterministic where practical.
7. Chinese and Japanese rule modes are first-class from the beginning. Do not hard-code one scoring system into move legality.
8. Endgame classification is separate from move legality and scoring. Early versions may ask the player to classify uncertain groups as alive/dead/seki.
9. 3D is a later renderer, not a rewrite of the game model.

## Implementation discipline

- Work in small vertical milestones.
- Add or update tests for topology and rules changes before UI polish.
- Do not introduce a backend, database, authentication, or networking into 0.1 unless a documented requirement changes.
- Do not silently change product requirements to simplify implementation.
- If documentation conflicts, stop and record the conflict before encoding either interpretation in core logic.

## Git workflow

- Keep `main` releasable.
- Use focused feature branches and pull requests.
- Avoid mixing architecture refactors with unrelated visual work.
- CI must pass before merge.
