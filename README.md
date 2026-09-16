# GoCube

Implementation repository for **Game Cube Go**.

## Canonical documentation

Current project truth lives in three repository documents:

- `docs/ARCHITECTURE.md` — architecture, contracts, and module boundaries.
- `docs/ROADMAP.md` — version scope, sequencing, and `introducedIn`.
- `docs/GAME_CUBE_GO.md` — detailed product behavior and requirements.

Do not use this README, release records, issues, PR descriptions, old tasks, or chat excerpts as substitutes for those documents.

## Development

Install JavaScript dependencies once:

```bash
npm ci
```

Normal local development starts the complete GoCube + AlphaZero Development Workspace stack:

```bash
npm run dev
```

Keep `GoCube/` and `gocube-alphazero/` as sibling directories. The unified launcher starts or reuses the canonical AlphaZero Protocol V1 service from the sibling checkout, waits until `http://127.0.0.1:8765/v1/health` is ready, then starts GoCube on port 5173 and opens it in the browser. `Ctrl+C` stops the AlphaZero process started by that launcher. An alternate AlphaZero checkout can be supplied with `GOCUBE_ALPHAZERO_DIR=/path/to/gocube-alphazero npm run dev`.

To start only the Vite UI without AlphaZero, for example for isolated frontend work:

```bash
npm run dev:ui
```

The `./dev` launcher remains directly executable and is equivalent to the unified `npm run dev` workflow.

Validation:

```bash
npm run lint
npm test
npm run build
npm run test:e2e
```

## Repository documentation

- `AGENTS.md` — short workflow and documentation rules for coding agents.
- `docs/RELEASE_0.1.md` — historical record of the actually tagged 0.1 release. It is not a current product specification.

A `docs/RELEASE_0.x.md` record is created only after that release is actually completed/tagged. Do not create release records in advance for unreleased versions.

Do not create any new Markdown file anywhere in the repository without explicit user approval for that specific file.
