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
2. UI не вызывает `GameEngine` напрямую; доменные игровые команды проходят через `GameSession`.
3. `GameSession` является application-level координатором одной партии.
4. `GameEngine` отвечает только за доменную механику и доменные переходы `GameState`; он не координирует UI, persistence, history или rendering.
5. `GameEngine` не знает, используется Torus или Cube; он работает через интерфейс `Topology`.
6. `GameEngine` не знает о DOM, React, SVG, Canvas, CSS transforms, Three.js, камере, zoom/pan, layout и visual duplicates.
7. `Topology` описывает логическую связность игровых точек и не содержит renderer-specific координаты.
8. `Renderer` не решает правила игры, не создаёт авторитетное игровое состояние и не изменяет `GameState`.
9. `GameState` представляет один текущий rule-relevant snapshot; `History` является отдельным владельцем past/current/redo timeline.
10. `History` никогда не является полем `GameState`, а `GameEngine` никогда не владеет объектом `History`.
11. Единственное правило repetition — `SimpleKoPolicy`; `GameEngine` получает только минимальный `SimpleKoContext`, подготовленный application/session layer.
12. `ViewState` отделён от `GameState`; изменение камеры, zoom, pan, layout или orientation не является игровым действием.
13. `ScoringStrategy` не определяет жизнь/смерть групп; он получает только полностью resolved `EndgameClassification`.
14. `EndgameClassifier` не содержит формулы Chinese/Japanese scoring и не подменяет ручные решения недоказанными догадками.
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
25. `GameEngine` является единственным владельцем **forward mutations** полей `GameState`, включая `GamePhase`; `GameSession` может инициировать доменную операцию, но не присваивает `GamePhase` напрямую.
26. Частичный ручной/assisted endgame review хранится как отдельный session-level `EndgameReviewState`; он не маскируется под уже завершённую `EndgameClassification`.
27. Межпартийные пользовательские preferences отделены от сохранения текущей партии и от `ViewState` конкретной сессии.
28. Autosave имеет монотонную revision и упорядоченную запись: более старый async save не может перезаписать более новое состояние.
29. Обычный production gameplay, production-classifier и final scoring не зависят от внешнего oracle, сети или developer-only AI services; Development Workspace может использовать внешние AI/oracle services для diagnostics, но они не становятся correctness dependency обычной игры.
30. Внешний oracle никогда не превращает вероятностную или эвристическую оценку в authoritative automatic status без внутренней project-defined proof/verification boundary.
31. Test-position generators существуют только как test infrastructure: legal sequences строятся через `GameEngine`/эквивалентную domain boundary, synthetic pattern fixtures изолированы от runtime, а пользовательского Test Case/Test ID API для этой test infrastructure нет. Отдельный постоянный Development Workspace не публикует эти generators и работает через собственные application/infrastructure contracts.
32. `Development Workspace` является разрешённой постоянной application/developer capability и остаётся внешним по отношению к доменному ядру.
33. AlphaZero не является authoritative владельцем `GameState`: он предоставляет игровые действия и diagnostic data, а каждый replayed action повторно принимается или отклоняется настоящим `GameSession → GameEngine`.
34. Developer replay использует отдельную ephemeral `GameSession`/controller без обычного autosave; он не записывает и не перезаписывает сохранённую пользовательскую партию `current`.
35. AlphaZero transport data является недоверенным внешним input и проходит runtime validation до создания developer session или применения move.
36. Presentation layer имеет явный animation mode `normal | disabled`; режим анимации не читается `GameEngine`/`GameState` и не меняет domain result.

Стрелка `A → B` в этом документе означает: `A` использует контракт `B` или передаёт ему данные/команду. Она не означает наследование.

# 2. Верхнеуровневая карта модулей

Базовый локальный путь доменной игровой команды:

`UI/Input → GameSession → LocalGameAuthority/GameEngine → GameState + DomainEvents → GameSession`

Перед Simple Ko check:

`GameSession → History → SimpleKoContext → GameEngine/SimpleKoPolicy`

После принятого игрового изменения:

`GameSession → History`

`GameSession → ordered autosave → GameStorage`

`GameSession → PresentationModel → active Renderer`

Для endgame:

`GameSession → EndgameClassifier → EndgameReviewState → EndgameClassification → ScoringStrategy → FinalScore`

Постоянный Development Workspace использует отдельный внешний путь:

`Development UI → AlphaZeroGateway → localhost AlphaZero service`

Полученный AlphaZero move возвращается в обычный authoritative gameplay path:

`AlphaZero generated move → DeveloperReplaySession → GameSession → GameEngine → GameState → Presentation/Renderer`

Отдельный test-only verification path не входит в runtime/application graph:

`Deterministic fixture → classifier → DifferentialOracleAdapter/reference result → test assertion/diagnostic`

После получения полного результата `GameSession` запрашивает у доменной границы переход текущего `GameState` из `ENDGAME_REVIEW` в `FINISHED`; он не меняет phase напрямую.

Доменный `GameEngine` внутри обработки команды использует:

`GameEngine → Topology`

`GameEngine → SimpleKoPolicy`

Межпартийные preferences проходят по отдельной границе:

`New Game / presentation preferences UI → PreferencesStorage`

Будущий удалённый путь заменяет только execution boundary:

`UI → GameSession → RemoteGameAuthority → NetworkTransport → server-side GameSession/GameEngine → authoritative result → GameSession`

# 3. UI / Input и единая панель управления

UI отвечает за визуальные controls, pointer/input и формирование пользовательских намерений.

Интенции разделяются по ответственности; один общий тип «command на всё» не используется.

## 3.1. Domain GameCommand

`GameCommand` меняет rule-relevant `GameState` только через `GameSession → GameAuthority → GameEngine`.

Пользовательские domain commands включают:

- `PlaceStone(pointId)`;
- `Pass`.

Application/session layer также может сформировать внутреннюю доменную команду вроде `CompleteEndgame`, когда обязательный review полностью разрешён и `FinalScore` уже рассчитан. Такая команда не является самостоятельным UI-control и нужна только для доменного перехода `ENDGAME_REVIEW → FINISHED`.

## 3.2. SessionCommand

Session commands координируют уже существующую партию и не передаются в `GameEngine` как обычный ход:

- `Undo`;
- `Redo`;
- изменение статуса группы в текущем `EndgameReviewState`;
- orchestration завершения endgame review после заполнения всех обязательных статусов.

`NewGame(settings)` создаёт новую session boundary и относится к application lifecycle, а не к командам существующего `GameState`.

## 3.3. ViewIntent

Чисто визуальные действия меняют `ViewState`/presentation layer и не входят в rule history:

- `ChangeViewMode(mode)`;
- `NavigateView(direction)`;
- zoom/pan/rotation;
- display options;
- `MoveCubeVerticalPair(column)` или эквивалентный intent для клика по пустому Cube 2D layout slot.

Не каждый кликабельный элемент Renderer обязан соответствовать `PointId`. Игровая точка возвращает `PointId`; presentation-only slot/control создаёт `ViewIntent` и никогда не превращается в фиктивную logical point.

## 3.4. New Game draft

Изменение topology, size, rules/scoring mode и komi до запуска партии является редактированием `NewGameDraft`/settings form state.

`ChangeKomi` и `ChangeRules` не являются командами активной партии. После `NewGame(settings)` эти параметры становятся immutable session configuration для созданной партии, если продуктовый документ не введёт отдельное поведение изменения во время игры.

UI получает `logical PointId` от game-point hit-testing активного Renderer и передаёт `PlaceStone(pointId)` в `GameSession`.

UI не знает алгоритмы групп, liberties, captures, suicide, Simple Ko, endgame classification или scoring.

## 3.5. GameControlPanel

Основная служебная панель реализуется одним физически общим компонентом `GameControlPanel` или эквивалентом с тем же архитектурным смыслом.

Запрещено создавать независимые `TorusPanel`, `CubePanel`, `Cube2DPanel`, `Cube3DPanel` или копировать JSX/HTML/CSS основной панели внутрь Renderer.

Renderer отвечает за игровое поле и renderer-specific interaction. Панель находится над различиями Renderer и получает общие данные/commands через единый application/presentation API.

Если control неприменим к конкретному режиму, общий компонент может использовать capabilities текущего режима и выбрать предусмотренное product requirements состояние: скрыть control или показать disabled-state. Это не является основанием создавать другую панель.

Изменение структуры или реализации общего control выполняется централизованно и автоматически применяется ко всем режимам, использующим этот control. Точное визуальное оформление и пользовательское поведение панели определяет `docs/GAME_CUBE_GO.md`.

