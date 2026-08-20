# GoCube architecture

This document is the implementation map for the project. Dependency arrows below mean **A → B: A is allowed to call/use B**.

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

`Topology` is an interface used by `GameEngine`. Concrete implementations such as `TorusTopology` and future `CubeTopology` implement that interface; they do not control the engine.

## Modules

### UI / Input
Translates mouse/keyboard/buttons into semantic commands such as play, pass, undo, change view, or start a new game. UI does not decide legality.

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
Handles alive/dead/seki classification after the game reaches endgame flow. Early versions can ask the user when classification is uncertain and treat the answer as authoritative.

### GameHistory
Stores commands/states required for undo and history navigation. Passes are history events even when no stone is displayed.

### GameRepository
Persistence interface. 0.1 implementation may use localStorage. Future server persistence must be replaceable without changing the engine.

### Renderer2D
SVG-based first renderer. Converts logical point IDs to visual coordinates and emits semantic point selections. It must not become the source of board adjacency.

### Renderer3D (future)
Three.js adapter planned for cube 3D. It consumes the same logical state and topology IDs as 2D.

## Future online play

Do not build networking in 0.1. Preserve these seams:

- serializable semantic commands;
- session-level coordination above the engine;
- deterministic engine transitions where practical;
- persistence behind an interface;
- no UI-to-storage direct coupling.

A future `NetworkGameSession` or transport adapter should be able to send commands/state without replacing the rules engine.

## Development order

Implement logical contracts and tests before visual complexity. A working 2D torus is the reference integration environment; cube 2D then proves topology interchangeability; cube 3D proves renderer interchangeability.
