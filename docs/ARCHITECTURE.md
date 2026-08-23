# Game Cube Go — Architecture

# 0. Назначение и границы документа

`ARCHITECTURE.md` — единственный канонический источник технической архитектуры Game Cube Go.

Этот документ отвечает на вопросы:

- какие модули существуют;
- за что каждый модуль отвечает;
- какие зависимости разрешены и запрещены;
- где находятся state boundaries;
- как разделены game engine, topology, renderer, application/session, persistence, scoring и testing;
- какие технические контракты должны оставаться стабильными при развитии продукта.

Этот документ **не владеет**:

- подробным пользовательским поведением, правилами UI, animations, controls и visual requirements — они принадлежат только `docs/GAME_CUBE_GO.md`;
- очередностью разработки, version scope, milestones и checkpoints — они принадлежат только `docs/ROADMAP.md`.

`README.md`, `AGENTS.md`, release notes, issues, PR descriptions и chat history не являются архитектурными источниками истины.

**Правило документации: один нормативный факт — один канонический владелец.** Архитектурные решения не дублируются в product requirements или roadmap.

# 1. Главный архитектурный принцип

Игра разделяется на независимые слои:

```text
Application / Session
        ↓
    Game Engine
        ↓
     Topology

Renderer / UI
        ↓
Presentation Model
        ↓
Application / Session

Scoring / Endgame
        ↓
Topology + Game State

Persistence
        ↓
Application / Session State
```

Ключевое требование: **game state не принадлежит renderer'у**.

Renderer показывает состояние и преобразует пользовательский input в команды. Game Engine изменяет состояние. Topology определяет соседства. Application/Session координирует lifecycle, history, persistence, endgame и scoring.

# 2. State ownership

## 2.1. Canonical Game State

Единственный логический `GameState` содержит данные партии, не зависящие от способа отображения:

- board occupancy;
- current player;
- action/move number;
- captures;
- consecutive passes;
- phase;
- repetition/ko information, необходимую принятой policy;
- данные, нужные для точного Undo/Redo.

Он не содержит:

- screen coordinates;
- zoom;
- pan;
- camera angle;
- текущую 2D layout permutation;
- animation progress;
- duplicate visual copies;
- hover state.

## 2.2. View State

View state принадлежит конкретному renderer/presentation layer.

Примеры:

- Torus visual offset;
- Cube 2D center face;
- Cube 2D vertical-pair column;
- zoom/pan;
- Cube 3D camera orientation;
- transition/animation state;
- hover point;
- временные animation-only copies.

View state никогда не меняет logical game state.

## 2.3. Session State

`GameSession` объединяет:

- текущий GameState;
- history past/present/future;
- endgame review state;
- final classification;
- final score;
- persistence revision/order.

Session является authoritative boundary для игровых действий из UI.

# 3. Dependency rules

Разрешённые зависимости:

```text
Topology ← Game Engine ← Game Session ← Application
Topology ← Scoring
Topology ← Endgame Classifier
Game State ← Presentation Model ← Renderer/UI
Game Session Snapshot ← Persistence Adapter
```

Запрещённые зависимости:

- Game Engine → renderer;
- Topology → renderer;
- scoring → renderer;
- persistence → renderer;
- renderer → прямое изменение GameState;
- UI → прямой вызов внутренних mutation методов Game Engine минуя GameSession;
- Torus renderer → Cube renderer state;
- Cube renderer → Torus renderer state.

Общий код между renderer'ами выносится в shared presentation/renderer utilities, а не копируется через взаимные зависимости.

# 4. Topology abstraction

Topology отвечает только за логическую структуру поверхности.

Минимальный контракт:

```ts
interface Topology {
  readonly id: string;
  points(): readonly PointId[];
  has(point: PointId): boolean;
  neighbors(point: PointId): readonly PointId[];
}
```

Topology определяет:

- набор logical points;
- соседство каждой точки;
- wrap/seam transitions;
- стабильные PointId.

Topology **не** определяет:

- правила Go;
- UI layout;
- screen coordinates;
- animations;
- scoring mode;
- visual duplicate copies.

# 5. TorusTopology

`TorusTopology` представляет N×N logical grid с wrap по обеим осям.

PointId должен быть стабильным и однозначным для одной logical intersection независимо от текущего visual offset.

Для каждой точки:

- left/right wrap через modulo N;
- top/bottom wrap через modulo N;
- ровно четыре logical neighbors.

Navigation Torus изменяет только visual mapping logical→screen; topology остаётся неизменной.

# 6. CubeTopology

`CubeTopology` представляет шесть N×N faces куба.

PointId кодирует:

- face id;
- row;
- column.

Topology хранит канонический edge-transition mapping между faces.

При переходе через edge CubeTopology отвечает за:

- target face;
- target row/column;
- необходимое изменение ориентации локальной coordinate frame.

Game Engine видит только итоговых logical neighbors и не знает, через какой physical edge произошёл переход.

Cube 2D и Cube 3D используют **один и тот же** CubeTopology и один GameState.

# 7. Game Engine

`GameEngine` реализует правила, одинаковые для всех topology.

Ответственность:

- place stone;
- определить группу;
- считать liberties;
- captures;
- suicide;
- simple ko/repetition policy;
- Pass transition;
- смена игрока;
- увеличение action number;
- переход playing → endgame после двух Pass.

Engine получает Topology через dependency injection и не содержит `if torus` / `if cube` для базовых правил.

Предпочтительный публичный API:

```ts
placeStone(state, point, color, repetitionContext)
pass(state)
groupAt(state, point)
moveAvailability(state, point, repetitionContext)
```

Mutation выполняется функционально: accepted command возвращает новый immutable state/result.

# 8. Repetition policy

В текущей архитектуре policy фиксирована как `SimpleKoPolicy`.

Game Engine получает только минимальный контекст, необходимый для immediate-ko проверки.

Architecture не должна предполагать хранение полного superko-set как обязательную часть GameState.

Если в будущем roadmap/product изменит repetition rule, policy может быть заменена через отдельный abstraction, не переписывая renderer или topology.

# 9. GameSession

`GameSession` — основной mutation boundary приложения.

UI/controllers отправляют session commands, а не изменяют engine state напрямую.

GameSession отвечает за:

- current GameState;
- Undo;
- Redo;
- clearing redo-future после нового действия;
- Pass;
- переход в endgame;
- Assisted Endgame review;
- final classification;
- scoring;
- autosave.

GameSession должен позволять:

```ts
placeStone(point)
pass()
undo()
redo()
setEndgameDecision(groupId, status)
finishEndgame()
snapshot()
```

Renderer/controller получает presentation-friendly result, но authoritative state остаётся внутри session.

# 10. History model

History линейная.

Хранится:

```text
past states | current state | redo future
```

Каждый accepted gameplay action создаёт новый history state:

- stone placement;
- Pass.

Endgame decisions/result metadata versioned вместе с соответствующим current/history state, чтобы Undo/Redo после завершения партии точно восстанавливал session.

После Undo новый gameplay action очищает redo future.

Navigation/view actions в history партии не входят.

# 11. Endgame architecture

Endgame отделён от базового Game Engine.

```text
GameSession
   ↓
EndgameClassifier
   ↓
EndgameReviewState
   ↓
ScoringStrategy
```

## 11.1. EndgameClassifier

Classifier получает:

- immutable GameState;
- Topology;
- список logical groups.

Возвращает proposal для каждой группы:

```ts
status: alive | dead | seki | unresolved
source/evidence
```

Classifier не меняет GameState и не выполняет scoring.

## 11.2. Assisted classifier

Automatic layer должен быть conservative.

Разрешено автоматически возвращать только доказанные статусы. Неуверенный случай становится `unresolved`.

Classifier может быть pipeline из независимых proof modules:

```text
ObviousAliveProof
ObviousDeadProof
ProvenSekiProof
FallbackUnresolved
```