Если новая функция создаёт конфликт, при котором единая панель не может корректно вместить обязательные controls или требования режимов несовместимы, нельзя молча создавать исключение, вторую панель, отдельную раскладку одного режима, переносить обязательную функцию наружу либо менять архитектуру панели без решения пользователя.

**!!! ВНИМАНИЕ: ПРОБЛЕМА С ЕДИНОЙ ПАНЕЛЬЮ УПРАВЛЕНИЯ !!!**

В такой ситуации агент обязан до реализации явно сообщить пользователю о конкретном конфликте и запросить решение. До решения пользователя архитектура панели не меняется и обходной вариант не внедряется.

# 4. GameSession

`GameSession` — application-level координатор одной партии и основная точка входа для игровых/session commands от UI.

`GameSession` отвечает за orchestration:

- маршрутизировать `GameCommand`, `SessionCommand` и presentation requests к правильному владельцу, не смешивая их;
- получить current `GameState`;
- запросить у `History` минимальный `SimpleKoContext`, когда он нужен;
- передать доменную команду в `GameAuthority` или локальный `GameEngine`;
- получить новый `GameState` и `DomainEvents`;
- обновить `History` после принятого игрового действия;
- инициировать autosave через единый ordered-save coordinator;
- создать/восстановить `EndgameReviewState`, когда доменный `GameState` входит в `ENDGAME_REVIEW`;
- применить ручные решения endgame review к session-level review state и сохранять их;
- передать только полностью resolved `EndgameClassification` в выбранную `ScoringStrategy`;
- после получения `FinalScore` запросить у доменной границы `CompleteEndgame`, чтобы `GameEngine` вернул `GameState` с phase `FINISHED`;
- хранить/восстанавливать session-level metadata, не принадлежащие одному `GameState` snapshot;
- передать актуальное состояние в `PresentationModel`;
- координировать Undo/Redo;
- координировать смену view mode без изменения `GameState`;
- координировать временную блокировку игрового input во время presentation transitions, когда этого требует продуктовый UX.

`GameSession` **не присваивает и не патчит поля `GameState` напрямую**, включая `GamePhase`.

`GameSession` не отвечает за:

- поиск групп и liberties;
- captures и suicide;
- алгоритм Simple Ko;
- геометрию Torus/Cube;
- drawing/hit-testing;
- физический storage backend;
- хранение межпартийных preferences как части session snapshot.

# 5. GameAuthority — execution seam

`GameAuthority` — заменяемая граница между `GameSession` и местом исполнения доменной команды.

Рекомендуемый смысл контракта:

`execute(gameCommand, currentContext) → authoritative result/state/events`

Реализации:

- `LocalGameAuthority` вызывает локальный `GameEngine`;
- `RemoteGameAuthority` в будущем использует `NetworkTransport` и принимает подтверждённый сервером результат.

`Undo`, `Redo`, view navigation, empty-slot layout interaction, New Game draft edits и persistence commands не отправляются в `GameAuthority` как игровые ходы.

Отдельный класс `GameAuthority` не обязан существовать, если текущей реализации достаточно узкой функции/adapter boundary. Важно сохранить заменяемую границу, чтобы удалённое исполнение не потребовало переписывать UI или domain core.

UI не должен знать, local или remote execution используется партией.

# 6. GameEngine

`GameEngine` — чистое доменное ядро механики Go и единственный владелец forward mutations `GameState`.

Предпочтительная модель обычного игрового действия:

`gameCommand + state + topology + SimpleKoContext → new state + domain events`

Пример контракта:

`applyCommand(state, gameCommand, topology, simpleKoContext) → EngineResult`

`SimpleKoPolicy` является единственным repetition rule и используется внутри доменной границы; runtime-параметра для выбора другой repetition policy нет.

`EngineResult` содержит новый `GameState` либо структурированную причину недопустимости и набор `DomainEvents`.

`GameEngine` реализует доменные операции, включая:

- постановку камня;
- формирование/объединение групп;
- liberties;
- captures;
- suicide validation;
- Simple Ko validation;
- turn switching;
- Pass как игровое действие;
- consecutive pass state;
- capture counters;
- action/move number;
- переход `PLAYING → ENDGAME_REVIEW` при выполнении доменного условия завершения основной фазы;
- внутреннюю доменную операцию `CompleteEndgame`, валидную только из `ENDGAME_REVIEW`, которая переводит `GameState` в `FINISHED` после того, как session layer уже получил полный classification/result.

`GameEngine` использует только доменные зависимости, прежде всего `Topology` и единственный `SimpleKoPolicy`.

`GameEngine` не использует и не владеет:

- `History`;
- `Renderer`;
- `PresentationModel`;
- `GameStorage`;
- `PreferencesStorage`;
- browser storage APIs;
- React/DOM/SVG/Canvas/Three.js;
- `EndgameClassifier`;
- `ScoringStrategy`;
- `NetworkTransport`;
- `AlphaZeroGateway`, HTTP, Python, PyTorch или AlphaZero service.

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
- rule/Simple-Ko-relevant данные текущего snapshot, которые не выводятся из переданного `SimpleKoContext`;
- другие динамические поля, непосредственно влияющие на применение правил из этого snapshot.

Внутри `GameState` запрещены:

- `History` или redo-future;
- partial endgame UI decisions, если они принадлежат `EndgameReviewState`;
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
- Принятый доменный `Pass`, который выполняет условие окончания основной фазы, переводит `GameState` в `ENDGAME_REVIEW` внутри `GameEngine`.
- В `ENDGAME_REVIEW` `GameSession` координирует review, но **не меняет `GamePhase` напрямую**.
- Когда обязательный review полностью resolved и `FinalScore` рассчитан, `GameSession` отправляет внутреннюю доменную операцию `CompleteEndgame`; `GameEngine` валидирует текущую фазу и возвращает `GameState` с `FINISHED`.
- Undo/Redo не создают новый forward transition: `History` восстанавливает ранее существовавший snapshot с его прежним/следующим `GamePhase` вместе с session-level endgame/result metadata.
- Нельзя использовать несколько независимых boolean-флагов как параллельные источники истины о стадии партии.
- Если в будущем понадобится новая стадия, расширяется одна state machine, а не добавляется несогласованный флаг.

Точное пользовательское действие, запускающее переходы, и UX каждой стадии определяет `docs/GAME_CUBE_GO.md`.

## 7.3. GameSessionSnapshot

Статическая конфигурация партии и данные, принадлежащие всей сессии, сериализуются в `GameSessionSnapshot` или эквивалентном session envelope.

Он включает или однозначно позволяет восстановить:

- topology identity и size;
- rules/scoring mode;
- нормализованный komi текущей партии;
- сериализованную `History` timeline;
- redo-future;
- current `GameState`;
- текущий `EndgameReviewState`, если партия находится в review;
- `EndgameClassification`/`FinalScore` metadata, если они нужны для точного current/redo restoration;
- монотонный `sessionRevision`;
- schema/version metadata;
- `PlayerSlot` или эквивалентные session-level player identifiers, если они используются.

`PlayerSlot` может иметь внутренний id и цвет без требования аккаунта. Будущая привязка аккаунта относится к session/infrastructure layer и не должна менять правила Go.

Cross-game preferences не входят в `GameSessionSnapshot`.

## 7.4. ViewState

`ViewState` содержит только presentation state, например:

- zoom;
- pan;
- camera orientation;
- active view mode;
- Cube orientation anchor;
- Cube 2D presentation layout state, включая выбранное положение vertical pair;
- Torus visual offset;
- session-local display state;
- transition/interaction state, если он нужен Renderer;
- presentation animation mode `normal | disabled`.

`ViewState` не читается `GameEngine`, `ScoringStrategy`, `EndgameClassifier` или Simple Ko logic и не является частью игровой history timeline.

Сохранение конкретного `ViewState` допускается отдельно, если этого требует продукт, но отсутствие или сброс `ViewState` не должен менять восстановленную игровую сессию.

## 7.5. EndgameReviewState

`EndgameReviewState` — session-level state незавершённого финального разбора.

Он хранит как минимум:

- идентификаторы логических групп финальной позиции или стабильный способ их восстановить;
- исходное предложение classifier для каждой группы: resolved status либо `unresolved`;
- текущие пользовательские решения/overrides `alive | dead | seki`;
- достаточные данные для определения, завершена ли обязательная классификация.

Архитектурные правила:

- partial review **не** называется `EndgameClassification`, пока остаётся хотя бы одна обязательная unresolved group;
- ручное изменение статуса обновляет `EndgameReviewState` и инициирует autosave, но не является постановкой stone/Pass и не добавляет отдельный gameplay snapshot в `LinearHistory`;
- review state привязан к тому history position, которое возникло после завершающего Pass;
- Undo этого Pass отбрасывает связанный review/result state;
- Redo должен иметь возможность детерминированно восстановить соответствующий review/result state, если redo-future не был очищен;
- Renderer/UI не является авторитетным владельцем решений review.

## 7.6. UserPreferences

`UserPreferences` — отдельные межпартийные данные, которые продукт явно решил запоминать между партиями.

- Они не являются `GameState`, `History`, `GameSessionSnapshot` или текущим `ViewState`.
- Набор реально сохраняемых preferences определяется только `GAME_CUBE_GO.md`; архитектура не вводит новую preference автоматически только потому, что значение технически можно сохранить.
- Удаление/замена текущего game save не должно автоматически удалять preferences.
- Preferences могут влиять на initial New Game draft или начальное presentation state, но после создания партии rule-relevant settings партии принадлежат её session configuration.

## 7.7. Schema evolution

Форматы `GameState`, `GameSessionSnapshot`, `EndgameReviewState` и preferences persistence имеют явную schema/version boundary там, где это необходимо. Фундаментальное изменение смысла сохранённых данных требует миграции/совместимости либо осознанного изменения schema version; нельзя молча переинтерпретировать старые сохранения.

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

Группы, liberties, captures, Simple Ko и scoring не получают отдельные «cube versions»: они используют общий `Topology` contract.

Важно для standard-Go oracle reuse: одинаковая degree=4 у каждой точки не означает глобальную эквивалентность квадратной сетке. В частности, возле физических углов Cube локальный logical graph содержит трёхциклы между corner-adjacent points разных faces, которых нет в обычной bipartite square grid. Поэтому planar oracle применяется к Cube только после явной проверки локальной planar-grid embedding, а не по факту «четырёх соседей».

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

Канонические пользовательские правила расположения slots, пустых областей и взаимодействия определяет `docs/GAME_CUBE_GO.md`; архитектура фиксирует следующие границы:

- каждая физическая `CubeFace` имеет не более одного стабильного игрового layout representation;
- каждая logical `PointId` имеет одно стабильное interactive representation в Cube 2D;
- `Cube2DLayout` не создаёт логические duplicates;
- поле `isDuplicate` не является частью канонической cell-модели;
- renderer-only temporary animation element не становится `Cube2DLayoutCell`, `PointId` или stone hit target;
- presentation-only параметры layout хранятся в `ViewState`, а не в `GameState` или `CubeTopology`;
- Cube 2D обязательно имеет presentation state выбранной колонки вертикальной TOP/BOTTOM pair; конкретное имя поля (`verticalAnchorColumn`, `verticalPairColumn` или эквивалент) является implementation detail;
- пустые верхние/нижние slots, разрешённые продуктом для переноса vertical pair, являются presentation interaction targets и **не являются `PointId`**;
- click такого slot создаёт `MoveCubeVerticalPair(column)`/эквивалентный `ViewIntent`, который меняет только Cube 2D layout/ViewState;
- выбранная колонка pair сохраняется при horizontal Cube navigation так, как требует продуктовая модель; face/orientation contents пересчитываются из `CubeOrientation`, а не из DOM.

Удаление поля/контрола, реализующего эту capability, допустимо только если продуктовый документ отменит саму возможность переноса vertical pair. Архитектурная «чистка» не может удалять пользовательский empty-slot interaction как якобы неигровой или лишний anchor state.

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

# 10. SimpleKoPolicy

`SimpleKoPolicy` — единственное repetition rule во всём проекте для всех topology, размеров и scoring modes.

Контракт:

`isAllowed(simpleKoContext, candidateState) → result`

`SimpleKoContext` содержит только минимальные данные, необходимые для immediate-ko comparison: board position, существовавшую непосредственно перед предыдущим accepted game action, либо её детерминированный hash/эквивалент.

`SimpleKoPolicy` запрещает candidate position только когда она немедленно восстанавливает эту позицию согласно product rule.

Архитектурные правила:

- других repetition policy implementations нет;
- runtime/config switch для выбора repetition policy отсутствует;
- positional/situational superko не являются скрытым fallback или future-ready branch;
- `GameSession` получает минимальный Simple Ko context из `History` и передаёт его в доменный вызов;
- ни `SimpleKoPolicy`, ни `GameEngine` не получают объект `History` во владение.

Если когда-либо потребуется другое правило повторения, это будет отдельное изменение текущих product/architecture requirements, а не заранее оставленный второй implementation path.

# 11. History

Каноническая текущая реализация — линейный `LinearHistory`.

Базовый контракт:

- `push(state/action)`;
- `undo()`;
- `redo()`;
- `canUndo()`;
- `canRedo()`;
- `current()`;
- получить минимальный `SimpleKoContext` для следующего domain action;
- serialize/restore past/current/redo timeline.

`History` владеет последовательностью `GameState` snapshots и redo-future. `GameSession` координирует его использование и persistence.

После Undo новое принятое игровое действие очищает redo-future.

Persistence должен сохранять redo-future. После `Undo → save/load` следующий Redo должен оставаться доступным и детерминированно восстанавливать тот же snapshot.

Если current/redo state связан с `EndgameReviewState`, `EndgameClassification` или `FinalScore`, соответствующая session-level metadata сохраняется вместе с timeline/session envelope так, чтобы exact restoration не зависел от Renderer.

# 12. EndgameClassifier, EndgameReviewState и ScoringStrategy

## 12.1. EndgameClassifier

Контракт classifier не обязан выдавать уже окончательное решение по каждой группе:

`analyze(finalPosition/context) → EndgameProposal`

`EndgameProposal` содержит логические группы финальной позиции и для каждой группы либо доказанный статус:

- `alive`;
- `dead`;
- `seki`;

либо `unresolved`.

Для диагностируемости proposal может дополнительно хранить renderer-independent metadata о происхождении/основании результата, например `source`, algorithm id/version и evidence/reason code. Такая metadata не меняет семантику `alive/dead/seki/unresolved` и не является отдельным scoring input.

Реализации:

- `ManualEndgameClassifier`/эквивалентная manual implementation перечисляет группы и оставляет требующие решения статусы unresolved;
- `AssistedEndgameClassifier` может заранее resolve только доказуемые статусы и оставляет остальные unresolved.

Точная доступность assisted реализации по версиям определяется `docs/ROADMAP.md`; пользовательская семантика ручного/assisted flow — `docs/GAME_CUBE_GO.md`.

`EndgameClassifier` не считает окончательные очки и не заменяет unresolved статус догадкой.

## 12.2. Review resolution

`GameSession` создаёт `EndgameReviewState` из `EndgameProposal` и применяет к нему пользовательские решения.

Пример узких application helpers:

- `setGroupStatus(reviewState, groupId, status) → EndgameReviewState`;
- `resolveClassification(reviewState) → EndgameClassification | incomplete`.

`EndgameClassification` существует только как **полный** resolved набор статусов всех обязательных групп. Пока хотя бы одна обязательная группа unresolved, `ScoringStrategy` не вызывается.

Ручное решение является authoritative override/fallback в пределах правил, определённых продуктовым документом.

Порядок, в котором presentation предлагает unresolved groups пользователю, не является частью classifier algorithm. Он принадлежит application/presentation layer и может меняться без изменения `AssistedEndgameClassifier`, `EndgameProposal` или scoring.

## 12.3. ScoringStrategy

Контракт:

`calculate(position, endgameClassification, komi) → FinalScore`

Реализации:

- `ChineseScoring`;
- `JapaneseScoring`.

Scoring получает уже полностью разрешённую `EndgameClassification` и концентрирует формулу соответствующего scoring mode внутри strategy/rule modules, а не размазывает `if japanese/chinese` по `GameEngine`.

`FinalScore` является доменным результатом scoring, а не объектом Renderer/PresentationModel.

## 12.4. Assisted classifier pipeline и proof boundary

0.3 не заменяет существующий topology-neutral scorer сторонним rectangular scorer. Основная сложность 0.3 принадлежит классификации групп; после полного review используются существующие project `ScoringStrategy` implementations.

Рекомендуемый внутренний pipeline assisted classifier:

`final position → group/region analysis → proven structural results → optional candidates → strict verifier → EndgameProposal`

Правила pipeline:

- deterministic structural proof имеет приоритет над эвристикой/внешним oracle;
- pass-alive/Benson-like analysis используется как основной фундамент автоматического `alive` там, где доказательство выполнено на project `Topology`;
- dead/seki heuristic, rollout, Monte-Carlo, score-estimator или neural result является **candidate**, пока project-defined verifier не подтвердит статус;
- candidate, не прошедший verification, становится `unresolved`;
- probabilistic confidence (`99%`, ownership и т. п.) само по себе не является proof;
- classifier обязан работать через `Topology` и logical groups/regions, а не через Renderer coordinates;
- Torus/Cube-specific знания допускаются только в topology/adapter/proof helper, а не отдельными scoring engines;
- false automatic resolution считается более тяжёлым дефектом, чем лишний `unresolved`.

Текущий strict seki verifier `closed-mutual-two-liberties-seki-v1` автоматически подтверждает только замкнутую mutual-life пару:

- две противоположные logical groups имеют ровно две одинаковые shared liberties;
- каждая shared liberty соприкасается только с этими двумя groups и, возможно, со второй shared liberty; третья group или дополнительный empty neighbour разрушает proof;
- при таком замкнутом boundary первый ход любой стороны в одну shared liberty оставляет обеим группам только вторую, где ответ соперника захватывает инициирующую группу; критерий симметричен по цвету и использует только `Topology.neighbors(PointId)`;
- любая seki-like форма вне этого критерия остаётся `unresolved`; topology-specific расположение не создаёт отдельного shortcut к automatic `seki`.

Минимальная стратегия reuse для production core:

- адаптировать зрелую deterministic pass-alive/Benson implementation к `Topology.neighbors(PointId)`;
- строить dead/seki поверх узких candidate/verifier boundaries;
- не импортировать neural model или rectangular game engine в authoritative domain core только ради 0.3.

## 12.5. Final Proof Search runtime contract

После conservative static structural pass `FinalProofSearch` получает только те logical groups, которые остались `unresolved`, и может изменить их automatic status только при завершённом proof. Отсутствие Benson/pass-alive proof само по себе никогда не означает `dead`.

Production proof path остаётся topology-neutral и использует только authoritative logical board, `Topology` и существующий `GameEngine` для legal transitions. Отдельного Cube/Torus life-death engine, второго scorer или renderer-specific search path нет.

Proof layers выполняются от дешёвых к дорогим:

1. tactical forced-capture reader для low-liberty groups;
2. построение bounded/certified `RelevanceZone`;
3. локальный AND/OR life-and-death search внутри этой зоны с возрастающими node budgets.

Automatic `dead` требует доказательства forced capture при обоих порядках первого локального хода: attacker-first и defender-first. Для kill proof defender/AND node обязан закрыть все legal continuations, необходимые для доказательства. Неполная enumeration не может считаться победой. Attacker/OR node может использовать selective candidate generation только потому, что найденная полностью доказанная ветка достаточна для kill, а отсутствие такой ветки возвращает `unknown`, а не survival.

Любой из следующих исходов fail-closed в `unresolved`:

- ko-dependent line;
- открытая или несертифицированная locality boundary;
- cycle;
- depth, node или wall-clock exhaustion;
- неполная enumeration/branch;
- невозможность однозначно сохранить target/crucial group identity;
- другой incomplete/unknown search outcome.

`FinalProofSearch` обязан отказаться от automatic proof search целиком, если переданный group context или proposal не покрывает **ровно** все logical stone groups authoritative final board. Partial context не допускается как основание для статуса.

Поиск работает на производных immutable search states. Он не мутирует authoritative final `GameState`, capture counters, move number, phase, history или final board position. Search evidence/diagnostics могут прикрепляться к `EndgameProposal` как renderer-independent metadata; `ScoringStrategy` эти evidence не читает и получает только итоговый resolved classification после review.

Progress (`current group`, tier, explored nodes, elapsed time и т. п.) является только observable diagnostic/presentation signal. Он не является confidence score, не меняет proof semantics и не становится вторым источником session/domain state.

Default production safety envelope:

- soft wall-clock budget: `3000 ms`;
- hard wall-clock budget: `4500 ms`;
- global node budget: `60,000`;
- maximum certified `RelevanceZone`: `96` logical points;
- tactical budget: `300` nodes на каждый first-player order; scheduler запускает этот tier только для targets до `3` liberties, а сам reader остаётся fail-closed и покрыт regression cases вплоть до `4` liberties;
- local life/death tiers: `300 → 1500 → 6000` nodes на каждый first-player order;
- full-board tactical defender enumeration допускается только для topology до `128` logical points; на большем graph этот tier пропускается/fails closed и остаются certified local proof paths и manual fallback.

Исчерпание любого budget уменьшает только automatic coverage и никогда не ослабляет требования доказательства. Benchmark measurements являются regression/operational evidence конкретного CI run и не заменяют эти correctness invariants.

# 13. PresentationModel

`PresentationModel` отделяет доменное/session state от конкретного способа рисования.

Вход может включать:

- current `GameState`;
- session configuration;
- текущий `EndgameReviewState`;
- endgame classification/result metadata;
- `ViewState`;
- domain/application queries, нужные для presentation.

Выход — семантический `ViewModel`, который может содержать:

- stones с `PointId`;
- current player;
- last-move data;
- move numbers;
- capture counters;
- allowed/forbidden interaction state;
- partial endgame review presentation data;
- territory/endgame presentation data;
- final result;
- topology/render mapping, необходимый Renderer.

`PresentationModel` не принимает доменные решения и не изменяет `GameState` или authoritative review decisions.

# 14. BoardRenderer и конкретные Renderer

Минимальный общий смысл Renderer contract:

- `render(viewModel)`;
- `hitTestGamePoint(pointer) → logical PointId | null` для stone/game-point interaction;
- получить/применить renderer-specific `ViewState` через presentation boundary при необходимости;
- renderer-specific controls, которые не являются игровыми точками, создают typed `ViewIntent`, а не фиктивный `PointId`.

Renderer отвечает только за отображение и перевод пользовательского взаимодействия обратно в logical game intent либо presentation `ViewIntent`.

Renderer запрещено:

- определять соседство;
- вычислять группы/liberties/captures как источник истины;
- решать scoring;
- самостоятельно определять допустимость доменного хода;
- создавать logical `PointId` из screen/DOM/mesh данных;
- присваивать `PointId` пустому layout slot только ради click handling;
- хранить авторитетную игровую позицию;
- менять captures/currentPlayer/history/GamePhase.

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
- не участвует в game-point hit-testing;
- удаляется после transition.

Presentation-only empty slots vertical-pair interaction не являются duplicates и могут оставаться отдельными typed view controls.

## 14.3. Torus renderer-only copies

Пассивные Torus duplicate regions, когда они включены продуктовым presentation state, являются renderer-only projections исходных `PointId`. Они не расширяют `TorusTopology` и не создают duplicate game state или hit targets.

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
- presentation/view boundary поддерживает `AnimationMode = normal | disabled`, который может отключить presentation-level transitions/effects без изменения domain state;
- переключение animation mode не пересоздаёт `GameSession`, не меняет `History` и не требует replay game заново;
- точные направления, длительности, easing и visual appearance находятся только в `GAME_CUBE_GO.md`.

# 16. GameStorage, autosave и PreferencesStorage

## 16.1. GameStorage

Канонический application-level storage contract текущей партии называется `GameStorage`:

- `save(serializableSession)`;
- `load()`;
- `clear()`.

`GameSession` зависит от `GameStorage`, а не от `localStorage`, IndexedDB или server API напрямую.

Локальные adapters могут включать:

- `LocalStorageGameStorage`;
- `IndexedDbGameStorage`.

Будущие remote/cloud persistence adapters не смешиваются с игровым `NetworkTransport`.

Если код использует имя `GameRepository`, оно должно быть либо alias/adapter с тем же единственным application responsibility, либо мигрировано к одному каноническому storage boundary; нельзя поддерживать две конкурирующие абстракции, которые обе претендуют на владение persistence партии.

Сохраняется `GameSessionSnapshot` или эквивалентный envelope, содержащий всё необходимое для exact restoration, включая History redo-future, partial `EndgameReviewState` и связанные result metadata.

Обязательный persistence invariant:

`Undo → save → load → Redo`

должен возвращать тот же следующий state/result, который был доступен до reload.

## 16.2. Autosave ordering / revision

Каждое persist-worthy изменение session state получает монотонно возрастающий `sessionRevision`.

Persist-worthy изменения включают как минимум принятые game actions, Undo/Redo, изменения endgame review decisions и переход к final result.

