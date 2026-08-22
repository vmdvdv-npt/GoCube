# Архитектура

## Game Cube Go — каноническая архитектурная спецификация

# 0. Назначение и границы документа

`ARCHITECTURE.md` — единственный канонический источник архитектуры Game Cube Go: ответственности модулей, контрактов, направлений зависимостей, state boundaries, renderer/topology/game-engine separation, persistence, testing architecture, library policy и технических принципов.

Этот документ отвечает на вопрос **как система устроена технически**.

Он намеренно не владеет двумя другими типами информации:

- подробное пользовательское поведение, UI/UX, визуальные параметры и анимационные требования находятся только в `docs/GAME_CUBE_GO.md`;
- версии, `introducedIn`, milestones, checkpoints и порядок разработки находятся только в `docs/ROADMAP.md`.

Если архитектурному разделу нужно сослаться на пользовательское ограничение или срок появления функции, он должен ссылаться на соответствующий канонический документ, а не копировать его содержимое.

**Правило документации: один нормативный факт — один канонический владелец.** Архитектурный факт не должен иметь вторую нормативную копию в `GAME_CUBE_GO.md` или `ROADMAP.md`.

При любой задаче по коду сначала проверяется, не нарушает ли изменение описанные здесь границы. Если реализация требует смешать Game Engine, topology, renderer, persistence, history, scoring или infrastructure, это считается архитектурным риском и сначала ищется решение через существующий либо новый узкий контракт.

# 1. Главные архитектурные инварианты

1. UI не изменяет `GameState` напрямую.
2. UI не вызывает `GameEngine` напрямую; игровые команды проходят через `GameSession`.
3. `GameSession` является application-level координатором одной партии.
4. `GameEngine` отвечает только за доменную механику хода и не координирует UI, persistence, history или rendering.
5. `GameEngine` не знает, используется Torus или Cube; он работает через интерфейс `Topology`.
6. `GameEngine` не знает о DOM, React, SVG, Canvas, CSS transforms, Three.js, камере, zoom/pan, layout и visual duplicates.
7. `Topology` описывает логическую связность игровых точек и не содержит renderer-specific координаты.
8. `Renderer` не решает правила игры, не создаёт авторитетное игровое состояние и не изменяет `GameState`.
9. `GameState` представляет один текущий rule-relevant snapshot; `History` является отдельным владельцем past/current/redo timeline.
10. `History` никогда не является полем `GameState`, а `GameEngine` никогда не владеет объектом `History`.
11. Для repetition-check `GameEngine` получает только минимальный `RepetitionContext`, подготовленный application/session layer.
12. `ViewState` отделён от `GameState`; изменение камеры, zoom, pan, layout или orientation не является игровым действием.
13. `ScoringStrategy` не определяет жизнь/смерть групп; он получает готовую `EndgameClassification`.
14. `EndgameClassifier` не содержит формулы Chinese/Japanese scoring.
15. `Animation` является визуальной реакцией на уже принятое доменное изменение и не определяет результат хода.
16. Все rule-relevant данные сериализуемы и детерминированно восстанавливаемы.
17. Основные модули зависят от абстракций/контрактов, а не от конкретных browser/rendering/storage реализаций.
18. Сеть подключается снаружи доменного ядра; `GameEngine`, `Topology`, `ScoringStrategy` и `EndgameClassifier` не знают о transport layer.
19. Логический `PointId` не зависит от конкретного Renderer и сохраняет идентичность при полной замене способа отображения.
20. Cube surface/orientation semantics имеют renderer-neutral представление; SVG/CSS/Three.js не являются каноническим источником пространственной истины.
21. В проекте существует одна физически общая реализация основной панели управления; renderer-specific режимы не владеют собственными копиями панели.
22. Общие 2D visual assets/theme имеют одного владельца в presentation/renderer layer и не дублируются независимо для Torus 2D и Cube 2D.
23. Один и тот же текущий `GameState` используется всеми доступными представлениями данной партии; смена Renderer не создаёт отдельную версию игрового состояния.
24. Стадия партии задаётся одной явной state machine, а не набором независимо изменяемых boolean-флагов.

Стрелка `A → B` в этом документе означает: `A` использует контракт `B` или передаёт ему данные/команду. Она не означает наследование.

# 2. Верхнеуровневая карта модулей

Базовый локальный путь игровой команды:

`UI/Input → GameSession → LocalGameAuthority/GameEngine → GameState + DomainEvents → GameSession`

Перед rule-check, требующим данных о предыдущих состояниях:

`GameSession → History → RepetitionContext → GameEngine/RepetitionPolicy`

После принятого игрового изменения:

`GameSession → History`

`GameSession → GameStorage`

`GameSession → PresentationModel → active Renderer`

Для endgame:

`GameSession → EndgameClassifier → ScoringStrategy → FinalScore`

Доменный `GameEngine` внутри обработки команды использует:

`GameEngine → Topology`

`GameEngine → RepetitionPolicy`

Будущий удалённый путь заменяет только execution boundary:

`UI → GameSession → RemoteGameAuthority → NetworkTransport → server-side GameSession/GameEngine → authoritative result → GameSession`

# 3. UI / Input и единая панель управления

UI отвечает за визуальные controls, pointer/input и формирование пользовательских намерений.

Игровые команды представлены доменными/application intents, например:

- `PlaceStone(pointId)`;
- `Pass`;
- `Undo`;
- `Redo`;
- `NewGame(settings)`;
- `ChangeViewMode(mode)`;
- `NavigateView(direction)`;
- `ChangeKomi(value)`;
- `ChangeRules(ruleSet)`.

UI получает `logical PointId` от hit-testing активного Renderer и передаёт игровую команду в `GameSession`. Чисто визуальные команды могут идти в presentation/view layer, но не меняют доменное состояние.

UI не знает алгоритмы групп, liberties, captures, suicide, ko/repetition, endgame classification или scoring.

## 3.1. GameControlPanel

Основная служебная панель реализуется одним физически общим компонентом `GameControlPanel` или эквивалентом с тем же архитектурным смыслом.

Запрещено создавать независимые `TorusPanel`, `CubePanel`, `Cube2DPanel`, `Cube3DPanel` или копировать JSX/HTML/CSS основной панели внутрь Renderer.

Renderer отвечает за игровое поле и renderer-specific interaction. Панель находится над различиями Renderer и получает общие данные/commands через единый application/presentation API.

Если control неприменим к конкретному режиму, общий компонент может использовать capabilities текущего режима и выбрать предусмотренное product requirements состояние: скрыть control или показать disabled-state. Это не является основанием создавать другую панель.

Изменение структуры или реализации общего control выполняется централизованно и автоматически применяется ко всем режимам, использующим этот control. Точное визуальное оформление и пользовательское поведение панели определяет `docs/GAME_CUBE_GO.md`.

Если новая функция создаёт конфликт, при котором единая панель не может корректно вместить обязательные controls или требования режимов несовместимы, нельзя молча создавать исключение, вторую панель, отдельную раскладку одного режима, переносить обязательную функцию наружу либо менять архитектуру панели без решения пользователя.

**!!! ВНИМАНИЕ: ПРОБЛЕМА С ЕДИНОЙ ПАНЕЛЬЮ УПРАВЛЕНИЯ !!!**

В такой ситуации агент обязан до реализации явно сообщить пользователю о конкретном конфликте и запросить решение. До решения пользователя архитектура панели не меняется и обходной вариант не внедряется.

# 4. GameSession

`GameSession` — application-level координатор одной партии и основная точка входа для игровых команд от UI.

`GameSession` отвечает за orchestration:

- принять command;
- получить current `GameState`;
- запросить у `History` минимальный `RepetitionContext`, когда он нужен;
- передать доменную команду в `GameAuthority` или локальный `GameEngine`;
- получить новый `GameState` и `DomainEvents`;
- обновить `History`;
- инициировать autosave через `GameStorage`;
- запустить endgame flow при выполнении доменного условия завершения основной фазы;
- передать `EndgameClassification` в выбранную `ScoringStrategy`;
- хранить/восстанавливать session-level metadata, не принадлежащие одному `GameState` snapshot;
- передать актуальное состояние в `PresentationModel`;
- координировать Undo/Redo;
- координировать смену view mode без изменения `GameState`;
- координировать временную блокировку игрового input во время presentation transitions, когда этого требует продуктовый UX.

`GameSession` не отвечает за:

- поиск групп и liberties;
- captures и suicide;
- ko/repetition algorithm;
- геометрию Torus/Cube;
- drawing/hit-testing;
- физический storage backend.

# 5. GameAuthority — execution seam

`GameAuthority` — заменяемая граница между `GameSession` и местом исполнения доменной команды.

Рекомендуемый смысл контракта:

`execute(command, currentContext) → authoritative result/state/events`

Реализации:

- `LocalGameAuthority` вызывает локальный `GameEngine`;
- `RemoteGameAuthority` в будущем использует `NetworkTransport` и принимает подтверждённый сервером результат.

Отдельный класс `GameAuthority` не обязан существовать, если текущей реализации достаточно узкой функции/adapter boundary. Важно сохранить заменяемую границу, чтобы удалённое исполнение не потребовало переписывать UI или domain core.

UI не должен знать, local или remote execution используется партией.

# 6. GameEngine

`GameEngine` — чистое доменное ядро механики Go.

Предпочтительная модель:

`command + state + topology + rule context → new state + domain events`

Пример контракта:

`applyCommand(state, command, topology, repetitionPolicy, repetitionContext) → EngineResult`

`EngineResult` содержит новый `GameState` либо структурированную причину недопустимости и набор `DomainEvents`.

`GameEngine` реализует доменные операции, включая:

- постановку камня;
- формирование/объединение групп;
- liberties;
- captures;
- suicide validation;
- turn switching;
- Pass как игровое действие;
- consecutive pass state;
- capture counters;
- action/move number;
- candidate-state данные для repetition validation.

`GameEngine` использует только доменные зависимости, прежде всего `Topology` и `RepetitionPolicy`.

`GameEngine` не использует и не владеет:

- `History`;
- `Renderer`;
- `PresentationModel`;
- `GameStorage`;
- browser storage APIs;
- React/DOM/SVG/Canvas/Three.js;
- `EndgameClassifier`;
- `ScoringStrategy`;
- `NetworkTransport`.

# 7. State boundaries

## 7.1. GameState

`GameState` — один сериализуемый доменный snapshot изменяемого rule-relevant состояния в конкретный момент партии. Он не является контейнером всей сессии.

`GameState` должен содержать или однозначно позволять восстановить динамические данные текущей позиции/фазы, необходимые для правил и точного Undo/Redo, включая:

- board occupancy по `logical PointId`;
- `currentPlayer`;
- capture counters;
- action/move number;
- `consecutivePasses`;
- текущий `GamePhase`;
- rule/repetition-relevant данные текущего snapshot, которые не выводятся из переданного `RepetitionContext`;
- другие динамические поля, непосредственно влияющие на применение правил из этого snapshot.

Внутри `GameState` запрещены:

- `History` или redo-future;
- DOM nodes;
- SVG/Canvas objects;
- Three.js objects;
- camera/layout/animation state;
- browser storage handles;
- network connections.

## 7.2. GamePhase state machine

Канонические базовые состояния стадии партии:

`PLAYING → ENDGAME_REVIEW → FINISHED`

- `PLAYING` — основная игровая фаза.
- Выполнение доменного условия окончания основной фазы переводит партию в `ENDGAME_REVIEW`.
- Завершённая обязательная endgame classification и расчёт результата переводят партию в `FINISHED`.
- Undo/Redo восстанавливают соответствующий прежний/следующий `GamePhase` вместе с остальным rule-relevant state и session-level endgame/result metadata.
- Нельзя использовать несколько независимых boolean-флагов как параллельные источники истины о стадии партии.
- Если в будущем понадобится новая стадия, расширяется одна state machine, а не добавляется несогласованный флаг.

Точное пользовательское действие, запускающее переходы, и UX каждой стадии определяет `docs/GAME_CUBE_GO.md`.

## 7.3. GameSessionSnapshot

Статическая конфигурация партии и данные, принадлежащие всей сессии, сериализуются в `GameSessionSnapshot` или эквивалентном session envelope.

Он может включать:

- topology identity и size;
- rules/scoring mode;
- komi;
- сериализованную `History` timeline;
- redo-future;
- current `GameState`;
- `EndgameClassification`/`FinalScore` metadata, если они нужны для точного current/redo restoration;
- schema/version metadata;
- `PlayerSlot` или эквивалентные session-level player identifiers, если они используются.

`PlayerSlot` может иметь внутренний id и цвет без требования аккаунта. Будущая привязка аккаунта относится к session/infrastructure layer и не должна менять правила Go.

## 7.4. ViewState

`ViewState` содержит только presentation state, например:

- zoom;
- pan;
- camera orientation;
- active view mode;
- Cube orientation anchor;
- Cube 2D presentation layout state;
- Torus visual offset;
- display options;
- transition/interaction state, если он нужен Renderer.

`ViewState` не читается `GameEngine`, `ScoringStrategy`, `EndgameClassifier` или repetition logic и не является частью игровой history timeline.

Сохранение `ViewState` допускается отдельно, если этого требует продукт, но отсутствие или сброс `ViewState` не должен менять восстановленную игровую сессию.

## 7.5. Schema evolution

Форматы `GameState` и session persistence имеют явную schema/version boundary. Фундаментальное изменение смысла сохранённых данных требует миграции/совместимости либо осознанного изменения schema version; нельзя молча переинтерпретировать старые сохранения.

# 8. Topology

`Topology` скрывает форму игрового мира и предоставляет логическую связность точек.

Минимальный контракт:

`getNeighbors(pointId) → readonly PointId[]`

Допустимы дополнительные логические методы, например:

- `getAllPoints()`;
- `validate()`;
- получение logical board/face identifiers;
- преобразования между стабильным `PointId` и topology-local coordinates.

`Topology` не возвращает screen coordinates, DOM positions или Three.js vectors как часть доменного контракта.

## 8.1. Topology Contract

Каждая реализация `Topology` обязана удовлетворять общему контракту:

- каждая игровая точка имеет ровно четыре **различных** логических соседа;
- self-links отсутствуют;
- соседство симметрично;
- граф игровых точек связен;
- `PointId` стабилен и не зависит от Renderer/ViewState;
- одинаковая topology configuration детерминированно создаёт одинаковую logical graph identity;
- topology-specific edge/corner transitions согласованы с тем же общим контрактом.

Новая или изменённая topology не считается корректной, пока не проходит общий контракт и свои topology-specific tests.

## 8.2. TorusTopology

`TorusTopology` реализует логическое wrap-соседство по обеим осям обычной квадратной N×N сетки.

Visual offset, duplicate edge strips и другие особенности Torus 2D не входят в `TorusTopology`; это renderer/ViewState concerns.

## 8.3. CubeTopology

`CubeTopology` содержит шесть логических `CubeFace` и корректные переходы через их рёбра/углы.

Размер является параметром `N×N`; фундаментальная логика `CubeTopology`, `PointId` mapping и edge transitions не должна содержать отдельные реализации или hardcode для конкретного набора UI-кнопок размеров.

Группы, liberties, captures, ko/repetition и scoring не получают отдельные «cube versions»: они используют общий `Topology` contract.

## 8.4. CubeOrientation

`CubeOrientation` — renderer-neutral дискретная модель того, какая физическая грань выполняет пространственную роль CENTER/LEFT/RIGHT/TOP/BOTTOM/BACK и какой quarter-turn нужен для согласованной ориентации.

`CubeOrientation` не содержит screen coordinates, CSS transforms или 3D-library objects.

Навигационные изменения ориентации возвращают новую дискретную orientation model; визуальный способ перехода принадлежит Renderer/Animation и определяется продуктовым документом.