Добавление нового proof module не должно менять GameSession API.

## 11.3. Review state

`EndgameReviewState` хранит для каждой logical group:

- classifier proposal;
- optional user decision;
- effective status.

User decision имеет приоритет над proposal.

Final classification создаётся только когда все обязательные groups resolved.

# 12. Scoring abstraction

Scoring выполняется strategy abstraction:

```ts
interface ScoringStrategy {
  score(input): FinalScore;
}
```

Реализации:

- `ChineseScoring`;
- `JapaneseScoring`.

Scoring получает:

- immutable board/game state;
- final endgame classification;
- topology;
- komi;
- capture counters.

Scoring не знает про renderer, layout или UI.

Territory analysis работает через topology graph flood-fill, поэтому одинаковый algorithm используется для Torus и Cube.

# 13. Presentation Model

Presentation Model — единственный слой, который переводит authoritative session/game state в renderer-friendly данные.

Он формирует:

- current turn;
- stone occupancy;
- move numbers;
- last-move marker;
- capture counters;
- allowed/forbidden move state;
- endgame group presentation;
- territory visualization;
- final result model.

Presentation Model не владеет history и не принимает gameplay decisions.

# 14. Renderer split

Renderer'ы независимы по view state, но используют общий presentation input.

```text
Torus2DRenderer
Cube2DRenderer
Cube3DRenderer (future)
Torus3DRenderer (future)
```

Renderer отвечает за:

- logical point → screen transform;
- visual layout;
- animation;
- input hit-testing;
- temporary visual copies;
- zoom/pan/camera.

Renderer не отвечает за:

- captures logic;
- suicide;
- ko;
- turn order;
- scoring;
- endgame decisions.

## 14.1. Shared 2D visual primitives

Torus 2D и Cube 2D используют shared primitives для:

- stone artwork;
- hover stone;
- forbidden marker;
- last move marker;
- move number label;
- group annotation;
- territory overlay;
- capture-flight visuals.

Это предотвращает расхождение visual semantics между topology.

# 15. Torus 2D renderer architecture

Torus renderer хранит view state:

```ts
{
  offsetX,
  offsetY,
  zoom,
  panX,
  panY,
  navigationAnimation,
  duplicateRegionsVisible
}
```

Logical board никогда физически не переставляется в GameState.

Visual point определяется:

```text
screenCell = logicalCell + visualOffset mod N
```

Duplicate strips — projection layer того же logical point, а не отдельные game points.

Они не имеют независимых hit targets/state.

Navigation animation может использовать temporary visual copies, но stable renderer state содержит один основной mapping.

# 16. Cube 2D renderer architecture

Cube 2D renderer хранит:

```ts
{
  centerFace,
  sideRing,
  topFace,
  bottomFace,
  verticalPairColumn,
  perFaceScreenRotation,
  zoom,
  pan,
  transitionState
}
```

Это view model CubeTopology, а не копия game state.

Stable layout содержит шесть unique physical faces.

Temporary clone допускается только внутри animation layer для seamless horizontal wrap и не получает interaction.

## 16.1. Layout derivation

При выборе нового center face layout должен пересчитываться из canonical CubeTopology orientation, а не накапливать произвольные rotate mutations.

Предпочтительно хранить logical orientation/frame и каждый раз derive:

- side ring;
- top/bottom;
- screen rotation.

Это предотвращает orientation drift после длинной последовательности `← → ↑ ↓`.

# 17. Cube 3D renderer architecture

Будущий Cube 3D использует тот же CubeTopology и GameSession.

3D layer добавляет только:

- surface mesh;
- logical point → 3D coordinate mapping;
- camera;
- raycasting/hit testing;
- rotation/zoom animation.

Game Engine не получает 3D coordinates.

Spatial anchor 2D↔3D реализуется adapter'ом между view states, а не изменением logical board.

# 18. Общая application shell / control panel

Физически существует один reusable game control panel.

Renderer-specific screen предоставляет только:

- board view;
- renderer-specific navigation/view controls;
- renderer-specific display option availability.