`GameSession`/application persistence coordinator обязан сериализовать autosave writes в единую ordered queue либо использовать функционально эквивалентный механизм, который даёт ту же гарантию:

- snapshot revision `N+1` никогда не может быть фактически заменён более поздно завершившейся записью revision `N`;
- completion order асинхронного storage API не является источником истины о свежести save;
- persisted envelope хранит revision, чтобы stale write/load можно было распознать;
- новый save после failed write не должен откатывать in-memory authoritative session state к старой revision.

Storage adapter дополнительно должен отказываться считать более низкую revision более новой, если его backend допускает конкурирующие writes.

## 16.3. PreferencesStorage

Cross-game `UserPreferences` хранятся через отдельную логическую storage boundary `PreferencesStorage` или эквивалентный отдельный namespace с тем же смыслом.

Минимальный смысл:

- `loadPreferences()`;
- `savePreferences(preferences)`;
- schema validation/evolution независимо от game save.

`GameStorage.clear()` очищает текущую сохранённую партию и **не очищает `UserPreferences`**.

Preferences не входят в `LinearHistory`, Simple Ko context или authoritative network game state. Конкретные preferences, которые продукт разрешает запоминать, определяет только `GAME_CUBE_GO.md`.

Runtime validation повреждённых/старых game saves и preferences, а также schema migrations должны быть тестируемыми и fail-safe.

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

## 17.1. Development Workspace и AlphaZero boundary

`Development Workspace` — постоянная application/developer capability, а не второй игровой движок и не test-generator runtime.

AlphaZero подключается через typed contract `AlphaZeroGateway`. UI и replay orchestration зависят от этого contract и не знают `fetch()`, transport URL, Python, PyTorch или filesystem path checkpoints. Первая transport implementation — `HttpAlphaZeroClient`, работающая с отдельным локальным Python service из `gocube-alphazero`.

Default base URL — `http://127.0.0.1:8765`; конкретный base URL задаётся через Vite/application config boundary. Отсутствие сервиса является допустимым состоянием Development Workspace и не влияет на запуск или correctness обычной игры.

V1 gateway поддерживает минимум:

- `health()`;
- `listCheckpoints()`;
- `generateGame()`.

Transport использует versioned JSON contract с `protocolVersion: 1`. Checkpoint descriptor содержит stable id и game compatibility metadata; UI не получает filesystem path как identity. Сервис конвертирует собственный AlphaZero action index в канонический GoCube `PointId` до отправки move через transport.

Внешний JSON валидируется до использования: protocol version, required fields, finite numbers, topology, size, rules, komi, checkpoint metadata, move numbering, color/action variants, canonical `PointId` и optional captured points. Unchecked type assertion не заменяет runtime validation.

`AlphaZeroGateway` предоставляет generated action sequence и diagnostics, но не `GameState` authority. Запрещено передавать готовую board occupancy в Renderer или напрямую мутировать `GameState` по данным AlphaZero.

`DeveloperReplaySession` создаёт обычный controller/`GameSession` без persistence config. Такая ephemeral session использует тот же `GameEngine`, `Topology`, `AssistedEndgameClassifier`, scoring и History, что обычная локальная партия, но не имеет права писать в `CURRENT_GAME_ID = "current"` или запускать normal autosave.

Каждый generated move проходит строго последовательно:

1. проверить metadata созданной developer game и expected current player;
2. для placement отправить canonical `PointId` через controller → `GameSession.execute(PlaceStone)`; для Pass использовать штатный Pass command;
3. дождаться authoritative result;
4. остановить replay при rejection;
5. если transport передал captured points, сравнить их с authoritative captured result;
6. только после успешной проверки перейти к следующему generated move.

Backward/forward seeking использует session History: назад — Undo, вперёд по существующему redo-future — Redo, а новый forward frontier — следующий generated action. Отдельная board model для replay не создаётся.

Compatibility failure является application diagnostic и содержит достаточный context для локализации расхождения: move number, expected color/current player, action/PointId и rejection/mismatch reason. После failure replay прекращает forward execution, но приложение и обычная сохранённая партия остаются работоспособными.

Future методы вроде position analysis, policy/value и best move добавляются на `AlphaZeroGateway`/соседних developer contracts без переноса AI dependencies в domain core.

# 18. Основные потоки данных

## 18.1. Допустимый ход

1. Renderer выполняет game-point hit-test и возвращает `PointId`.
2. UI создаёт `PlaceStone(pointId)`.
3. UI передаёт `GameCommand` в `GameSession`.
4. `GameSession` получает current state и минимальный `SimpleKoContext` из `History`.
5. Command передаётся через local authority boundary в `GameEngine`.
6. `GameEngine` использует `Topology` для соседства.
7. `GameEngine` рассчитывает группы/liberties/captures/suicide.
8. Единственный `SimpleKoPolicy` проверяет candidate state по переданному context.
9. `GameEngine` возвращает новый `GameState + DomainEvents`.
10. `GameSession` обновляет `History`.
11. Session revision увеличивается, а snapshot ставится в ordered autosave queue через `GameStorage`.
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

Pass проходит тем же `GameCommand` path, что и постановка stone.

Когда accepted Pass выполняет доменное условие окончания основной фазы, `GameEngine` возвращает `GameState` с `GamePhase = ENDGAME_REVIEW`.

Далее:

1. `GameSession` видит доменный phase и запускает `EndgameClassifier.analyze(...)`.
2. Из `EndgameProposal` создаётся сохраняемый `EndgameReviewState`.
3. Ручные/assisted statuses изменяют только review state; каждое изменение autosave-ится с новой session revision. Presentation/UI не хранит вторую изменяемую копию этих решений: экран читает актуальные statuses из session-owned review state и отправляет каждое изменение как session command. DOM events, synthetic clicks и replay пользовательского UI не используются как механизм синхронизации review state.
4. Пока review incomplete, scoring не запускается.
5. Когда review полностью resolved, создаётся полный `EndgameClassification`.
6. `GameSession` передаёт classification в выбранный `ScoringStrategy` и получает `FinalScore`.
7. `GameSession` передаёт внутреннюю доменную `CompleteEndgame` operation через authority/engine boundary.
8. `GameEngine` валидирует, что current phase — `ENDGAME_REVIEW`, и возвращает `GameState` с `FINISHED`.
9. Session сохраняет final classification/result metadata и новый state.

`GameSession` ни на одном шаге не присваивает `GamePhase` напрямую.

Точная пользовательская семантика Pass/endgame и визуальный UX определены в `GAME_CUBE_GO.md`.

## 18.4. Undo / Redo

`UI → GameSession → History`

`GameSession` получает точный restored snapshot, восстанавливает связанные session-level review/result metadata, увеличивает session revision, сохраняет новый session envelope и обновляет PresentationModel.

Renderer не реконструирует историю самостоятельно.

## 18.5. Смена Renderer/View mode

Смена 2D/3D presentation меняет `ViewState`/renderer selection и orientation anchor, но не `GameState`.

`GameEngine`, scoring и history не должны замечать факт смены Renderer.

## 18.6. Cube 2D empty-slot interaction

1. Renderer/presentation control определяет пустой разрешённый Cube 2D slot.
2. Он создаёт `MoveCubeVerticalPair(column)` или эквивалентный typed `ViewIntent`.
3. Presentation layer обновляет Cube 2D layout/ViewState.
4. `CubeOrientation`/layout mapping пересчитывает physical faces/rotations.
5. `GameState`, `History`, `SimpleKoContext` и stone positions не меняются.

Пустой slot не создаёт `PointId` и не проходит через `PlaceStone`/`GameEngine`.

## 18.7. AlphaZero developer replay

1. Development UI получает validated generated game через `AlphaZeroGateway`.
2. `DeveloperReplaySession` проверяет generated metadata и создаёт ephemeral обычную game session с теми же topology/size/rules/komi.
3. Generated move color сверяется с `GameState.currentPlayer`.
4. Placement или Pass выполняется через обычный controller/`GameSession` path.
5. `GameEngine` заново применяет все rules, captures, suicide, Simple Ko, turn order и phase transitions.
6. При accepted action presentation получает обычный `GameViewModel`, и existing Renderer показывает то же состояние, что в обычной партии.
7. При rejection/color/capture mismatch replay останавливается и создаёт compatibility diagnostic; следующие moves не применяются.
8. Два последовательных Pass естественно приводят в обычный assisted endgame flow; Development Workspace не обходит classifier и не завершает scoring автоматически.
9. Ни один шаг developer replay не записывает обычный saved game.

# 19. Testing architecture

