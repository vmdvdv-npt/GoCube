# GoCube architecture

> **Repository summary — not the source of truth.**
>
> Before architecture-sensitive planning, review, or implementation, read the current live Architecture:
> https://docs.google.com/document/d/1XVhf5E354aH889UVyagBkchiKAns9jSNnQpd_wH6-pw
>
> Also read the live Roadmap for version scope and the live Game Cube Go document for detailed product behavior:
> - https://docs.google.com/document/d/1_z_L7-eOiMos5_6qDRjMrOokiXb2JcMk_tGZuWhiUXQ
> - https://docs.google.com/document/d/1Hz7cQ1FuS1JunFDpSZ3q6gnJW5fbXKxb906BcvjICwY
>
> If this file conflicts with any current live Google Doc, **the live Google Doc wins**. If the required live document cannot be accessed, stop rather than treating this repository summary as a fallback authority.

This file is a compact implementation-oriented map of the current live architecture. Dependency arrows mean **A → B: A uses B's contract or passes data/commands to B**; they do not mean inheritance.

## Version boundary guard

Current live roadmap order:

`0.1 Torus 2D → 0.2 Cube 2D → 0.3 Automatic/Assisted alive-dead-seki → 0.5 Cube 3D`

Version **0.4 is intentionally unused**. Advanced/Branching History was removed from the roadmap; linear Undo/Redo is the final current user-facing history model from 0.1. The historical mapping `0.3 = Cube 3D` is obsolete. Cube 3D, Three.js-specific rendering, 3D camera/input, and Cube 2D ↔ Cube 3D switching are introduced only in **0.5**.

## Core architectural invariants

1. UI does not mutate `GameState` directly.
2. UI does not call `GameEngine` directly. User game commands pass through `GameSession`.
3. `GameSession` coordinates one match; it is not the rules engine.
4. `GameEngine` owns domain move mechanics only and is independent of Torus/Cube and 2D/3D.
5. `GameEngine` obtains logical neighbors through `Topology` and repetition decisions through `RepetitionPolicy`.
6. `Topology` contains logical connectivity, never SVG/CSS/DOM/Canvas/Three.js coordinates.
7. Renderer consumes presentation data and maps input to logical `PointId`; renderer never decides game rules or becomes authoritative game state.
8. `GameState` and `ViewState` are separate. Rule-relevant data is serializable/deterministic; camera, zoom, pan, Cube orientation/layout, display options, and animation state are presentation concerns.
9. Endgame classification is separate from scoring. `EndgameClassifier` produces alive/dead/seki classification; `ChineseScoring` and `JapaneseScoring` calculate scores from the resolved classification.
10. History restores the exact rule-relevant state but does not own visual presentation.
11. Persistence is behind a storage/repository boundary; `GameEngine` must not access localStorage/IndexedDB directly.
12. Animation reacts to already-decided domain/presentation events and never determines the logical result of a move.
13. A 2D ↔ 3D view change never changes `GameState`.
14. Core modules depend on contracts/abstractions rather than concrete renderer, storage, or network implementations.
15. Future networking attaches outside the domain core. `Topology`, scoring, endgame classification, and `GameEngine` do not know whether a game is local or remote.

## Runtime command and presentation flow

Local command path:

```text
UI / Input
    ↓ semantic command
GameSession
    ↓
LocalGameAuthority or narrow local command-execution boundary
    ↓
GameEngine
    ├──→ Topology
    └──→ RepetitionPolicy
    ↓
GameState + DomainEvents
    ↓
GameSession
```

After the domain result, `GameSession` coordinates the required side effects:

```text
GameSession → History
GameSession → GameStorage / GameRepository-level persistence
GameSession → PresentationModel → active Renderer
```

Endgame path:

```text
GameSession → EndgameClassifier → ScoringStrategy → FinalResult
```

Future remote path:

```text
UI
  → GameSession
  → RemoteGameAuthority
  → NetworkTransport
  → ServerGameSession / shared GameEngine
  → authoritative GameState
  → GameSession
  → PresentationModel
```