Общая panel получает один normalized interface от controller/application:

```ts
GameControlViewModel
GameControlCommands
```

Torus/Cube renderer не должен иметь отдельные forked реализации Pass/Undo/Redo/New Game/current turn/captures.

# 19. Persistence architecture

Persistence отделена interface:

```ts
interface GameRepository<TSnapshot> {
  save(game)
  load(id)
  remove(id)
}
```

Browser implementation использует local storage/IndexedDB по текущей необходимости, но GameSession не зависит от конкретного storage API.

Snapshot содержит только session/game data, необходимую для точного Continue:

- topology descriptor/board size;
- rules;
- komi;
- history states;
- redo future;
- endgame review/classification;
- final score;
- session revision.

Renderer/view state может не сохраняться, если product requirements этого не требуют.

## 19.1. Ordered saves

Autosave operations могут завершаться в другом порядке, поэтому persistence writer должен защищаться от stale overwrite.

Используется monotonic session revision / ordered save coordinator.

Старый async save не имеет права затереть более новый snapshot.

# 20. Testing architecture

Testing разделяется по слоям.

## 20.1. Topology tests

Проверяют:

- количество points;
- ровно четыре neighbors;
- reciprocity соседства;
- Torus wrap;
- Cube edge mappings;
- Cube corner consistency.

## 20.2. Game Engine tests

Проверяют один и тот же набор правил на разных topology fixtures:

- placement;
- capture;
- multi-group capture;
- suicide;
- ko;
- Pass;
- phase transition.

## 20.3. Session tests

Проверяют:

- history;
- Undo/Redo;
- redo invalidation;
- Pass state;
- endgame entry;
- endgame decisions;
- persistence snapshots;
- reload with redo;
- autosave ordering.

## 20.4. Scoring tests

Проверяют:

- territory flood fill;
- neutral/seki regions;
- Chinese formula;
- Japanese prisoners/dead stones;
- komi.

## 20.5. Renderer/presentation tests

Проверяют mapping и interaction, но не повторяют engine rules.

Examples:

- Torus duplicate strips map correct logical points;
- Cube 2D face orientation after navigation;
- move numbers remain upright;
- animation-only copy is non-interactive;
- zoom/pan does not mutate game state.

## 20.6. E2E acceptance

Playwright проверяет критические user flows:

- start game;
- legal move;
- capture;
- Pass protection;
- Undo/Redo;
- reload;
- endgame review;
- final result;
- New Game confirmation;
- key renderer navigation interactions.

# 21. CI architecture

Обычный PR CI выполняет:

1. lint;
2. typecheck;
3. unit/integration tests с coverage thresholds;
4. build;
5. Chromium E2E.

Полный CI (`[full]`) дополнительно выполняет cross-browser Playwright:

- Chromium;
- Firefox;
- WebKit.

Coverage thresholds являются blocking requirement, а не информационной метрикой.

# 22. Architectural invariants

Следующие invariants считаются обязательными:

1. Renderer никогда не является источником истины game state.
2. Одна logical point имеет один stable PointId.
3. Visual duplicate не является второй игровой точкой.
4. Navigation/view transforms не попадают в gameplay history.
5. Torus и Cube используют один rule engine.
6. Cube 2D и Cube 3D используют один CubeTopology и один GameSession.
7. UI не обходит GameSession для gameplay mutation.
8. Endgame classifier conservative: uncertainty → unresolved.
9. Scoring работает только с logical topology/state, не с screen layout.
10. Persistence serializes session state, не DOM/renderer objects.
11. Async autosave не может откатить более новый snapshot.
12. Temporary animation copies всегда non-interactive.
13. User-facing renderer switching никогда не создаёт новую партию или копию GameState.

# 23. Dependency policy

Новые внешние библиотеки принимаются только если они:

- решают изолированную техническую задачу;
- не становятся вторым источником истины правил игры;
- не требуют renderer-specific game logic;
- имеют приемлемую лицензию;
- могут быть обёрнуты внутренним adapter/interface;
- могут быть заменены без изменения canonical GameState/Topology contracts.