Автоматические проверки делятся по владельцам ответственности.

PR CI имеет ровно три режима:

- `[no-test]` в title PR — автоматические test/build/lint/typecheck steps для этого PR не запускаются; workflow выполняет только выбор режима и быстро завершается успешно;
- без специального marker — стандартный CI: static lint, TypeScript typecheck, unit/integration tests с global coverage thresholds, production build и Playwright E2E только в Chromium;
- `[full]` в title PR — полный regression gate: все стандартные проверки плюс Playwright E2E в Chromium, Firefox и WebKit.

`[full]` не выбирается автоматически по сложности, размеру, риску, затронутым файлам, renderer/architecture changes или по самостоятельному решению агента. Агент не добавляет `[full]` в title PR, если пользователь явно не попросил Full CI именно для этого PR. Единственное автоматическое применение full — release finalization.

Изменение title PR повторно запускает CI, поэтому по явному запросу пользователя режим можно переключить без нового code commit. Если одновременно указаны `[full]` и `[no-test]`, приоритет имеет `[full]`.

Обычный push в `main` не повторяет уже выполненный PR CI. Release-finalization push всегда принудительно выполняет `full` независимо от title/marker, и только такой cross-browser прогон считается полным regression/release gate. Режим `[no-test]` сознательно не является доказательством regression correctness и используется только как явное решение пропустить автоматические проверки для конкретного PR.

## 19.1. GameEngine tests

Покрывают:

- groups/liberties;
- captures;
- suicide;
- turn switching;
- Pass;
- action numbering;
- `PLAYING → ENDGAME_REVIEW` и `ENDGAME_REVIEW → FINISHED` через доменные операции;
- невозможность `CompleteEndgame` из неправильной phase;
- единственный `SimpleKoPolicy` через переданный `SimpleKoContext`;
- отсутствие superko semantics;
- детерминизм domain results;
- отсутствие зависимости от UI/browser/Renderer.

Полную последовательность доменных действий должно быть возможно прогнать headless командами напрямую; session-level manual review тестируется отдельно.

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
- перенос vertical pair во все допустимые layout columns через presentation state;
- click/intent верхнего и нижнего empty slot одной колонки даёт одну и ту же layout semantics;
- выбранная колонка vertical pair сохраняется после horizontal navigation;
- empty slot никогда не превращается в `PointId` или stone hit target;
- presentation-only layout state не меняет `GameState`/`CubeTopology`.

Перед подключением 3D должна существовать diagnostic/headless функция, способная для любой cube `PointId` получить её каноническую surface/orientation информацию без Renderer2D.

## 19.4. History tests

Покрывают:

- Undo/Redo stone;
- Undo/Redo Pass;
- `canUndo/canRedo`;
- восстановление currentPlayer/captures/Simple-Ko/pass/action/GamePhase data;
- формирование минимального `SimpleKoContext` ровно из необходимой ближайшей history позиции;
- clearing redo после нового действия;
- serialization/restoration past/current/redo;
- restoration partial endgame review/result metadata.

## 19.5. Persistence tests

Обязательны:

- serialize → save → load → semantic equality;
- corrupted/old data handling;
- schema migration tests при изменении формата;
- regression `Undo → save → load → Redo`;
- partial `EndgameReviewState` переживает save/load без потери пользовательских решений;
- final result state восстанавливается детерминированно;
- искусственно задержанные async writes `revision N` и `revision N+1` не позволяют старой revision победить;
- rapid sequence move/pass/undo/review-decision сохраняет highest committed session revision;
- `GameStorage.clear()` не удаляет `UserPreferences`;
- preferences и game save валидируются/мигрируют независимо.

Storage adapter должен заменяться без изменения `GameSession` API.

## 19.6. Scoring/endgame tests

Покрывают:

- Chinese/Japanese scoring на одинаковых classified positions;
- komi;
- alive/dead/seki;
- neutral regions;
- separation classifier/review/scorer;
- manual proposal с unresolved groups;
- assisted proposal не присваивает недоказанный статус;
- изменение и повторное изменение пользовательского group status;
- scoring не запускается при incomplete review;
- полный review детерминированно создаёт `EndgameClassification`;
- работу classifier через абстрактный `Topology` без renderer assumptions;
- отсутствие изменения итогового scoring при одинаковом полном `EndgameClassification` независимо от того, какие statuses пришли automatic, а какие user;
- доказуемые automatic statuses отдельно от heuristic/oracle candidates;
- Final Proof Search forced-resolution cases и conservative fallback при open boundary, ko, depth/node/deadline exhaustion или другом incomplete outcome;
- fail-closed поведение при incomplete group/proposal context;
- tactical regressions для low-liberty capture, multi-step capture, ladder, net, snapback и counter-capture defense;
- topology-metamorphic эквивалентность применимых proof cases для Torus interior/wrap seam и Cube same-face/face-edge/multi-face groups;
- benchmark/regression checks operational runtime envelope отдельно от correctness assertions: превышение budget не имеет права превращаться в guessed status.

## 19.7. Renderer contract tests

Проверяют:

- game-point hit-testing возвращает `PointId`;
- presentation-only control возвращает typed `ViewIntent`, а не fake `PointId`;
- Renderer не создаёт собственную игровую истину;
- Cube stable representation не создаёт duplicate interactive logical points;
- Cube empty slots не являются stone hit targets и сохраняют разрешённую view interaction capability;
- temporary animation-only elements не участвуют в game-point hit-testing;
- Torus passive copies ссылаются на source `PointId` и остаются non-interactive;
- shared BoardTheme/assets действительно переиспользуются, а не дублируются независимыми реализациями.

## 19.8. Property-based / fuzz testing

Генерируемые последовательности допустимых действий проверяют как минимум:

- одинаковый state + command + SimpleKoContext → одинаковый result;
- Undo/Redo exact restoration;
- новое действие после Undo очищает redo-future;
- serialize/deserialize сохраняет семантическую эквивалентность session state;
- `Undo → save → load → Redo` сохраняет следующий state/result;
- допустимый завершённый ход не оставляет собственную группу без liberties;
- Simple Ko запрещает только immediate board recreation и не превращается в superko по более старой history;
- повторное проигрывание одной command sequence приводит к тому же final state;
- topology contract не нарушается.

Seed любого найденного дефекта сохраняется; после минимизации случай превращается в постоянный regression fixture.

### 19.8.1. Endgame test-position generators

Для 0.3 существует единая deterministic **test-only** generator infrastructure с несколькими генераторами, а не один «random fill»:

- **LegalGameGenerator** — генерирует последовательность допустимых ходов через настоящую domain boundary; может предпочитать ходы рядом с существующими stones, но не пишет occupancy напрямую;
- **EndgamePositionGenerator** — продолжает legal simulation до плотных/финальных состояний и создаёт позиции, пригодные для массового classifier testing;
- **LocalLifeDeathPatternGenerator** — test-only размещает/трансформирует маленькие curated patterns: один глаз, два глаза, false-eye, окружённые группы, локальные capture/life-death формы и другие явно заданные fixtures;
- **SekiPatternGenerator** — создаёт curated obvious/ambiguous seki-like cases для proof/fallback tests;
- **TopologyStressGenerator** — переносит применимые patterns через Torus seam и через Cube edge/corner regions, чтобы одна и та же логическая идея проверялась на необычных связностях.

Legal simulation и synthetic fixture construction — разные test boundaries. Synthetic builder может создавать позицию напрямую только внутри test infrastructure и обязан валидировать point ids/occupancy/group assumptions; такой API не доступен production gameplay и не заменяет `GameEngine`.

Все generators обязаны поддерживать stable seed. Дефектный случай воспроизводится внутри автоматических tests по `generator kind + topology + size + seed + generator version/options`; runtime Test ID API для внутренней generator infrastructure не вводится. Это не ограничивает отдельный Development Workspace, который replay-ит внешнюю AlphaZero move sequence через обычную `GameSession`.

## 19.9. Fixture format

Внутренний fixture-формат является test infrastructure, а не пользовательским export/import.

Fixture может содержать:

- schema version;
- topology type/size;
- stones;
- current player;
- `SimpleKoContext`/предыдущую сравниваемую board position;
- pass state;
- capture counters;
- scoring mode;
- komi;
- expected groups/liberties/legal moves/captures;
- expected endgame proposal/review/classification/scoring data при необходимости;
- generator metadata/seed и oracle diagnostics при необходимости для воспроизведения test failures.

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
- Cube presentation slot/view-intent mapping;
- Torus passive-copy → source `PointId` mapping.