## 8.5. Cube2DLayout

`Cube2DLayout` — renderer-neutral presentation mapping между текущей `CubeOrientation` и product-defined Cube 2D screen slots.

Типовая cell-модель содержит:

- `row`;
- `column`;
- `face: CubeFace`;
- `rotation: CubeRotation`;
- `isCentral`;
- `pointIds[N][N]`.

Канонические пользовательские правила расположения slots, пустых областей и взаимодействия определяет `docs/GAME_CUBE_GO.md`; архитектура фиксирует только следующие границы:

- каждая физическая `CubeFace` имеет не более одного стабильного игрового layout representation;
- каждая logical `PointId` имеет одно стабильное interactive representation в Cube 2D;
- `Cube2DLayout` не создаёт логические duplicates;
- поле `isDuplicate` не является частью канонической cell-модели;
- renderer-only temporary animation element не становится `Cube2DLayoutCell`, `PointId` или hit target;
- presentation-only параметры layout хранятся в `ViewState`, а не в `GameState` или `CubeTopology`.

Если текущая продуктовая модель использует `verticalAnchorColumn`, это presentation-only поле Cube 2D `ViewState`; его пользовательская семантика и допустимые значения принадлежат `GAME_CUBE_GO.md`.

# 9. Cube Surface / Spatial Mapping Contract

Cube 2D и Cube 3D должны использовать одну renderer-neutral пространственную семантику куба.

Для каждой logical `PointId` куба доступна стабильная каноническая привязка к поверхности, например:

`FaceId + local u/v`

или функционально эквивалентная структура.

Контракт также определяет:

- каноническую ориентацию каждой `CubeFace`;
- преобразования между face-local coordinates и `PointId`;
- согласованные переходы между сторонами соседних граней;
- round-trip свойства преобразований;
- renderer-neutral orientation anchor.

Spatial mapping **не заменяет** `Topology.getNeighbors(pointId)` как источник истины по игровому соседству. `Topology` определяет logical graph; spatial mapping определяет, где и как тот же граф представлен на поверхности. Несогласованность между ними является ошибкой.

Ориентационный anchor между 2D и 3D хранится в дискретной renderer-neutral форме, например:

`FaceId + quarterTurns(0..3)`

или эквиваленте.

2D Renderer преобразует эту модель в свои screen transforms. 3D Renderer преобразует её в camera/object transforms выбранной 3D-библиотеки.

Следующие объекты никогда не являются канонической spatial state:

- SVG transform matrix;
- CSS transform;
- DOM layout position;
- canvas pixel coordinates;
- Three.js `Quaternion`, `Matrix`, `Object3D` или mesh id;
- renderer-specific UUID/index.

`PointId` запрещено выводить из этих renderer-specific значений.

# 10. RepetitionPolicy

Контракт:

`isAllowed(repetitionContext, candidateState) → result`

Поддерживаемые реализации могут включать:

- `SimpleKoPolicy`;
- `SuperkoPolicy`.

`GameEngine` делегирует repetition validation выбранной policy и не зашивает единственный вариант глубоко внутрь placement logic.

`GameSession` запрашивает у `History` только минимальные позиции/хэши/данные, необходимые текущей policy, формирует `RepetitionContext` и передаёт его в доменный вызов.

Ни `RepetitionPolicy`, ни `GameEngine` не получают объект `History` во владение.

# 11. History

Каноническая текущая реализация — линейный `LinearHistory`.

Базовый контракт:

- `push(state/action)`;
- `undo()`;
- `redo()`;
- `canUndo()`;
- `canRedo()`;
- `current()`;
- получить минимальный repetition context;
- serialize/restore past/current/redo timeline.

`History` владеет последовательностью `GameState` snapshots и redo-future. `GameSession` координирует его использование и persistence.

После Undo новое принятое игровое действие очищает redo-future.

Persistence должен сохранять redo-future. После `Undo → save/load` следующий Redo должен оставаться доступным и детерминированно восстанавливать тот же snapshot.

Если current/redo state связан с endgame classification/result, соответствующая session-level metadata сохраняется вместе с timeline так, чтобы exact restoration не зависел от Renderer.

# 12. EndgameClassifier и ScoringStrategy

## 12.1. EndgameClassifier

Контракт:

`classify(finalPosition/context) → EndgameClassification`

`EndgameClassification` представляет статусы групп как минимум:

- alive;
- dead;
- seki.

Реализации могут включать:

- `ManualEndgameClassifier`;
- `AssistedEndgameClassifier`.

Точная доступность реализаций по версиям определяется `docs/ROADMAP.md`; пользовательская семантика ручного/assisted flow — `docs/GAME_CUBE_GO.md`.

`EndgameClassifier` не считает окончательные очки.

## 12.2. ScoringStrategy

Контракт:

`calculate(position, endgameClassification, komi) → FinalScore`

Реализации:

- `ChineseScoring`;
- `JapaneseScoring`.

Scoring получает уже разрешённую `EndgameClassification` и концентрирует формулу соответствующего scoring mode внутри strategy/rule modules, а не размазывает `if japanese/chinese` по `GameEngine`.

`FinalScore` является доменным результатом scoring, а не объектом Renderer/PresentationModel.

# 13. PresentationModel

`PresentationModel` отделяет доменное/session state от конкретного способа рисования.

Вход может включать:

- current `GameState`;
- session configuration;
- endgame/result metadata;
- `ViewState`;
- domain/application queries, нужные для presentation.

Выход — семантический `ViewModel`, который может содержать:

- stones с `PointId`;
- current player;
- last-move data;
- move numbers;
- capture counters;
- allowed/forbidden interaction state;
- territory/endgame presentation data;
- final result;
- topology/render mapping, необходимый Renderer.

`PresentationModel` не принимает доменные решения и не изменяет `GameState`.

# 14. BoardRenderer и конкретные Renderer

Минимальный общий смысл Renderer contract:

- `render(viewModel)`;
- `hitTest(pointer) → logical PointId | null`;
- получить/применить renderer-specific `ViewState` через presentation boundary при необходимости.

Renderer отвечает только за отображение и перевод пользовательского взаимодействия обратно в logical intent/`PointId`.

Renderer запрещено:

- определять соседство;
- вычислять группы/liberties/captures как источник истины;
- решать scoring;
- самостоятельно определять допустимость доменного хода;
- создавать logical `PointId` из screen/DOM/mesh данных;
- хранить авторитетную игровую позицию;
- менять captures/currentPlayer/history.

Конкретные Renderer:

- `Torus2DRenderer`;
- `Cube2DRenderer`;
- `Cube3DRenderer`;
- возможные будущие Renderer.

Их доступность по версиям определяет `ROADMAP.md`.

## 14.1. Shared BoardTheme / visual assets

Torus 2D и Cube 2D используют общий `BoardTheme` и общие 2D visual assets из одного presentation/renderer layer.

В общий технический слой входят общие tokens/assets для:

- board appearance;
- grid language;
- black/white stone artwork;
- hover/marker semantics;
- last-move/move-number presentation;
- forbidden state;
- endgame/territory/dead-stone presentation.

Точные визуальные параметры принадлежат `GAME_CUBE_GO.md`.

Запрещено поддерживать две независимые несовместимые копии одного и того же общего 2D artwork/theme для Torus и Cube без отдельного продуктового решения.

## 14.2. Cube 2D duplicates

Стабильное interactive Cube 2D representation не создаёт дополнительных игровых `PointId`, duplicate hit targets или вторую авторитетную visual copy одной logical точки.

Если продуктовая анимация требует временного renderer-only clone для seamless transition, такой объект:

- существует только во время transition;
- не входит в `Cube2DLayout`;
- не получает нового `PointId`;
- не участвует в hit-testing;
- удаляется после transition.

## 14.3. Torus renderer-only copies

Пассивные Torus duplicate regions, когда они включены продуктовым `ViewState`, являются renderer-only projections исходных `PointId`. Они не расширяют `TorusTopology` и не создают duplicate game state или hit targets.

# 15. Animation / Effects

Animation layer принимает `DomainEvents`/`ViewEvents` и создаёт только визуальные эффекты.

Примеры событий:

- `stonePlaced`;
- `stonesCaptured`;
- `cubeLayoutTransition`;
- `torusShift`;
- `viewModeChanged`;
- start-view appearance events.

Архитектурные правила:

- доменное изменение применяется независимо от длительности animation;
- animation callback не является моментом фактического хода;
- animation не определяет логический порядок captures;
- временная блокировка input является presentation/session coordination, а не domain rule;
- renderer-only copies не превращаются в отдельные доменные объекты из-за анимации;
- точные направления, длительности, easing и visual appearance находятся только в `GAME_CUBE_GO.md`.

# 16. GameStorage и persistence

Канонический application-level storage contract называется `GameStorage`:

- `save(serializableSession)`;
- `load()`;
- `clear()`.

`GameSession` зависит от `GameStorage`, а не от `localStorage`, IndexedDB или server API напрямую.

Локальные adapters могут включать:

- `LocalStorageGameStorage`;
- `IndexedDbGameStorage`.

Будущие remote/cloud persistence adapters не смешиваются с игровым `NetworkTransport`.

Если код использует имя `GameRepository`, оно должно быть либо alias/adapter с тем же единственным application responsibility, либо мигрировано к одному каноническому storage boundary; нельзя поддерживать две конкурирующие абстракции, которые обе претендуют на владение persistence партии.

Сохраняется `GameSessionSnapshot` или эквивалентный envelope, содержащий всё необходимое для exact restoration, включая History redo-future и связанные endgame/result metadata.

Обязательный persistence invariant:

`Undo → save → load → Redo`

должен возвращать тот же следующий state/result, который был доступен до reload.

Runtime validation повреждённых/старых данных и schema migrations должны быть тестируемыми и fail-safe.

# 17. NetworkTransport — внешний будущий слой

`NetworkTransport` не входит в domain core.

Будущий контракт может включать:

- `sendCommand(command)`;
- `subscribeState()`;
- connect/reconnect;
- session/join operations.

`RemoteGameAuthority` использует `NetworkTransport`; `GameEngine` не использует его напрямую.

В сетевой партии сервер является authoritative source игрового состояния. Клиент отправляет intent/command, а сервер повторно валидирует правила и создаёт authoritative state.

UI не должен обращаться к WebSocket/HTTP напрямую для игровых ходов.

Login, matchmaking, lobby, reconnect, spectators и cloud sync остаются infrastructure/application функциями и не проникают в `GameEngine`.

# 18. Основные потоки данных

## 18.1. Допустимый ход