`GameEngine` must **not** directly call History, persistence, Renderer, `EndgameClassifier`, `ScoringStrategy`, or `NetworkTransport`.

## Modules

### UI / Input

Shows controls and converts user intent into semantic commands such as `PlaceStone(pointId)`, `Pass`, `Undo`, `Redo`, `NewGame(settings)`, view navigation, or settings changes. It does not implement groups, liberties, captures, ko, scoring, or topology.

Starting with 0.2, New Game exposes Cube and Torus as equal selectable topology controls with their presentation icons; topology selection remains a UI/application concern.

### Shared GameControlPanel

Starting in 0.1 there is one physically shared main gameplay control panel — `GameControlPanel` or an equivalent common component — used by Torus 2D, Cube 2D, Cube 3D from 0.5, and future views.

Do **not** create separate `TorusPanel`, `CubePanel`, `Cube2DPanel`, `Cube3DPanel`, duplicated JSX/CSS, or independent panel designs. Common state/actions such as current player, move/action number, board size, rules/scoring mode, komi, captures, Pass, Undo, Redo, New Game, and display options evolve in this one component. Mode-specific capabilities may hide an inapplicable control or show a defined disabled state without replacing the panel.

**If a new mode/control cannot fit the shared panel, a required control is missing, or requirements conflict, the agent must not silently create a second panel, move required controls outside it, hide required behavior, or invent a special layout. The conflict must be reported prominently to the user before implementation and requires an explicit product/design decision.**

### GameSession

Application-level coordinator for one game. It accepts commands, calls the command-execution authority/boundary, receives new state/events, updates History, triggers persistence, starts endgame after two consecutive passes, invokes the selected scoring flow after classification, exposes the current state to presentation, and coordinates Undo/Redo and renderer/view transitions.

It does not calculate groups/liberties/captures, topology geometry, or rendering.

### GameAuthority boundary

The architecture keeps a narrow replaceable command execution seam:

- `LocalGameAuthority` — current/local behavior; calls `GameEngine`.
- `RemoteGameAuthority` — future behavior; sends commands through `NetworkTransport` and receives server-authoritative state.

A separate class/file is optional where it would add needless early complexity, but the boundary must remain extractable without rewriting UI or domain logic.

### GameEngine

Pure domain core for Go move mechanics. Preferred shape is equivalent to:

```text
command + state + topology + repetitionPolicy
    → new GameState + DomainEvents | invalid result
```

It owns stone placement, groups, liberties, captures, suicide rejection, turn switching, Pass, consecutive-pass state, capture counters, move/action numbering, and the data needed for ko/repetition checks.

It must not know about React, DOM, SVG, Canvas, Three.js, camera/view state, renderer layout, browser storage, endgame UI, scoring presentation, or networking.

### GameState and ViewState

`GameState` is serializable domain state sufficient for exact continuation and history restoration: occupancy by logical `PointId`, current player, topology/size configuration, rules/scoring selection, komi, captures, action number, pass state, ko/repetition-relevant state, explicit game phase, and endgame/final-result data where applicable.

`ViewState` contains presentation only: zoom, pan, camera, selected/central face, Cube orientation/layout, display options, and animation/view-transition state. Changing ViewState must not create a game move or change scoring/history.

Game phase is one explicit state machine rather than contradictory booleans. Minimum current sequence:

```text
PLAYING → ENDGAME_REVIEW → FINISHED
```

### Topology

Defines the logical graph of playable points. Every current game point has exactly four distinct logical neighbors. Typical logical API includes `getNeighbors(pointId)` and enumeration/validation helpers.

Implementations:

- `TorusTopology` — introduced in 0.1.
- `CubeTopology(N)` — introduced in 0.2.

`CubeTopology` is parameterized by board size `N×N`. Fundamental point mapping, edge transitions, grouping behavior, and GameEngine logic must not be hard-coded to the current UI size buttons. Adding a reasonable new supported size is an application/UI configuration and test change, not a rewrite of topology or rules.

### RepetitionPolicy

