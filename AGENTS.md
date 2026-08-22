# GoCube agent instructions

## Read the authoritative document first

Before planning, reviewing, editing, or implementing work, read the repository document that owns the subject:

- Architecture/contracts/module boundaries → `docs/ARCHITECTURE.md`
- Version scope/sequencing/`introducedIn` → `docs/ROADMAP.md`
- Detailed product behavior/requirements → `docs/GAME_CUBE_GO.md`

These three files are the canonical project documentation. Do not infer current requirements from release records, README, issues, PR descriptions, comments, old tasks, chat excerpts, cached copies, or exports.

## Documentation hygiene

- Do **not** create summaries, mirrors, alternate specifications, or replacement documents for Architecture, Roadmap, or Game Cube Go unless the user explicitly asks for one.
- Do **not** copy product requirements into `README.md` or this file. They should point to the canonical documents instead.
- `docs/RELEASE_*.md` files are historical release/checkpoint records only. Never use them to override or reconstruct current requirements.
- If canonical documents appear to conflict, report the conflict explicitly. Do not silently choose an interpretation and do not create a fourth document to reconcile them.
- When a canonical requirement changes, edit the canonical document that owns it rather than duplicating the change elsewhere.

## Repository workflow

- Use repository code and tests for implementation-specific details after reading the relevant canonical documentation.
- Keep changes focused; avoid mixing unrelated behavior, architecture, and visual work.
- Use a feature/documentation branch and pull request; keep `main` releasable.
- Run the relevant automated checks and require CI to pass before merge.