1. Renderer выполняет hit-test и возвращает `PointId`.
2. UI создаёт `PlaceStone(pointId)`.
3. UI передаёт command в `GameSession`.
4. `GameSession` получает current state и при необходимости `RepetitionContext` из `History`.
5. Command передаётся через local authority boundary в `GameEngine`.
6. `GameEngine` использует `Topology` для соседства.
7. `GameEngine` рассчитывает группы/liberties/captures/suicide.
8. `RepetitionPolicy` проверяет candidate state по переданному context.
9. `GameEngine` возвращает новый `GameState + DomainEvents`.
10. `GameSession` обновляет `History`.
11. `GameSession` сохраняет session snapshot через `GameStorage`.
12. `PresentationModel` строит новый `ViewModel`.
13. Renderer отображает его.
14. Animation визуализирует events.

## 18.2. Недопустимый ход

1. Renderer возвращает `PointId`.
2. Domain/application validation возвращает structured invalid result.
3. `GameState` не меняется.
4. `History` не получает новый snapshot.
5. Persistence не записывает новое игровое состояние как принятый ход.
6. Presentation layer показывает product-defined forbidden state.

## 18.3. Pass / endgame

Pass проходит тем же command path, что и другие игровые действия.

Когда доменное состояние достигает условия перехода к endgame, `GameSession` переводит state machine в `ENDGAME_REVIEW`, запускает `EndgameClassifier`, затем выбранную `ScoringStrategy`, сохраняет результат как session/domain metadata и после завершения flow переводит партию в `FINISHED`.

Точная пользовательская семантика Pass/endgame и визуальный UX определены в `GAME_CUBE_GO.md`; technical owner transitions — session/domain state, а не Renderer.

## 18.4. Undo / Redo

`UI → GameSession → History`

`GameSession` получает точный restored snapshot, восстанавливает связанные session-level metadata, сохраняет новый session envelope и обновляет PresentationModel.

Renderer не реконструирует историю самостоятельно.

## 18.5. Смена Renderer/View mode

Смена 2D/3D presentation меняет `ViewState`/renderer selection и orientation anchor, но не `GameState`.

`GameEngine`, scoring и history не должны замечать факт смены Renderer.

# 19. Testing architecture

Автоматические проверки делятся по владельцам ответственности.

## 19.1. GameEngine tests

Покрывают:

- groups/liberties;
- captures;
- suicide;
- turn switching;
- Pass;
- action numbering;
- `GamePhase` transitions;
- integration с `RepetitionPolicy` через переданный context;
- детерминизм domain results;
- отсутствие зависимости от UI/browser/Renderer.

Полную партию должно быть возможно прогнать headless командами напрямую.

## 19.2. Topology tests

Общий Topology Contract проверяет:

- четыре различных соседа;
- отсутствие self-links;
- symmetry;
- graph connectivity;
- stable `PointId`;
- topology-specific wrap/edge/corner consistency.

`CubeTopology` тестируется на нескольких `N`, включая чётные и нечётные размеры и хотя бы один технический размер, отсутствующий в текущем UI-наборе. Цель — обнаруживать hardcode под конкретные UI sizes.

## 19.3. Cube spatial/layout tests

Headless tests обязаны проверять без SVG/DOM/Three.js:

- `PointId ↔ FaceId/local position`;
- стабильность spatial mapping;
- ориентации граней;
- переходы через стороны/углы;
- round-trip conversions;
- отсутствие logical duplicates;
- уникальность stable face/point mapping;
- `CubeOrientation` transitions;
- `Cube2DLayout` contract относительно product-defined layout rules;
- presentation-only layout state не меняет `GameState`/`CubeTopology`.

Перед подключением 3D должна существовать diagnostic/headless функция, способная для любой cube `PointId` получить её каноническую surface/orientation информацию без Renderer2D.

## 19.4. History tests

Покрывают:

- Undo/Redo stone;
- Undo/Redo Pass;
- `canUndo/canRedo`;
- восстановление currentPlayer/captures/repetition/pass/action/GamePhase data;
- clearing redo после нового действия;
- serialization/restoration past/current/redo;
- restoration endgame/result metadata.

## 19.5. Persistence tests

Обязательны:

- serialize → save → load → semantic equality;
- corrupted/old data handling;
- schema migration tests при изменении формата;
- regression `Undo → save → load → Redo`.

Storage adapter должен заменяться без изменения `GameSession` API.

## 19.6. Scoring/endgame tests

Покрывают:

- Chinese/Japanese scoring на одинаковых classified positions;
- komi;
- alive/dead/seki;
- neutral regions;
- separation classifier/scorer;
- работу classifier через абстрактный `Topology` без renderer assumptions.

## 19.7. Renderer contract tests

Проверяют:

- hit-testing возвращает `PointId`;
- Renderer не создаёт собственную игровую истину;
- Cube stable representation не создаёт duplicate interactive logical points;
- temporary animation-only elements не участвуют в hit-testing;
- Torus passive copies ссылаются на source `PointId` и остаются non-interactive;
- shared BoardTheme/assets действительно переиспользуются, а не дублируются независимыми реализациями.

## 19.8. Property-based / fuzz testing

Генерируемые последовательности допустимых действий проверяют как минимум:

- одинаковый state + command → одинаковый result;
- Undo/Redo exact restoration;
- новое действие после Undo очищает redo-future;
- serialize/deserialize сохраняет семантическую эквивалентность session state;
- `Undo → save → load → Redo` сохраняет следующий state/result;
- допустимый завершённый ход не оставляет собственную группу без liberties;
- повторное проигрывание одной command sequence приводит к тому же final state;
- topology contract не нарушается.

Seed любого найденного дефекта сохраняется; после минимизации случай превращается в постоянный regression fixture.

## 19.9. Fixture format

Внутренний fixture-формат является test infrastructure, а не пользовательским export/import.

Fixture может содержать:

- schema version;
- topology type/size;
- stones;
- current player;
- repetition/ko context;
- pass state;
- capture counters;
- scoring mode;
- komi;
- expected groups/liberties/legal moves/captures;
- expected endgame/scoring data при необходимости.

Один формат используется для Torus и Cube; topology-specific fixtures расширяют библиотеку, а не создают параллельные несовместимые test systems.

## 19.10. Developer/debug renderer

В development build существует диагностический renderer/mode, способный показывать internal mappings без создания отдельной игровой логики.

Он может отображать:

- `PointId`;
- logical neighbors;
- group id/composition;
- liberties;
- connected empty regions;
- territory/debug classification;
- Cube face/layout/orientation mapping;
- Torus passive-copy → source `PointId` mapping.

Debug renderer не является пользовательской функцией и не определяет correctness.

# 20. Library / Reuse Policy

Library/Reuse Review является техническим gate. `ROADMAP.md` определяет, **когда** он проводится; этот раздел определяет **как** оценивать reuse.

## 20.1. Общий принцип

Перед заметным объёмом собственного низкоуровневого кода нужно проверить зрелые библиотеки, primitives, reference implementations и test oracles.

Обязателен обзор решений, а не обязательное подключение зависимости.

Допустимые outcomes:

- **use** — использовать библиотеку напрямую;
- **adapt** — адаптировать отдельный код/algorithm с соблюдением лицензии;
- **oracle/reference** — использовать только для сравнения/идей;
- **reject** — осознанно написать собственную реализацию.

Собственный код предпочтителен, если он существенно меньше, безопаснее, прозрачнее тестируется или сторонняя зависимость нарушает topology-independent boundaries либо приносит больше сложности, чем снимает.

## 20.2. Критерии оценки зависимости

Для серьёзного кандидата проверяются:

- лицензия, notices и attribution;
- активность и поддержка;
- качество tests/docs;
- TypeScript/browser/Node compatibility;
- bundle/runtime cost;
- API stability;
- security/supply-chain risk;
- vendor lock-in;
- возможность обернуть нашим interface/adapter;
- стоимость адаптации к Torus/Cube topology;
- скрытые assumptions о rectangular board/edges/Renderer;
- стоимость удаления/замены зависимости.

При копировании или адаптации стороннего исходного кода обязательны требования его лицензии и атрибуции.

## 20.3. Go rules / engine candidates

Для стандартной логики Go и test oracle следует рассматривать актуальные аналоги и, как исходные кандидаты:

- `@sabaki/go-board`;
- `online-go/goban` / `goban-engine`;
- `@sabaki/sgf` для внутренних инструментов/reference use.

Главная проверка: можно ли отделить Go-алгоритмы от rectangular-board assumptions и направить соседство через `Topology.neighbors(PointId)`.

Если нет, библиотека остаётся oracle/reference и не должна протаскивать rectangular coordinates внутрь domain core.

## 20.4. Endgame candidates

Для automatic/assisted alive-dead-seki следует исследовать актуальные реализации, включая:

- `@sabaki/deadstones`;
- `online-go/score-estimator`;
- другие актуальные alternatives.

Прямоугольный алгоритм не считается автоматически пригодным для Torus/Cube. Reuse допустим только после доказательства topology-independence или через адаптацию к логическому графу.

## 20.5. Testing / schema candidates

Базовые кандидаты:

- Vitest — unit/integration runner;
- Playwright — E2E/visual regression;
- fast-check — property-based/fuzz;
- Zod или актуальный аналог — runtime schema validation/migrations.

Собственные fixtures и Topology Contract остаются проектными контрактами независимо от выбранных инструментов.

## 20.6. Web/UI/2D candidates

Базовые направления:

- React;
- Vite;
- SVG;
- Motion;
- Shudan как reference;
- Konva/react-konva;
- PixiJS;
- актуальные альтернативы.

Дополнительный canvas/framework подключается только если реально уменьшает сложность mapping, hit-testing, interactions и animation. Visual scene не становится источником `PointId` или game rules.

## 20.7. Cube 3D candidates

Перед написанием собственного 3D infrastructure следует проверять:

- Three.js;
- `@react-three/fiber`;
- Drei и актуальные аналоги;
- `RoundedBoxGeometry` или эквивалентные готовые geometry primitives;
- OrbitControls/аналог для camera controls;
- Raycaster/аналог для picking;
- InstancedMesh/аналог для repeated stones;
- LineSegments/line primitives для grid;
- готовые animation/control helpers.

Собственный WebGL renderer, picking engine или базовый cube mesh generator не создаётся, пока не доказано, что зрелые primitives не подходят.

Независимо от библиотеки нашими остаются:

- `PointId → surface position` mapping;
- cube face/orientation semantics;
- перевод picking в `PointId`;
- continuity/meaning grid across face transitions;
- 2D↔3D orientation anchor;
- отсутствие влияния Renderer3D на `GameState`.