Debug renderer сам по себе не является пользовательской функцией и не определяет correctness. Он не публикует внутренние Test Case generators, Test ID или corpus loading API. Постоянный Development Workspace является отдельной application capability и может использовать этот или обычный production Renderer через разрешённые presentation contracts.

## 19.11. Development Workspace / AlphaZero tests

AlphaZero client/protocol coverage проверяет как минимум: valid health, unavailable service, malformed JSON, unsupported protocol, checkpoint validation, generated game validation и malformed moves.

`DeveloperReplaySession` coverage проверяет обычные placements, Pass, captures, expected-color mismatch, illegal generated move, optional captured mismatch, Undo/Redo-based Previous/Next, seek backward/forward, jump to start/end и deterministic reach of final move.

Presentation coverage проверяет, что изменение replay speed не меняет domain state, `1×` использует normal animation mode, а `5×`/`10×` — disabled; seek/jump выполняется без animation независимо от выбранной скорости.

Isolation coverage обязана доказывать, что opening/using/exiting Development Workspace не удаляет и не меняет saved game `current`, а developer replay не вызывает обычный autosave.

E2E использует mocked AlphaZero transport и реальный GoCube application path/Renderer. CI не требует реально запущенного Python AlphaZero service. Отдельный E2E проверяет compatibility failure и отсутствие application crash.

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

Любой внешний engine/oracle при сравнении repetition behavior на project fixtures настраивается/интерпретируется только в соответствии с текущим `SimpleKoPolicy`; наличие у внешней библиотеки superko options не делает их частью архитектуры проекта.

`@sabaki/sgf` допустим также как parser/source для test-only импорта стандартных SGF, из которых извлекаются локальные patterns/fixtures. SGF не становится пользовательским game export/import и не определяет Cube/Torus topology.

## 20.4. Endgame candidates и зафиксированная reuse strategy для 0.3

Исходный обзор 0.3 классифицирует кандидаты следующим образом. Перед фактическим подключением всё равно проверяется актуальная лицензия/API конкретной выбранной revision; этот раздел фиксирует архитектурную роль, а не pin версии.

### 20.4.1. Moka (`millionco/moka`) — **adapt** для production deterministic core

Moka содержит TypeScript implementation conservative pass-alive analysis с Benson-like fixed-point elimination и дополнительный capture-aftermath для dead candidates.

Для GoCube:

- pass-alive/Benson часть является главным исходным кандидатом на адаптацию;
- rectangular adjacency заменяется на `Topology.neighbors(PointId)` и project group/region abstractions;
- deterministic proof-oriented часть может войти в production classifier при сохранении MIT license obligations;
- capture-aftermath/greedy capture result рассматривается только как candidate/heuristic, пока project verifier не докажет `dead`;
- neural/model часть Moka не требуется для authoritative 0.3 core.

### 20.4.2. KataGo — **offline oracle/reference only**, не runtime dependency

KataGo может использоваться вне runtime как сильный независимый standard-Go oracle для test-only differential/reference work на позициях, где adapter доказал применимость обычной square-grid модели.

KataGo не считается понимающим Torus/Cube глобально. Его результат может применяться только к позиции/локальному neighbourhood, для которого adapter доказал эквивалентность обычной square grid, и никогда не становится authoritative status без project verifier.

В репозитории/runtime нет browser-to-KataGo bridge, `LocalAnalysisClient`, live corpus diagnostics или пользовательского/developer Test Case UI. KataGo не входит в browser production bundle и не требуется для final scoring или обычной игры. Это ограничение относится к KataGo/oracle path и не отменяет отдельно определённый AlphaZero Development Workspace boundary из §17.1.

### 20.4.3. `goscorer` — **oracle/reference**

`goscorer` полезен как независимый planar scoring/seki oracle после корректной маркировки dead stones и как источник fixtures/heuristic ideas.

Он не заменяет GoCube `ScoringStrategy`, потому что его primary model rectangular и production scorer проекта уже работает через topology-neutral adjacency.

### 20.4.4. `online-go/score-estimator` — **oracle/candidate generator**

OGS score-estimator полезен как независимый planar dead/score estimator и differential source. Его suggestion не считается proof для automatic status на Cube/Torus.

Rectangular/Emscripten implementation не затаскивается в domain core только ради 0.3.

### 20.4.5. `@sabaki/deadstones` — **oracle/candidate generator**

Monte-Carlo/stochastic dead-stone detection пригодна для независимого сравнения и поиска подозрительных cases.

Из-за вероятностной природы её результат не может напрямую становиться automatic `dead`; stable seed/iterations должны фиксироваться при test reproduction, если библиотека используется в differential tooling.

### 20.4.6. `@sabaki/go-board`, Tenuki, Sente, tsumego.js — **reference с ограниченной ролью**

- `@sabaki/go-board` — standard rectangular groups/liberties/reference; не нужен как production engine поверх существующего `Topology` core.
- Tenuki — дополнительный planar rules/scoring/seki reference; simple seki heuristics не считаются proof для нестандартных topology.
- Sente — стандартный Go reference, но отсутствие automatic dead-stone removal делает его низкоприоритетным для 0.3.
- `tsumego.js` — возможный источник идей для bounded life-and-death search; standard-grid/open-boundary limitations не позволяют использовать его напрямую как topology-neutral authority.

### 20.4.7. `goplayerjuggler/goVariants` / Go-Variants-Engine — **Torus oracle/reference**

MIT JavaScript engine с Toroidal Go особенно полезен как независимый Torus-specific reference для mechanics/scoring/regions после заданной dead marking.

Он не решает главную задачу auto-dead и не заменяет GoCube classifier, но даёт редкий внешний differential source именно для toroidal topology.

### 20.4.8. `govariantsteam/govariants` — **Cube/graph reference only**

Проект содержит generic graph/custom-board и Cube variant concepts, но использует AGPL-3.0.

Поэтому:

- разрешено изучать architecture/test ideas и использовать независимое поведение как reference;
- нельзя копировать/адаптировать его код или включать runtime dependency в GoCube без отдельного осознанного решения пользователя о лицензионных последствиях;
- он не является каноническим источником Cube rules проекта.

### 20.4.9. GNU Go и другие GPL/copyleft engines — **offline oracle only при необходимости**

Сильный copyleft и rectangular assumptions делают такие engines плохими production dependencies. Они допустимы как изолированные offline/dev oracle, если реально дают дополнительную независимую проверку, но не должны попадать в browser/runtime bundle без отдельного license decision.

### 20.4.10. Итоговая 0.3 reuse boundary

Предпочтительный production объём собственного/адаптированного кода ограничивается:

- topology-neutral Benson/pass-alive adapter;
- узкими candidate generators;
- строгими dead/seki verifiers;
- orchestration `EndgameProposal → EndgameReviewState`.

Не следует писать заново или тащить в production без необходимости:

- второй scoring engine;
- полноценный rectangular Go engine;
- собственную neural network;
- собственный SGF ecosystem;
- отдельный Torus/Cube scoring implementation;
- огромный вручную составленный fixture corpus вместо test-only generators + external references.

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

На позициях, где модель проекта совпадает со стандартным плоским Go, зрелые внешние движки можно использовать для test-only differential/regression сравнения стандартной логики.

Совпадение с внешним движком не доказывает корректность TorusTopology/CubeTopology; необычные topology доказываются собственными contracts, fixtures и property/fuzz tests.

Differential oracle не может расширять правила repetition проекта: сравнение считается релевантным только в режиме, эквивалентном `SimpleKoPolicy`.

Oracle disagreement не означает автоматически bug GoCube. Test report обязан сохранять достаточные diagnostics/seed, чтобы различить:

- defect classifier;
- limitation external oracle;
- non-planar/topology-specific case;
- insufficient local context;
- истинно unresolved position.

### 20.10.1. Planar Local Analyzer для standard-Go oracle

Для Torus/Cube допускается test-only локальный adapter, который использует standard-Go oracle только там, где рассматриваемый induced neighbourhood может быть без конфликтов вложен в обычную square grid.

Процедура:

1. выбрать target group/region;
2. расширить neighbourhood через `Topology.neighbors()` на настраиваемый graph radius;
3. попытаться назначить точкам integer 2D coordinates так, чтобы каждое logical neighbour edge соответствовало одному ортогональному grid step;
4. обнаружить coordinate conflicts, duplicate logical embeddings, short cycles/adjacency, несовместимые с square grid, или wrap/self-meeting;
5. только при успешной embedding подготовить standard-Go representation для test oracle;
6. при неуспешной embedding вернуть `not-applicable`, а не искусственно ломать topology.

