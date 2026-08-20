# GoCube

GoCube is the implementation repository for **Game Cube Go**: a desktop-first Go application with interchangeable board topology.

The project starts with a fully playable 2D torus and is deliberately structured so that cube topology, cube 2D unfolding, and cube 3D rendering can be added without rewriting the rules engine.

## Planned versions

- **0.1 — Torus 2D**: complete playable toroidal Go, Chinese and Japanese scoring modes, history, undo, save/load, endgame flow.
- **0.2 — Cube 2D**: cube topology and flat unfolding using the same game engine.
- **0.3 — Cube 3D**: Three.js renderer over the same logical model.

## Technology

- TypeScript
- React
- Vite
- SVG for the first 2D renderer
- Vitest
- Playwright
- GitHub Actions
- localStorage through a persistence interface for the first version

Version 0.1 has no server or database requirement. Network play is a future extension and must not be coupled to the core engine.

## Architectural rule

The game engine must not depend on React, SVG, Three.js, browser storage, or a concrete board topology. Rules operate on logical point IDs and obtain adjacency through the `Topology` interface.

See `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, and `AGENTS.md` before implementation work.

## Development

```bash
npm install
npm run dev
```

Tests:

```bash
npm test
npm run test:e2e
```

## Current status

Repository scaffold. The first implementation milestone is the topology contract and verified torus adjacency, followed by the minimal rules engine.