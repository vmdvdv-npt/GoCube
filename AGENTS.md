# GoCube agent instructions

## Read the authoritative document first

Before planning, reviewing, editing, or implementing work, read the repository document that owns the subject:

- Architecture/contracts/module boundaries → `docs/ARCHITECTURE.md`
- Version scope/sequencing/`introducedIn` → `docs/ROADMAP.md`
- Detailed product behavior/requirements → `docs/GAME_CUBE_GO.md`

These three files are the canonical project documentation. Do not infer current requirements from release records, README, issues, PR descriptions, comments, old tasks, chat excerpts, cached copies, or exports.

For work specifically on the automatic/assisted endgame engine, after reading the relevant canonical documents also read `docs/ENDGAME_ENGINE.md`. It is an explicitly approved, rapidly changing working plan: agents should keep it current as research, benchmarks and implementation evolve, but it never overrides the three canonical documents.

## Documentation hygiene

- Do **not** create summaries, mirrors, alternate specifications, replacement documents, ADRs, plans, reports, checklists, release notes, or any other new `.md` file unless the user explicitly approves that specific file.
- Do **not** copy product requirements into `README.md` or this file. They should point to the canonical documents instead.
- `docs/RELEASE_*.md` files are immutable historical snapshots of actually completed/tagged releases. Never create one in advance for an unreleased version, never use one as a release-candidate checklist, and never update one merely to match later product behavior. Edit a release record only to correct the historical record of that tagged release itself.
- If canonical documents appear to conflict, report the conflict explicitly. Do not silently choose an interpretation and do not create a fourth document to reconcile them.
- When a canonical requirement changes, edit the canonical document that owns it rather than duplicating the change elsewhere.

## Repository workflow

- Use repository code and tests for implementation-specific details after reading the relevant canonical documentation.
- Keep changes focused; avoid mixing unrelated behavior, architecture, and visual work.
- Use a feature/documentation branch and pull request; keep `main` releasable.
- Before naming/opening a PR, read and follow the CI mode-selection policy in `docs/ARCHITECTURE.md` §19; do not infer CI mode from task complexity.
- Run the relevant automated checks and require CI to pass before merge.
- For version completion, acceptance, tagging, or release decisions, follow the acceptance authority defined exclusively in `docs/ROADMAP.md`; never infer acceptance from CI, merged PRs, completed checkpoints, or agent judgment.