Для Torus небольшие neighbourhoods обычно planar-grid compatible, пока область не обходит torus и не встречает сама себя. Для Cube многие области внутри face и через одно обычное edge также совместимы, но neighbourhood около physical cube corner может содержать трёхциклы и должен отклоняться как non-planar-standard-Go case.

Этот adapter не является runtime feature и не предоставляет browser/local-KataGo transport. Конкретный внешний oracle подключается только внутри test tooling через узкий `DifferentialOracleAdapter` или эквивалент. Отдельный AlphaZero Development Workspace использует другой application contract и не расширяет эту oracle boundary.

## 20.11. Фиксация reuse decision

Результат review фиксируется кратко в рабочем контексте задачи/PR как implementation rationale, а не вводится как новый проектный документ. Создавать новый `.md` ради Library/Reuse Review нельзя без отдельного разрешения пользователя.

# 21. Архитектурные анти-паттерны

Запрещено:

- Cube-specific branches в базовом `GameEngine`;
- отдельный `GameEngine` для Torus и Cube;
- хранить visual duplicates как игровые stones/points;
- использовать screen coordinates как logical identity;
- выводить `PointId` из DOM/SVG/CSS/canvas/Three.js ids;
- присваивать `PointId` пустому Cube layout slot только ради interaction;
- размазывать Chinese/Japanese scoring по базовой механике;
- автоматически определять alive/dead внутри `ScoringStrategy`;
- запускать scoring на partial/incomplete endgame review;
- выдавать unresolved classifier result за окончательный `EndgameClassification`;
- считать probabilistic AI/oracle confidence доказательством alive/dead/seki без project verifier;
- трактовать отсутствие Benson/pass-alive proof, exhaustion budget или incomplete Final Proof Search branch как `dead`/`alive`;
- использовать неполную defender enumeration как доказательство forced kill;
- запускать неограниченную full-board tactical defender enumeration на больших topology вместо bounded/fail-closed path;
- делать внешний oracle или AlphaZero обязательной production dependency;
- считать AlphaZero authoritative владельцем `GameState` или принимать от него готовую board occupancy вместо generated actions;
- рисовать AlphaZero board напрямую в Renderer или мутировать `GameState` в обход `GameSession → GameEngine`;
- помещать HTTP/fetch/Python/PyTorch/AlphaZero dependencies в `core/game`, `core/topology`, `core/scoring` или `core/endgame`;
- сохранять developer replay в `CURRENT_GAME_ID` или использовать обычный autosave для ephemeral developer session;
- считать любой Cube/Torus neighbourhood эквивалентным центру обычной Go board без проверки square-grid embedding;
- генерировать «legal game» путём прямой случайной записи occupancy в обход `GameEngine`;
- публиковать test-only generator/fixture machinery как пользовательский runtime Test Case/Test ID API;
- читать browser storage из `GameEngine`;
- давать `GameEngine` объект `History` вместо минимального `SimpleKoContext`;
- держать `SuperkoPolicy`, selectable repetition policy или скрытый superko branch «на будущее»;
- вкладывать `History`/redo-future внутрь `GameState`;
- моделировать `GamePhase` набором конфликтующих boolean-флагов;
- менять `GamePhase` прямым присваиванием из `GameSession`, UI или Renderer;
- смешивать `GameCommand`, `SessionCommand`, `ViewIntent` и New Game draft changes в один бесформенный command path;
- терять redo-future при autosave/reload;
- разрешать старой async save revision перезаписывать более новую;
- хранить cross-game preferences только внутри текущего `GameSessionSnapshot`;
- очищать product-approved preferences вместе с `GameStorage.clear()`;
- хранить ViewState в rule history как игровое действие;
- давать animation mode влиять на domain transition или authoritative state;
- вызывать Three.js из `Topology`;
- делать Renderer владельцем captures/currentPlayer/history/endgame decisions;
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
3. Это `GameCommand`, `SessionCommand`, `ViewIntent` или New Game draft change?
4. Нужна ли сменная реализация или достаточно локального изменения?
5. Существует ли подходящий interface/adapter?
6. Не создаёт ли изменение обратную зависимость от infrastructure к domain core?
7. Можно ли протестировать новую логику headless без browser/Renderer?
8. Можно ли заменить TorusTopology на CubeTopology без переписывания этой логики?
9. Сохраняется ли только `SimpleKoPolicy`, без альтернативного repetition branch?
10. Можно ли заменить storage adapter без изменения `GameSession` API и без нарушения revision ordering?
11. Не смешивается ли cross-game preference с session save/ViewState?
12. Можно ли заменить Renderer2D/Renderer3D без изменения `GameState` и rules?
13. Можно ли в будущем заменить local execution на `RemoteGameAuthority` без изменения UI?
14. Сохраняется ли один authoritative current `GameState` при отдельной History/session envelope?
15. Все ли forward изменения `GamePhase` проходят через доменную границу, а не прямой mutation координатора?
16. Не дублируется ли нормативное правило между архитектурой, roadmap и product requirements?
17. Если используется oracle/AI, доказано ли, что он только diagnostic/candidate либо его результат проходит явную project verification boundary?
18. Если standard-Go oracle применяется к Cube/Torus, доказана ли применимость конкретного planar neighbourhood вместо предположения по degree=4?
19. Можно ли полностью запустить production gameplay/scoring без внешних oracle, AlphaZero и test-only tooling?
20. Любой generated legal-game fixture действительно прошёл domain rules, а synthetic fixture остаётся изолированным test-only path?
21. Если AlphaZero используется в Development Workspace, каждый ли generated move повторно проходит authoritative `GameSession → GameEngine`?
22. Developer session действительно ephemeral и доказано ли, что она не пишет normal saved game?
23. Transport DTO runtime-валидирован до использования и использует canonical `PointId`, а не внешний action index?
24. Можно ли заменить HTTP transport другой реализацией `AlphaZeroGateway` без изменения replay/domain core?

Если ответ показывает нарушение границы, сначала исправляется architecture/adapter contract, затем реализуется функция.

# 23. Минимальная ментальная модель

Для разработки систему следует держать в голове как цепочку:

- пользователь создаёт typed intent в UI;
- `GameCommand`, `SessionCommand`, `ViewIntent` и New Game draft относятся к разным путям;
- `GameSession` координирует сессию и никогда напрямую не патчит `GameState`;
- `GameAuthority` определяет место исполнения domain command;
- `GameEngine` применяет правила к current `GameState` и является владельцем forward `GamePhase` transitions;
- `Topology` сообщает logical neighbors;
- единственный `SimpleKoPolicy` проверяет immediate repetition по минимальному `SimpleKoContext`;
- `History` владеет past/current/redo snapshots;
- `EndgameClassifier` создаёт proposal, который может содержать unresolved groups;
- deterministic structural proof решает только доказуемые statuses, а heuristic/oracle остаётся candidate/diagnostic без verifier;
- bounded Final Proof Search может дополнительно resolve unresolved groups только через fail-closed tactical/local proofs и никогда не превращает exhaustion/unknown в status;
- `EndgameReviewState` хранит partial/ручные решения до полного resolution;
- только полный `EndgameClassification` передаётся в `ScoringStrategy`;
- `ScoringStrategy` создаёт `FinalScore`;
- seeded generators и independent oracle adapters помогают тестировать core только внутри test infrastructure и не становятся частью authoritative gameplay/runtime UI;
- Development Workspace отдельно получает external AlphaZero actions через `AlphaZeroGateway`, создаёт ephemeral replay session и отправляет каждый move назад через обычный controller/`GameSession`/`GameEngine`;
- AlphaZero не владеет board state, а compatibility disagreement останавливает replay и становится diagnostic;
- ordered autosave с `sessionRevision` сохраняет обычный session envelope через `GameStorage`, тогда как developer replay не подключён к normal autosave;
- `PreferencesStorage` отдельно хранит только product-approved cross-game preferences;
- `PresentationModel` строит данные для показа и управляет presentation animation mode независимо от domain state;
- Renderer отображает их, переводит game points в `PointId`, а presentation-only controls — в `ViewIntent`;
- Animation визуализирует события, не меняя правила;
- `NetworkTransport` в будущем только переносит commands/state через внешний authority boundary.

Главный критерий качества архитектуры: новая topology, новый Renderer, новый storage backend, новый classifier proof helper, новый oracle adapter, новый AlphaZero transport или будущий network adapter должны добавляться на своей границе и не требовать переписывать уже проверенное независимое domain core без реальной необходимости.