Замена 3D-библиотеки должна требовать переписать Renderer3D/adapters и visual details, но не `CubeTopology`, `GameState`, rules, scoring, history или public domain commands.

## 20.8. Future 3D Torus candidates

Product-defined 3D Torus имеет нестандартную форму, поэтому стандартный круглый `TorusGeometry` не считается автоматически подходящей моделью.

Для geometry spike сначала следует проверить стандартные composable primitives, например:

- Three.js `Shape` с inner hole + `ExtrudeGeometry` + bevel;
- mature CSG solutions как fallback после проверки стабильности/лицензии.

Camera, controls, picking, instancing, line rendering и animation по возможности повторно используют зрелые 3D primitives.

Уникальными остаются Torus topology → surface mapping, continuity двух торических направлений grid и spatial anchor между 2D/3D представлениями.

## 20.9. Future online candidates

Перед network implementation повторно исследуются актуальные authoritative multiplayer frameworks. Исходные кандидаты:

- boardgame.io;
- Colyseus;
- актуальные alternatives.

Готовые rooms/lobby/reconnect/state sync полезны только если framework остаётся внешним слоем вокруг authoritative GameEngine. Решение, требующее перенести правила в несовместимую framework-specific state model или сделать клиента authoritative, отклоняется.

## 20.10. Differential/test-oracle principle

На позициях, где модель проекта совпадает со стандартным плоским Go, зрелые внешние движки можно использовать для differential/regression сравнения стандартной логики.

Совпадение с внешним движком не доказывает корректность TorusTopology/CubeTopology; необычные topology доказываются собственными contracts, fixtures и property/fuzz tests.

## 20.11. Фиксация reuse decision

Результат review фиксируется кратко в рабочем контексте задачи/PR как implementation rationale, а не вводится как новый проектный документ. Создавать новый `.md` ради Library/Reuse Review нельзя без отдельного разрешения пользователя.

# 21. Архитектурные анти-паттерны

Запрещено:

- Cube-specific branches в базовом `GameEngine`;
- отдельный `GameEngine` для Torus и Cube;
- хранить visual duplicates как игровые stones/points;
- использовать screen coordinates как logical identity;
- выводить `PointId` из DOM/SVG/CSS/canvas/Three.js ids;
- размазывать Chinese/Japanese scoring по базовой механике;
- автоматически определять alive/dead внутри `ScoringStrategy`;
- читать browser storage из `GameEngine`;
- давать `GameEngine` объект `History` вместо минимального repetition data;
- вкладывать `History`/redo-future внутрь `GameState`;
- моделировать `GamePhase` набором конфликтующих boolean-флагов;
- терять redo-future при autosave/reload;
- хранить ViewState в rule history как игровое действие;
- вызывать Three.js из `Topology`;
- делать Renderer владельцем captures/currentPlayer/history;
- делать animation callback источником фактического хода;
- размазывать network checks по UI и domain core;
- создавать отдельный GameState для 2D и 3D;
- извлекать canonical cube geometry из CSS/SVG/Three.js scene;
- поддерживать две конкурирующие persistence abstractions с пересекающейся ответственностью;
- дублировать shared panel или BoardTheme отдельными mode-specific реализациями.

# 22. Правила принятия архитектурных решений

Перед добавлением новой функции определить:

1. Это domain logic, orchestration, presentation, renderer, persistence или infrastructure?
2. Какой модуль является единственным владельцем ответственности?
3. Нужна ли сменная реализация или достаточно локального изменения?
4. Существует ли подходящий interface/adapter?
5. Не создаёт ли изменение обратную зависимость от infrastructure к domain core?
6. Можно ли протестировать новую логику headless без browser/Renderer?
7. Можно ли заменить TorusTopology на CubeTopology без переписывания этой логики?
8. Можно ли заменить storage adapter без изменения `GameSession` API?
9. Можно ли заменить Renderer2D/Renderer3D без изменения `GameState` и rules?
10. Можно ли в будущем заменить local execution на `RemoteGameAuthority` без изменения UI?
11. Сохраняется ли один authoritative current `GameState` при отдельной History/session envelope?
12. Не дублируется ли нормативное правило между архитектурой, roadmap и product requirements?

Если ответ показывает нарушение границы, сначала исправляется architecture/adapter contract, затем реализуется функция.

# 23. Минимальная ментальная модель

Для разработки систему следует держать в голове как цепочку:

- пользователь создаёт intent в UI;
- `GameSession` координирует сессию;
- `GameAuthority` определяет место исполнения команды;
- `GameEngine` применяет правила к current `GameState`;
- `Topology` сообщает logical neighbors;
- `RepetitionPolicy` проверяет повторение по переданному context;
- `History` владеет past/current/redo snapshots;
- `EndgameClassifier` классифицирует группы;
- `ScoringStrategy` создаёт `FinalScore`;
- `GameStorage` сохраняет session envelope;
- `PresentationModel` строит данные для показа;
- Renderer отображает их и переводит pointer обратно в `PointId`;
- Animation визуализирует события, не меняя правила;
- `NetworkTransport` в будущем только переносит commands/state через внешний authority boundary.

Главный критерий качества архитектуры: новая topology, новый Renderer, новый storage backend или будущий network adapter должны добавляться на своей границе и не требовать переписывать уже проверенное независимое domain core без реальной необходимости.
