# GoCube

GoCube is the implementation repository for **Game Cube Go**: a desktop-first Go application whose game engine is independent of concrete board topology and renderer.

## Source of truth

The repository Markdown files are **not** the authoritative product specification. Before planning, reviewing, or implementing project work, read the current live Google Docs:

- **Architecture** — https://docs.google.com/document/d/1XVhf5E354aH889UVyagBkchiKAns9jSNnQpd_wH6-pw
- **Roadmap** — https://docs.google.com/document/d/1_z_L7-eOiMos5_6qDRjMrOokiXb2JcMk_tGZuWhiUXQ
- **Game Cube Go requirements** — https://docs.google.com/document/d/1Hz7cQ1FuS1JunFDpSZ3q6gnJW5fbXKxb906BcvjICwY

**If repository documentation, issues, PR text, old tasks, comments, pasted specifications, snapshots, or exports conflict with the current live Google Docs, the live Google Docs win.** If a required live document cannot be accessed, do not silently fall back to an older repository copy.

Within the live documentation:

- the live **Roadmap** defines when a feature is introduced (`introducedIn` / version scope);
- the live **Game Cube Go** document defines detailed product behavior;
- the live **Architecture** document defines architectural boundaries and contracts.

`AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, and release checklists are repository summaries/checklists that should track those live documents but never override them.

## Planned versions

The current live roadmap defines:

- **0.1 — Torus 2D**: complete local Torus game with Chinese/Japanese scoring, manual alive/dead/seki, linear Undo/Redo, persistence, tests, and finished-game flow.
- **0.2 — Cube 2D**: parameterized Cube topology plus a flat six-face Cube 2D representation using the same domain/session stack.
- **0.3 — Automatic/Assisted alive/dead/seki**: automatically resolve only obvious/provable cases and keep manual classification as the mandatory fallback for uncertain cases.
- **0.5 — Cube 3D**: add the 3D renderer over the same Cube topology, PointIds, spatial mapping, GameState, rules, scoring, history, and endgame model.

**0.4 is intentionally unused.** The former Advanced/Branching History milestone was removed. Linear Undo/Redo remains the final current user-facing history model from 0.1. Historical material that says `0.3 = Cube 3D` is obsolete.

## Current development

Repository development is currently in the **0.2 — Cube 2D** stage. Cube 2D work is already present on `main`; exact remaining scope must be taken from the current live Roadmap and live Game Cube Go requirements rather than inferred from this README.

Important current 0.2 invariants include:

- `CubeTopology` is parameterized by `N×N`; supported UI sizes are configuration and must not be a fundamental topology limit;
- stable Cube 2D shows exactly six unique physical faces in a fixed 3×4 slot matrix, with no permanent duplicate faces or duplicate logical points;
- `CubeOrientation` is the renderer-neutral source for face roles/rotation;
- left/right navigation is an infinite cyclic gallery of four side faces; up/down rebuilds the cross with TOP/BOTTOM as the new CENTER;
- Torus 2D and Cube 2D use the same shared `BoardTheme`, stone artwork, and shared visual semantics;
- gameplay modes use one shared main control panel rather than separate Torus/Cube panel implementations.

## Architecture at a glance

The domain engine does not depend on React, SVG, Three.js, browser storage, or concrete screen geometry. UI sends semantic commands through `GameSession`; `GameEngine` uses logical `Topology` and repetition-policy contracts; persistence, history, endgame classification, scoring, presentation, and rendering remain separate responsibilities.

`GameState` contains serializable rule-relevant state. `ViewState` contains presentation concerns such as zoom, pan, orientation, layout, and animation state. Renderer state must never become the source of truth for rules or logical PointIds.

Read the live Architecture before architecture-sensitive work and see `docs/ARCHITECTURE.md` only as a repository-oriented summary.

## Technology

Current repository tooling includes:

- TypeScript
- React
- Vite
- SVG-based 2D rendering
- Vitest
- Playwright
- GitHub Actions
- local browser persistence behind an application/persistence boundary

Future networking remains outside the early local scope and must not be coupled to the domain core.

## Development

```bash
npm install
npm run dev
```

Validation:

```bash
npm run lint
npm test
npm run build
npm run test:e2e
```

## Repository documentation

- `AGENTS.md` — agent workflow and guardrails, including the mandatory live-doc read rule.
- `docs/ARCHITECTURE.md` — non-authoritative repository architecture summary.
- `docs/ROADMAP.md` — non-authoritative repository roadmap summary.
- `docs/RELEASE_0.1.md` / `docs/RELEASE_0.2.md` — release-oriented checklists; they do not override current live requirements.