Тяжёлые external engines/AI не входят в runtime основной игры без отдельного архитектурного решения.

# 24. Live seeded generation and manual replay boundary

Live test generation расширяет testing architecture, но не создаёт второй игровой engine или отдельную UI/session model.

## 24.1. Case identity и versioning

Каноническая identity live generated case задаётся одним immutable `LiveTestGenerationSpec`:

```ts
{
  generator: 'game-like' | 'endgame',
  topology: 'torus' | 'cube',
  size: number,
  seed: string
}
```

`LiveTestGeneratedCase` дополнительно содержит explicit generator version. При одной версии одинаковые `generator + topology + size + seed` обязаны давать тот же scenario, ту же sequence/setup и тот же final generated state.

Поведение уже опубликованной generator version считается immutable replay contract. Изменение алгоритма, которое меняет результат существующего tuple, требует новой generator version, а не молчаливого изменения старой.

Существующий `ENDGAME_TEST_GENERATOR_VERSION = 1` и его historical deterministic fixtures остаются отдельным стабильным контрактом и не переписываются ради live UI.

## 24.2. Shared generator infrastructure

`GameLikeGenerator` и `EndgameGenerator` являются тонкими consumers одного shared seeded API и одного deterministic RNG contract. Они не имеют независимых seed/replay механизмов.

`game-like` всегда строит последовательность accepted игровых действий через настоящий `GameEngine`, `Topology` и стандартный repetition context. Он не записывает occupancy напрямую в `GameState`.

Move-selection policy для `game-like` является tactical/local, а не uniform random scatter. Она отдаёт приоритет contact play, соединениям и разрезаниям групп, защите threatened groups, atari/capture opportunities и ограниченному exploration/tenuki. Structural quality фиксированных seed является частью regression tests.

`endgame` использует тот же case identity/versioning, но детерминированно выбирает scenario из общего corpus. Corpus сочетает:

- legal tactical endgame-oriented sequence;
- existing synthetic life/death patterns (`two-eyes`, `single-eye`, `false-eye`, `atari-group`);
- existing seki/ambiguous patterns (`shared-liberties`, `ambiguous-contact`);
- topology stress fixtures для Torus seam и Cube edge/corner.

Synthetic setup является разрешённым исключением только внутри test infrastructure: он может построить валидную board position напрямую для точного локального motif. Такой путь не становится production game setup API и не используется `game-like`.

Если выбранный synthetic motif физически не помещается на topology/size, generator остаётся работоспособным и использует legal tactical fallback.

## 24.3. Loading generated cases into GameSession

Live generated case явно сообщает `loadStrategy`.

Для `replay-commands` application создаёт обычную новую session и повторно отправляет каждый generated command через presentation controller → `GameSession`. Поэтому history, captures, Undo/Redo, Pass, autosave и дальнейшие ходы имеют ровно обычную семантику партии.

Для разрешённого synthetic endgame case application создаёт стандартный `GameSessionSnapshot`, где synthetic position является initial playing state session. После этой boundary любые пользовательские mutations снова проходят только через `GameSession`. Synthetic case загружается с `phase = playing` и `consecutivePasses = 0`, чтобы обычный `Pass → Pass` запускал тот же assisted review/scoring flow, что и в реальной партии.

UI не получает право изменять `GameState` напрямую ни для одного load strategy.

## 24.4. Consumers и developer UI boundary

Один и тот же live generator API предназначен для четырёх consumers:

```text
Manual developer UI → one case
Automated regression tests → many cases
Deep local runner → thousands of cases
Future KataGo differential runner → the same cases
```

Manual controls являются presentation-only consumer. Они подключаются к существующей общей панели через application/context boundary и могут быть полностью скрыты/удалены из production UI без удаления core generators, deterministic replay или test infrastructure.

Vite development mode может показывать controls автоматически; явный developer feature flag может включать их в специальной test build. Production gameplay не должен зависеть от наличия этих controls.