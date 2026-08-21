# GoCube architecture

This document is the implementation map for the project. Dependency arrows below mean **A → B: A is allowed to call/use B**.

## Version boundary guard

The canonical public order is:

`0.1 Torus 2D → 0.2 Cube 2D → 0.3 Automatic/Assisted alive-dead-seki → 0.5 Cube 3D`

Version **0.4 is intentionally unused** in the current roadmap; the former Advanced/Branching History stage was removed and linear Undo/Redo is the final user-facing history model from 0.1. The historical mapping **`0.3 = Cube 3D` is obsolete**. `Cube3DRenderer`, Three.js-specific work, 2D↔3D switching, and 3D camera/input are introduced only in **0.5**.

## Runtime dependency direction

```text
UI / Input
    ↓
GameSession
    ↓
GameEngine
    ↓
Topology + RulePolicy + Scoring

GameSession → GameHistory
GameSession → GameRepository
GameSession → EndgameClassifier

Renderer2D / future Renderer3D ← read logical game/session state
```

`Topology` is an interface used by `GameEngine`. Concrete implementations such as `TorusTopology` and `CubeTopology` implement that interface; they do not control the engine.

## Modules

### UI / Input
Translates mouse/buttons into semantic commands such as play, pass, undo/redo, change view, or start a new game. UI does not decide legality.

### GameSession
Coordinates one match. It accepts semantic commands, calls the engine, records history, persists state, and starts endgame flow. This is the intended seam for future local-vs-network session implementations.

### GameEngine
Owns logical board state and move execution. It knows stones, turns, captures, ko/superko policy, passes, and legality, but does not know pixels, faces drawn on screen, React, SVG, or Three.js.

### Topology
Defines the logical graph of playable points. Minimum responsibilities: enumerate points and return neighbors for a point. Torus and cube are interchangeable implementations.

### RulePolicy
Contains rule-set choices that affect legality or rule interpretation without coupling them to rendering.

### Scoring
Separate Chinese and Japanese scoring strategies. Territory/area calculation is not embedded in rendering.

### EndgameClassifier
Handles alive/dead/seki classification after the game reaches endgame flow. In 0.1–0.2 manual classification is authoritative. Version 0.3 adds assisted automatic classification for obvious/provable cases only; every uncertain case remains manual fallback. The classifier stays separate from scoring and move legality.

### GameHistory
Stores states/actions required for linear Undo/Redo. Passes are history events even when no stone is displayed. A new accepted action after Undo clears redo future. There is no current 0.4 Advanced/Branching History milestone.

### GameRepository
Persistence interface. 0.1 implementation may use localStorage. Future server persistence must be replaceable without changing the engine.

### Renderer2D
SVG-based renderer family. Converts logical point IDs to visual coordinates and emits semantic point selections. It must not become the source of board adjacency. Cube 2D is introduced in 0.2.

### Renderer3D (0.5)
3D adapter planned for Cube 3D. It consumes the same logical state, PointIds, topology and renderer-neutral orientation/spatial mapping as Cube 2D. Its implementation must not require changes to GameEngine, scoring, history, or endgame classification.

## Version composition

### 0.1 — Torus 2D
Torus topology, complete local GameEngine, Chinese/Japanese scoring, manual alive/dead/seki endgame flow, linear Undo/Redo, persistence and Torus2DRenderer.

### 0.2 — Cube 2D
Add `CubeTopology`, renderer-neutral cube orientation/spatial mapping and `Cube2DRenderer`. Stable Cube 2D contains exactly six unique physical faces; permanent duplicate cube faces/logical points are not part of the model. Existing rules, scoring, history and persistence are reused.

### 0.3 — Automatic/Assisted alive-dead-seki
Add `AssistedEndgameClassifier`. It may automatically resolve only obvious/provable cases and must route everything uncertain to the manual classifier. No Renderer3D, Three.js, 3D input, camera, or 2D↔3D transition is in 0.3.

### 0.5 — Cube 3D
Add `Cube3DRenderer` and the Cube 2D↔Cube 3D orientation bridge on top of the already-tested cube spatial mapping. GameState and all domain modules remain shared.

## Future online play

Do not build networking merely to prepare a local release. Preserve these seams:

- serializable semantic commands;
- session-level coordination above the engine;
- deterministic engine transitions where practical;
- persistence behind an interface;
- no UI-to-storage direct coupling.

A future `NetworkGameSession` or transport adapter should be able to send commands/state without replacing the rules engine.

## Development order

Implement logical contracts and tests before visual complexity. A working 2D torus (0.1) is the reference integration environment; Cube 2D (0.2) proves topology interchangeability; assisted endgame (0.3) extends classification without changing rules/scoring; Cube 3D (0.5) then proves renderer interchangeability. Do not use future 3D work as a dependency or acceptance criterion for 0.3.