Repetition logic is replaceable rather than buried in placement logic. Current architecture supports a basic `SimpleKoPolicy` and an extensible `SuperkoPolicy`/equivalent. History provides only the repetition context needed by the policy.

### History

Linear Undo/Redo is the final current user-facing history model. Passes are normal history actions. Undo restores exact rule-relevant state and creates linear redo future; a new accepted game action after Undo clears that future. Do not introduce branching history without a new live product decision.

### EndgameClassifier and ScoringStrategy

`EndgameClassifier` produces statuses including alive, dead, and seki. It does not calculate the final score.

- `ManualEndgameClassifier` — 0.1+; user's classification is authoritative in 0.1–0.2.
- `AssistedEndgameClassifier` — 0.3+; auto-resolves only obvious/provable cases and routes all uncertain/unproved cases to manual fallback.

`ChineseScoring` and `JapaneseScoring` are separate implementations available from 0.1 and consume the same resolved life/death result. Scoring rules are not spread throughout `GameEngine` or Renderer.

### Persistence

The application depends on a storage/repository abstraction rather than browser APIs directly. The first implementation may use local browser storage; future local or server adapters must be replaceable without changing `GameEngine`.

### PresentationModel

Converts `GameState` + endgame/result + `ViewState` into semantic renderer-facing data: stones, logical PointIds, player, captures, last-move marker, move numbers, territory/dead-stone status, final result, and move-validity presentation data supplied from application/domain logic.

It does not make domain decisions or mutate `GameState`.

### Renderer family and shared BoardTheme

`Torus2DRenderer` (0.1), `Cube2DRenderer` (0.2+), and `Cube3DRenderer` (0.5+) consume shared logical/presentation state and return logical `PointId` from hit testing.

Starting in 0.2, Torus 2D and Cube 2D use one shared `BoardTheme` / shared visual assets for board texture/color, grid language, black/white stone SVG artwork, highlight/shadow semantics, hover preview, last-move marker, move numbers, forbidden marker, endgame annotations, and final territory/dead-stone visualization. Geometry, grid scale, board placement, seams, rotations, and navigation remain renderer-specific.

Do not create independent incompatible visual themes for common 2D board/stone behavior without a new product decision.

### Animation / Effects

Animation consumes domain/view events after state has already changed. Stone placement/capture flight, Torus shifts, Cube layout transitions, and future view-mode transitions are presentation effects. Their callbacks do not define the logical moment or result of a move.

## Cube 2D canonical model (0.2)

### Stable layout invariant

`Cube2DLayout` is renderer-neutral and has exactly **3 rows × 4 columns** (12 slots), with exactly six occupied `Cube2DLayoutCell` entries and six `null` entries:

```text
row 0: null   TOP     null    null
row 1: LEFT   CENTER  RIGHT   BACK
row 2: null   BOTTOM  null    null
```

Each `CubeFace` appears exactly once. A cell carries at least its row/column, face, rotation, central-role information, and the face's `N×N` logical PointIds. A stable Cube 2D scene contains exactly `6 × N × N` visual logical points.

Permanent `isDuplicate`, duplicate face cells, duplicate boards, duplicate logical points, and duplicate hit targets are forbidden.

For a visually continuous horizontal wrap animation only, Renderer may temporarily create a **non-interactive animation-only clone outside `Cube2DLayout`**. It has no independent game state/PointId hit target and must be removed when the transition finishes.

### Orientation and navigation

`CubeOrientation` is the renderer-neutral source for CENTER/LEFT/RIGHT/TOP/BOTTOM/BACK roles and face rotations.

- `moveLeft()` / `moveRight()` select the neighboring side face as the new CENTER and are visualized as an infinite cyclic gallery of the four side faces `LEFT | CENTER | RIGHT | BACK`.
- `moveUp()` / `moveDown()` make TOP/BOTTOM the new CENTER and rebuild the cross from the new orientation.
- TOP and BOTTOM always occupy the fixed slots directly above/below CENTER in stable layout; there is no user-movable vertical anchor.
- Navigation changes only ViewState/orientation/layout, never stones, logical adjacency, history, turn, or rules.

