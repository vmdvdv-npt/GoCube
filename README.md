# GoCube

GoCube is the implementation repository for **Game Cube Go**: a desktop-first Go application with interchangeable board topology.

The project starts with a fully playable 2D torus and is deliberately structured so that cube topology, cube 2D unfolding, and cube 3D rendering can be added without rewriting the rules engine.

## Planned versions

- **0.1.0 — Torus 2D**: first complete playable release with Chinese and Japanese scoring modes, manual alive/dead/seki classification, history/undo, save/load, and final results.
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

Version 0.1.0 has no server or database requirement. Network play is a future extension and must not be coupled to the core engine.

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
npm run lint
npm test
npm run build
npm run test:e2e
```

## Current status

Version **0.1.0 — Torus 2D** is the first release candidate for a complete local game. It supports 9×9 / 13×13 / 19×19 boards, Chinese and Japanese scoring, configurable komi, captures, Pass and Undo, manual alive/dead/seki endgame classification, local save/restore, and a reopenable final result dialog.

The release gate requires TypeScript validation, Vitest, the production build, Playwright end-to-end release scenarios, and a final manual browser smoke-test before `v0.1.0` is tagged on `main`.

The next planned development milestone after the 0.1.0 release is **0.2.1 — CubeTopology / Cube 2D foundation**.