Renderer receives face/rotation/layout data; it must not re-derive Cube geometry from SVG/CSS placement.

### Cube Surface / Spatial Mapping

Starting in 0.2, canonical spatial semantics for Cube points/orientation must remain renderer-neutral — for example a stable face + local coordinate representation and discrete face orientation. This contract is testable headlessly and later feeds Cube 3D. SVG/CSS transforms or Three.js objects are not canonical identity/orientation state.

## Version composition

### 0.1 — Torus 2D

Torus topology; complete local GameEngine/session flow; Chinese/Japanese scoring; manual alive/dead/seki; linear Undo/Redo; local persistence; Torus 2D renderer; topology contract/fixtures/property tests; debug diagnostics.

### 0.2 — Cube 2D

Add parameterized `CubeTopology(N)`, renderer-neutral Cube orientation/spatial mapping, canonical `Cube2DLayout`, and `Cube2DRenderer`; preserve the existing engine/session/scoring/history/persistence stack. Cube 2D uses exactly six unique physical faces and shared Torus/Cube 2D visual assets.

Current live 0.2 internal sequence is summarized as:

- 01.01 — `CubeTopology` foundation remains the logical base;
- 01.02.1 — canonicalize/fix `Cube2DLayout` while preserving `CubeOrientation`/rotation;
- 01.03 — build the renderer on the canonical six-face layout;
- 01.04 — navigation: horizontal cyclic gallery plus vertical CENTER rebuild.

### 0.3 — Automatic/Assisted alive-dead-seki

Add assisted classification over the logical topology graph. Only obvious/provable states may be automatic; uncertain cases use manual fallback. No Cube 3D work belongs to 0.3.

### 0.5 — Cube 3D

Add `Cube3DRenderer` and the Cube 2D ↔ Cube 3D orientation bridge over the already-proven Cube topology/spatial contracts. GameState, GameEngine, scoring, history, endgame, and persistence stay shared.

## Testing boundaries

- **GameEngine:** groups, liberties, captures, suicide, Pass, turn switching, numbering, repetition policy integration.
- **Topology:** four distinct neighbors, no self-links, symmetry/connectivity, Torus wrap, Cube edges/corners, cross-seam groups/captures. Cube tests run across multiple `N`, including even/odd and at least one technical size outside the current UI set.
- **Scoring/endgame:** Chinese and Japanese on classified positions, komi, alive/dead/seki, neutral/seki behavior, manual/assisted boundary.
- **History:** Undo/Redo stone and Pass, exact current player/captures/repetition/pass/endgame restoration, redo clearing after a new action.
- **Renderer contract:** hit testing returns logical PointId; Renderer does not create game truth. Cube 2D tests assert the exact 3×4 slot matrix, six unique faces, six null slots, one interactive representation per logical PointId, rotation from orientation/layout, and no accumulated duplicates after repeated navigation.
- **Persistence:** serialize/save/load restores exact rule-relevant state through the storage abstraction.

Property-based/fuzz tests and regression fixtures are permanent parts of the test strategy, not one-time 0.1 work.

## Development and reuse gates

The live Roadmap requires:

1. **Library/Reuse Review before detailed planning of each major version.** Search current mature libraries/primitives, evaluate use/adapt/oracle/reject, licenses, maintenance, coupling, and topology assumptions.
2. **Targeted reuse search before each technical checkpoint.** Re-check relevant primitives before writing substantial low-level code.
3. **Core → Functional UI → Polish.** Prove the layer's logic/contracts first, then complete usable UI, then visual polish.
4. **Independent testability.** If a layer cannot be tested without a not-yet-created next layer, treat that boundary as suspicious and revisit it.

External libraries should be isolated behind project contracts where practical; they are never the source of truth for GameState or logical topology.

## Future online play

Do not implement network infrastructure merely to prepare an early local release. Preserve the seams instead: serializable semantic commands, deterministic/portable domain transitions, session-level coordination, storage abstraction, and no direct UI-to-storage/network coupling. A future server becomes authoritative for a network game while reusing the same domain rules contract.
