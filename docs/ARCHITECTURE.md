# Архитектура

## Game Cube Go — нормативная архитектурная спецификация для разработки

# 0\. Назначение и статус документа

Этот документ фиксирует архитектурные границы Game Cube Go, направления зависимостей, интерфейсы, допустимые реализации и потоки данных. Документ предназначен прежде всего для использования моделью/агентом при планировании и выполнении задач разработки.  
При любой задаче по коду сначала сверяться с этим документом и проверять, не нарушает ли предлагаемое изменение границы модулей.  
Если реализация требует смешать Game Engine, topology, renderer, storage или scoring, сначала считать это архитектурным риском и искать вариант через существующий или новый узкий интерфейс.  
Этот документ суммирует решения текущего архитектурного обсуждения и актуального плана развития. При конфликте со старыми формулировками основного документа проекта использовать актуальные решения:  
— ChineseScoring и JapaneseScoring поддерживаются уже в версии 0.1.  
— В версии 0.1 финальная классификация alive/dead/seki выполняется вручную пользователем; автоматическая помощь откладывается до 0.3. Нормативно: 0.3 \= AssistedEndgameClassifier / automatic alive-dead-seki; Cube 3D к версии 0.3 не относится и вводится только в 0.5. Версия 0.4 в актуальном roadmap сознательно отсутствует; прежняя Advanced/Branching History удалена, а LinearHistory с Undo/Redo является окончательной пользовательской моделью истории уже с 0.1.  
— Актуальный Torus 2D 0.1 использует размеры 9×9/13×13/19×19, Japanese rules как настройку по умолчанию, видимый курсор мыши, 50%-preview камня, one-line non-interactive duplicate edge strips и линейный Redo.  
— Game Engine, topology и rendering являются независимыми слоями.  
— Сеть не реализуется в 0.x только ради будущего, но архитектура не должна делать локальность обязательным предположением.

# 1\. Главные архитектурные инварианты

1\) UI не изменяет GameState напрямую.  
2\) UI не вызывает GameEngine напрямую. Все пользовательские команды проходят через GameSession.  
3\) GameSession является координатором одной партии. Он оркестрирует GameEngine, History, GameStorage, endgame и presentation.  
4\) GameEngine отвечает только за доменную механику хода и не является координатором всей программы.  
5\) GameEngine не знает, Torus или Cube используется как поле. Он работает только через интерфейс Topology.  
6\) GameEngine не знает о SVG, Canvas, Three.js, DOM, React, камере, 2D-layout/navigation или визуальных дублях.  
7\) Topology описывает только логическую связность точек. В ней не должно быть renderer-specific координат.  
8\) В стабильном интерактивном состоянии Cube 2D каждая CubeFace и каждая её logical PointId отображаются ровно один раз: Cube2DLayout содержит ровно 6 занятых cells и 6 null. При этом горизонтальная навигация ←/→ является бесконечной циклической галереей четырёх боковых граней. Для физически непрерывной анимации wrap renderer при необходимости может временно создать animation-only clone уходящей/входящей грани за пределами стабильного layout; такой элемент не является Cube2DLayoutCell, не имеет собственного игрового PointId/hit target и удаляется после перехода. Постоянные визуальные копии CubeFace запрещены. Torus 2D one-line duplicate strips остаются отдельным renderer-only механизмом.  
9\) Renderer никогда не решает правила игры и не изменяет GameState напрямую.  
10\) Scoring не определяет самостоятельно жизнь/смерть групп. Он получает готовую EndgameClassification.  
11\) EndgameClassifier не содержит формулу Chinese/Japanese scoring.  
12\) History восстанавливает точное игровое состояние, но не отвечает за визуализацию.  
13\) GameStorage скрывает физический способ хранения.  
14\) Animation является только визуальной реакцией на уже совершившееся доменное событие. Анимация не должна менять результат хода и не должна быть частью GameEngine.  
15\) Переход 2D ↔ 3D не меняет GameState.  
16\) Один и тот же GameState должен быть пригоден для Torus 2D, Cube 2D и Cube 3D в соответствующих версиях.  
17\) Все rule-relevant данные должны быть сериализуемыми и детерминированно восстанавливаемыми.  
18\) Основные модули зависят от абстракций/контрактов, а не от конкретных реализаций.  
19\) Стрелка A → B в архитектурной документации означает: A использует контракт B или передаёт ему данные/команду. Она не означает наследование.  
20\) Сеть должна подключаться снаружи доменного ядра. Topology, ScoringStrategy, EndgameClassifier и GameEngine не должны знать о наличии сети.

# 2\. Верхнеуровневый путь команды

Базовый путь локальной команды:  
UI/Input → GameSession → GameEngine → GameState \+ DomainEvents → GameSession.  
После получения нового состояния GameSession выполняет необходимые побочные действия:  
GameSession → History.  
GameSession → GameStorage.  
GameSession → PresentationModel → активный Renderer.  
Если действие завершает партию:  
GameSession → EndgameClassifier → ScoringStrategy → FinalResult.  
GameEngine внутри обработки хода использует:  
GameEngine → Topology.  
GameEngine → RepetitionPolicy.  
GameEngine не должен напрямую вызывать History, GameStorage, Renderer, EndgameClassifier или ScoringStrategy.

# 3\. UI / Input

Ответственность: показывать элементы управления и принимать намерения пользователя.  
Единая панель управления — обязательный общий UI-компонент начиная с 0.1. В проекте должна существовать одна физически общая реализация панели управления — GameControlPanel или эквивалентный компонент с тем же архитектурным смыслом. Один и тот же компонент подключается к Torus 2D, Cube 2D, Cube 3D начиная с 0.5 и любым будущим представлениям/топологиям. Создавать отдельные TorusPanel/CubePanel/Cube2DPanel/Cube3DPanel, копировать JSX/HTML/CSS панели в renderer или поддерживать независимые версии её дизайна запрещено.  
Панель является частью общего UI/application presentation layer и находится над различиями Renderer. Она показывает общие данные и controls партии: current player, move/action number, размер поля, rules/scoringMode, komi, Black Captured/White Captured, Pass, Undo, Redo, New Game, display options и другие общие функции, которые будут добавляться позднее. Конкретный Renderer отвечает за игровое поле и renderer-specific взаимодействие, но не владеет собственной основной панелью.  
Если control неприменим к конкретному режиму, тот же GameControlPanel может скрыть его или показать предусмотренное disabled-состояние на основе capabilities текущего режима. Это не является основанием создавать другую панель. Изменение общего дизайна, порядка, размеров, typography, цветов, рамок, состояний кнопок или поведения общего control должно выполняться централизованно и автоматически применяться ко всем режимам, где этот control используется.  
Если при добавлении нового режима, функции или control выясняется, что в общей панели не хватает места, отсутствует необходимая кнопка/control, существующая структура панели не позволяет корректно разместить функцию, требования разных режимов конфликтуют либо возникает иная проблема, мешающая сохранить одну общую панель, агент/ChatGPT не имеет права молча создавать исключение, вторую панель, переносить обязательные controls за пределы панели, скрывать обязательную функцию, чрезмерно ужимать интерфейс или самостоятельно менять архитектуру панели.  
**\!\!\! ВНИМАНИЕ: ПРОБЛЕМА С ЕДИНОЙ ПАНЕЛЬЮ УПРАВЛЕНИЯ \!\!\!**  
В таком случае агент/ChatGPT обязан до реализации максимально заметно сообщить пользователю о проблеме: использовать отдельный абзац, жирный текст, восклицательные знаки, кратко описать конкретный конфликт и перечислить, какое решение требуется от пользователя. До явного решения пользователя структура общей панели не изменяется и обходной вариант не внедряется.  
Примеры команд: PlaceStone(pointId), Pass, Undo, Redo, NewGame(settings), ChangeViewMode(mode), NavigateView(direction), ChangeKomi(value), ChangeRules(ruleSet). Начиная с 0.2 экран New Game показывает выбор топологии как два равноправных selectable control с видимыми подписями «Cube» и «Torus». Рядом с «Cube» используется маленькая иконка куба, рядом с «Torus» — маленькая иконка тора/кольца, визуально читаемая как «бублик». Иконка и подпись являются одной кликабельной областью; иконки предпочтительно реализуются как лёгкие SVG и относятся только к UI/presentation.  
UI получает logical pointId от hit testing активного renderer.  
UI передаёт игровую команду в GameSession.  
UI может управлять чисто визуальными командами через presentation/view layer, но не меняет доменное состояние самостоятельно.  
UI не знает алгоритмы групп, дыханий, взятий, ko, endgame или scoring.  
Возможная реализация: React \+ TypeScript \+ Vite является базовым кандидатом. Чистый TypeScript \+ DOM допустим как техническая альтернатива, но не является причиной менять архитектурные контракты.

# 4\. GameSession

GameSession — application-level координатор одной партии и основная точка входа для игровых команд от UI.  
GameSession отвечает за:  
— принять command от UI;  
— передать доменную команду в GameAuthority или непосредственно в GameEngine в локальной реализации;  
— получить новое GameState и DomainEvents;  
— обновить History;  
— инициировать autosave через GameStorage;  
— запустить endgame после двух последовательных пасов;  
— передать финальную классификацию в выбранную ScoringStrategy;  
— сохранить FinalResult в состоянии/сессии;  
— передать актуальное состояние в PresentationModel;  
— координировать undo/redo;  
— координировать смену 2D/3D режима, не меняя GameState;  
— координировать временную блокировку input во время чисто визуальных переходов.  
GameSession не отвечает за поиск групп, подсчёт liberties, снятие групп, самоубийство, ko-алгоритм, геометрию тора/куба, рендеринг и физическое хранение данных.

# 5\. GameAuthority — шов для будущей сетевой игры

Сеть не требуется для 0.1, 0.2, 0.3 и 0.5 как функциональность. Однако GameSession не должен быть спроектирован так, будто GameEngine обязательно навсегда находится в том же браузере и всегда отвечает синхронно.  
Рекомендуемый контракт: GameAuthority.execute(command, currentContext) → authoritative result/state/events.  
Реализации:  
— LocalGameAuthority — текущая локальная реализация; внутри вызывает GameEngine.  
— RemoteGameAuthority — будущая реализация; внутри вызывает NetworkTransport и получает подтверждённое сервером состояние.  
Правило для 0.1: если отдельный GameAuthority создаёт лишнюю сложность, допускается временно не выделять его в отдельный файл/класс. Но граница GameSession → выполнение команды должна оставаться узкой и заменяемой, чтобы LocalGameAuthority можно было извлечь без переписывания UI и доменного ядра.  
UI не должен знать, local или remote партия используется.  
Будущий сетевой путь:  
UI → GameSession → RemoteGameAuthority → NetworkTransport → ServerGameSession/GameEngine → authoritative GameState → NetworkTransport → RemoteGameAuthority → GameSession → PresentationModel.  
На серверной стороне должен использоваться тот же доменный GameEngine или совместимый общий пакет доменной логики.  
Сервер в сетевой партии является авторитетным источником игрового состояния.  
NetworkTransport, login, matchmaking, reconnect, spectator mode и cloud synchronization не должны проникать в GameEngine.

# 6\. GameEngine

GameEngine — чистое доменное ядро механики ГО.  
Предпочтительная модель: command \+ state → new state \+ domain events.  
Пример контракта: applyCommand(state, command, topology, repetitionPolicy) → EngineResult.  
EngineResult содержит новое GameState либо ошибку/причину недопустимости и набор DomainEvents.  
GameEngine реализует:  
— постановку камня;  
— объединение камней в группы;  
— liberties;  
— взятия;  
— запрет самоубийства;  
— чередование игроков;  
— Pass как игровое действие;  
— счётчик последовательных пасов;  
— изменения счётчиков снятых камней;  
— move/action number;  
— формирование данных, необходимых для ko/repetition check.  
GameEngine использует только доменные зависимости, прежде всего Topology и RepetitionPolicy.  
GameEngine не использует Renderer, PresentationModel, GameStorage, localStorage/IndexedDB, React/DOM, Three.js, EndgameClassifier, ScoringStrategy или NetworkTransport.

# 7\. GameState

GameState — сериализуемое доменное состояние, достаточное для точного продолжения партии и восстановления истории.  
GameState должен содержать или однозначно позволять восстановить:  
— board occupancy по logical pointId;  
— currentPlayer;  
— board size/config;  
— rule set selection;  
— komi;  
— capture counters;  
— action/move number;  
— consecutivePasses;  
— ko/repetition-relevant state;  
— game phase/status: playing / endgame / finished;  
— данные завершения партии, если партия завершена;  
— все данные, влияющие на точное продолжение игры.  
History не обязана быть вложена внутрь одного GameState: History может хранить последовательность GameState snapshots.  
View/camera state не является обязательной частью GameState.  
DOM nodes, Three.js objects, SVG elements и другие несериализуемые визуальные объекты запрещены внутри GameState.

# 8\. Topology

Topology скрывает конкретную форму игрового мира.  
Минимальный контракт: getNeighbors(pointId) → список соседних logical pointId.  
Для текущей концепции каждая игровая точка должна иметь ровно четыре логических соседа.  
Допустимые дополнительные методы должны оставаться логическими, например getAllPoints(), validate(), получение логических board/face identifiers. Topology не должна возвращать экранные координаты или Three.js vectors как часть доменного контракта.  
Реализации:  
— TorusTopology — версия 0.1.  
— CubeTopology — версия 0.2+.  
TorusTopology: логическое поле циклически соединяется справа↔слева и сверху↔снизу; у каждой точки четыре соседа; используется для ранней проверки GameEngine.  
CubeTopology: шесть логических досок; корректные переходы через рёбра и углы; у каждой логической точки четыре соседа; группы и взятия могут пересекать границы досок; не создаёт отдельную «кубическую версию правил». Cube 2D layout является отдельной renderer-neutral моделью поверх CubeOrientation. Нормативная форма: Cube2DLayout.rows — массив 3×4 из Cube2DLayoutCell | null; заняты ровно 6 из 12 slots. Начальная раскладка использует verticalAnchorColumn \= 1: row 0 \= null, TOP, null, null; row 1 \= LEFT, CENTER, RIGHT, BACK; row 2 \= null, BOTTOM, null, null. verticalAnchorColumn является presentation-only частью Cube2D ViewState и может принимать 0–3. Клик по пустому slot в row 0 или row 2 переносит единую визуальную пару TOP/BOTTOM в выбранную колонку; CubeOrientation/CENTER и GameState при этом не меняются. Пара пересчитывает face/rotation относительно боковой доски выбранной колонки, поэтому видимые стыки остаются настоящими. Cube2DLayoutCell содержит row, column, face, rotation, isCentral и pointIds\[N\]\[N\]. Каждая CubeFace встречается ровно один раз; всего существует ровно 6 × N × N visual points. Поле/признак isDuplicate в Cube2DLayoutCell отсутствует и не должно вводиться. Начиная с 0.2 размер кубического поля является параметром N×N. CubeTopology, PointId/face-local mapping, переходы через рёбра и базовые алгоритмы не должны содержать жёсткой привязки к конкретному UI-набору размеров или отдельные реализации для 2×2, 3×3, 4×4, 5×5 и других N. Добавление нового поддерживаемого размера должно требовать только изменения конфигурации допустимых размеров/UI и соответствующих тестов, но не переписывания фундаментальной логики CubeTopology или GameEngine.  
Главный тест: если заменить TorusTopology на CubeTopology, код базовой механики GameEngine не должен переписываться.

# 9\. RepetitionPolicy

Контракт: isAllowed(historyContext, candidateState) → boolean/result.  
Реализации:  
— SimpleKoPolicy — базовая реализация обычного ko.  
— SuperkoPolicy — реализованная расширенная политика повторения; архитектура допускает выбор policy без изменения GameEngine.  
SimpleKoPolicy запрещает немедленное возвращение к позиции, существовавшей перед предыдущим ходом соперника.  
GameEngine должен делегировать проверку повторения политике, а не зашивать единственный вариант ko глубоко внутрь постановки камня.  
History предоставляет policy только необходимые данные/хэши/позиции; это не делает GameEngine владельцем History.

# 10\. History

Контракт: push(state/action), undo(), redo(), canUndo(), canRedo(), current(), при необходимости — получение минимального repetition context.  
Реализации:  
— LinearHistory — 0.1.  
LinearHistory в 0.1 поддерживает окончательную модель Undo и Redo. Отдельного этапа 0.4 с Advanced/Branching History в актуальном roadmap нет и возвращать его без нового продуктового решения нельзя. Пасы являются обычными действиями истории. Undo переносит отменённое состояние в линейное «будущее», Redo точно восстанавливает его; любое новое принятое игровое действие после Undo очищает redo-будущее. currentPlayer, captures, ko/repetition state, consecutivePasses, move/action number, last move и endgame/finished state восстанавливаются детерминированно.  
History должна восстанавливать rule-relevant state, а не только расположение камней.

# 11\. EndgameClassifier

Контракт: classify(finalPosition/context) → EndgameClassification.  
EndgameClassification должна представлять статусы групп как минимум alive, dead, seki.  
Реализации:  
— ManualEndgameClassifier — 0.1.  
— AssistedEndgameClassifier — 0.3+.  
ManualEndgameClassifier: после двух последовательных пасов пользователь вручную определяет необходимые группы; ответ пользователя является источником истины; классификатор не пытается автоматически решить спорные случаи.  
AssistedEndgameClassifier: автоматически определяет только очевидные случаи; всё недоказанное передаёт пользователю; ручной ответ остаётся окончательным fallback.  
EndgameClassifier не считает окончательные очки.

# 12\. ScoringStrategy

Контракт: calculate(position, endgameClassification, komi) → FinalScore.  
Реализации, доступные уже в 0.1:  
— ChineseScoring.  
— JapaneseScoring.  
ChineseScoring: area scoring; считает камни на доске и окружённые пустые точки; учитывает коми; снятые камни показываются как статистика и не прибавляются отдельно к area score.  
JapaneseScoring: territory scoring; использует соответствующую японским правилам формулу; получает ту же явную EndgameClassification, но интерпретирует финальную позицию в рамках своей стратегии.  
Выбор rules/scoring производится перед новой партией.  
Нельзя делать if (rules \=== japanese) по всему GameEngine. Различия, относящиеся к подсчёту, должны концентрироваться в ScoringStrategy и связанных rule policies.

# 13\. PresentationModel

PresentationModel отделяет доменное состояние от конкретного способа рисования и преобразует GameState \+ endgame/result \+ view state в семантический ViewModel.  
ViewModel может содержать:  
— камни и logical pointId;  
— current player;  
— last stone marker;  
— move numbers;  
— capture counters;  
— territory classification;  
— dead-stone visual status;  
— final result;  
— признаки допустимости/запрета хода, если они рассчитаны через application/domain query;  
— для Cube 2D — однозначные данные одной визуальной точки на одну logical PointId; для Torus 2D при включённых one-line edge strips — renderer-only данные пассивных копий.  
PresentationModel не должен принимать доменные решения и не должен изменять GameState.

# 14\. BoardRenderer и конкретные renderer

Минимальный общий контракт: render(viewModel), hitTest(pointer) → logical pointId | null, setView/viewState при необходимости.  
Конкретные реализации:  
Начиная с 0.2 Torus2DRenderer и Cube2DRenderer обязаны использовать общий BoardTheme и общие visual assets. В общий слой входят как минимум фактура/цвет доски, палитра и характер сетки, SVG-artwork чёрного и белого камня, его highlight/shadow semantics, hover-preview, last-move marker, move numbers, forbidden marker, endgame alive/dead/seki annotation и финальная territory/dead-stone визуализация. Геометрия, размеры сетки, толщина линий, расположение досок, стыки и навигация остаются renderer-specific. Cube 2D визуальных копий не создаёт; renderer-only copies существуют только в специально определённых режимах вроде Torus one-line edge strips. BoardTheme и stone SVG не входят в GameState и не должны дублироваться отдельными несовместимыми реализациями для Torus 2D и Cube 2D. Normal stone, hover-preview и captured stone обоих 2D-renderer-ов обязаны получать black/white artwork из одного shared StoneArtwork implementation; отдельные Cube/Torus или normal/capture paint definitions запрещены.  
Zoom обоих 2D-renderer-ов является исключительно ViewState и не входит в GameState. Пользовательский zoom не должен реализовываться долгоживущим compositor-layer с CSS `transform: scale()`/`scale` на корневой игровой сцене. В Cube 2D steady-state zoom меняет фактический размер 4×3 layout: базовый размер одной face cell логически равен 190, а конечный rendered cell size равен `190 × zoom`; Cube2DRenderer, пустые anchor slots и Cube2DVisualEffects используют один общий layoutCellSize. Корневая Cube stage в steady state не имеет scale-transform; `will-change: transform` допустим только на время 260-ms navigation/anchor transition и удаляется вместе с transition state. В Torus 2D пользовательский zoom и size-specific edge fit образуют SVG/vector camera через root `viewBox` или эквивалентную внутреннюю SVG camera; корневой SVG не compositor-scale-ится. Hit-testing преобразует pointer через текущую vector camera обратно в стабильные logical scene coordinates, а renderer redraw не имеет права сбрасывать application-owned camera.  
— Torus2DRenderer — 0.1.  
— Cube2DRenderer — 0.2+.  
— Cube3DRenderer — 0.5+.  
Torus2DRenderer — основной renderer версии 0.1 для полей 9×9, 13×13 и 19×19. Он сохраняет обычный видимый указатель мыши и при наведении на допустимую точку показывает привязанный к пересечению полупрозрачный (50%) preview полноценного камня текущего цвета с тем же SVG-artwork, что и установленный камень. Для недопустимой точки красный marker привязывается точно к запрещённому пересечению. Навигация стрелками физически и плавно сдвигает сетку и камни с циклическим wrap примерно за 240 мс. Опциональные duplicate regions в Torus 2D — только одна пунктирная неинтерактивная обёрнутая строка/колонка у каждого края; это renderer-only overlay без hit targets, а копии камней отображаются приглушённо примерно с 50% opacity.  
Cube2DRenderer:  
— использует тот же BoardTheme, board texture/color, black/white stone SVG и общий визуальный язык игровых маркеров, что и утверждённый Torus 2D; отдельный дизайн камней или досок для Cube 2D не создаётся;  
— нормативная раскладка — 4×3 slots с ровно шестью занятыми cells и шестью null. Начальное состояние: row 0 \= null/TOP/null/null; row 1 \= LEFT/CENTER/RIGHT/BACK; row 2 \= null/BOTTOM/null/null. TOP/BOTTOM образуют переносимую только в presentation-слое вертикальную пару: пользователь кликает по пустому slot сверху или снизу нужной боковой колонки, slot подсвечивается тонкой пунктирной рамкой, а пара вместе переезжает в эту колонку. Выбранный verticalAnchorColumn хранится во ViewState, не меняет CubeOrientation, CENTER или GameState; face/rotation пары определяются Cube2DLayout относительно side-ring доски выбранной колонки;  
— moveLeft()/moveRight() реализуют бесконечную горизонтальную галерею: четыре боковые грани циклически сдвигаются на одну позицию, крайняя уходит за один край, а соответствующая грань того же четырёхгранного цикла входит с противоположного; CENTER становится соседняя боковая грань. После завершения перехода в layout снова ровно четыре уникальные боковые грани плюс TOP/BOTTOM. moveUp()/moveDown() делают текущую TOP/BOTTOM новой CENTER и пересобирают крест через CubeOrientation;  
— при горизонтальном gallery shift порядок боковых граней меняется циклически, а TOP/BOTTOM и необходимые rotation обновляются согласно новой CENTER; при вертикальной пересборке доски могут плоско поворачиваться кратно 90°, при этом новая центральная доска сохраняет понятную ориентацию;  
— в каждом стабильном интерактивном состоянии каждая logical point куба отображается ровно одним VisualPoint в одной из шести занятых ячеек; duplicate boards, duplicate cells и duplicate hit targets как постоянная модель Cube 2D запрещены; временный animation-only clone для бесшовного горизонтального wrap не считается VisualPoint layout и не участвует в input;  
— hover и hit-testing работают только с единственным стабильным VisualPoint logical point; animation-only clone горизонтальной галереи всегда non-interactive и не требует синхронизации input;  
— 2D grid визуально ортогональная квадратная;  
— visual layout, бесконечный horizontal gallery shift, vertical rebuild, zoom и animation-only transition elements являются renderer/ViewState concern и не меняют GameState; постоянное дублирование CubeFace/PointId в Cube 2D запрещено.  
Cube3DRenderer:  
— 3D-куб с шестью игровыми гранями;  
— rotation, zoom, reset view;  
— hit testing/picking переводит курсор в logical pointId;  
— навигационные кнопки поворачивают к соседней фронтальной грани;  
— renderer не решает допустимость хода;  
— основной технологический кандидат — Three.js;  
— Babylon.js допустим как альтернатива;  
— собственный WebGL-движок не писать без отдельной причины.  
Переключение Cube2DRenderer ↔ Cube3DRenderer:  
— GameState остаётся неизменным;  
— центральная доска 2D и наиболее фронтальная грань 3D являются ориентационным якорем;  
— масштаб/камера относятся к view state, а не к доменному состоянию;  
— полная стартовая 3D-анимация выполняется только при новой партии, не при обычном переключении.

# 15\. Animation / Effects

Animation получает DomainEvents/ViewEvents и создаёт визуальный эффект.  
Примеры: stonePlaced, stonesCaptured, cubeLayoutTransition, torusShift, viewModeChanged, startGameCubeAppearance.  
Правила:  
— доменное изменение применяется сразу;  
— анимация не является источником истины;  
— анимация снятия не определяет порядок логического снятия;  
— при нескольких снятых камнях визуальные старты сдвигаются примерно на 150 мс;  
— в Torus 2D снятые белые камни летят преимущественно влево, снятые чёрные — вправо, независимо от расположения UI-панелей; допускается небольшой уклон вверх;  
— интерактивная основная копия снятого камня получает полёт, визуальные edge-duplicates только быстро затухают;  
— обычная постановка камня получает короткую мягкую animation около 100 мс без изменения момента доменного хода;  
— в Cube 2D каждый логический камень имеет ровно одно визуальное представление; анимация снятия применяется к этому единственному камню, без дополнительного исчезновения дублей;  
— Cube 2D capture строится только из snapshot предыдущей реально отрисованной сцены, снятого до применения нового визуального состояния. Для каждой captured PointId snapshot содержит как минимум color, исходную CubeFace, прежний 4×3 layout row/column, локальные face x/y, stage-space x/y и порядок. После удаления камня запрещено заново искать PointId в новом layout и использовать эту новую экранную позицию как источник полёта;  
— все снимаемые Cube 2D stones рендерятся в единой coordinate system всей 4×3 stage, предпочтительно отдельным stage-level SVG capture layer. В `t=0` captured stone обязан иметь тот же shared StoneArtwork, размер, центр и shadow semantics, что normal stone; capture-only flat fill или stroke запрещены. До окончания собственного stagger-delay координата не меняется. White летит за левую границу stage, Black — за правую; target и траектория вычисляются в stage/SVG units, допускается небольшой уклон вверх;  
— Undo/Redo и renderer-only navigation не должны сами по себе создавать ложную capture animation; один captured PointId получает ровно один capture effect;  
— во время cubeLayoutTransition, torusShift или 2D↔3D transition UI может временно блокировать игровые клики;  
— после завершения визуального перехода input снова разрешается.

# 16\. GameStorage

Контракт: save(serializableGame), load(), clear().  
GameSession зависит от GameStorage, а не от browser API напрямую.  
Реализации:  
— LocalStorageGameStorage — простой кандидат для 0.1 и одной текущей партии.  
— IndexedDbGameStorage — допустимая локальная альтернатива, если история станет слишком объёмной.  
— Будущее серверное сохранение может быть реализовано отдельным Remote/Cloud storage adapter, но это не должно смешиваться с NetworkTransport игровой партии.  
Сохранять минимум: GameState, полную требуемую историю, выбранный размер, rule set, komi, captured stones, ko/repetition data, consecutive passes и данные, нужные для точного продолжения.  
Не обязательно сохранять точный режим 2D/3D, ракурс, текущую CubeOrientation/Cube2DLayout и zoom, если отдельная задача не делает это обязательным.

# 17\. NetworkTransport — future only

NetworkTransport не требуется для локальных версий 0.x.  
Будущий контракт может включать sendCommand(command), subscribeState(), connect/reconnect(), session/join operations.  
NetworkTransport используется RemoteGameAuthority, а не GameEngine.  
UI не должен обращаться к WebSocket/HTTP напрямую для игровых ходов.  
GameEngine не должен содержать socket callbacks или remote-specific branches.  
В сетевой партии подтверждённое сервером состояние имеет приоритет над локальным предположением клиента.

# 18\. Поток обычного допустимого хода

1\) Пользователь наводит курсор.  
2\) Активный Renderer выполняет hitTest и получает logical pointId.  
3\) UI создаёт PlaceStone(pointId).  
4\) UI передаёт command в GameSession.  
5\) GameSession передаёт command в LocalGameAuthority/GameEngine.  
6\) GameEngine через Topology получает соседей.  
7\) GameEngine рассчитывает группы/liberties/captures.  
8\) GameEngine проверяет suicide.  
9\) GameEngine через RepetitionPolicy проверяет ko/repetition.  
10\) При допустимом ходе создаётся новое GameState.  
11\) GameEngine возвращает GameState \+ DomainEvents.  
12\) GameSession добавляет состояние в History.  
13\) GameSession запускает GameStorage.save.  
14\) GameSession передаёт новое состояние в PresentationModel.  
15\) PresentationModel строит ViewModel.  
16\) Renderer отображает новый ViewModel.  
17\) Animation проигрывает визуальные эффекты событий.  
18\) UI сразу показывает следующего игрока согласно новому GameState.

# 19\. Поток недопустимого хода

1\) Renderer возвращает logical pointId.  
2\) UI/GameSession выполняет query/command проверки.  
3\) GameEngine/validator возвращает invalid result с машинной причиной.  
4\) GameState не меняется.  
5\) History не получает новый state.  
6\) GameStorage не сохраняет новый игровой state.  
7\) Renderer показывает визуальный признак запрещённого хода.  
8\) В Cube 2D красный marker показывается на единственном visual point соответствующей PointId; в Torus 2D passive edge duplicates не имеют hit targets и собственного forbidden hover.

# 20\. Поток Pass и завершения партии

Один Pass: UI → GameSession → GameEngine. GameEngine фиксирует Pass как игровое действие, увеличивает action number, меняет currentPlayer и consecutivePasses. GameSession сохраняет результат в History и GameStorage.  
После первого Pass UI меняет подпись кнопки на «Pass (1)» и примерно на 1 секунду блокирует только повторное нажатие Pass. Отдельные progress/countdown и текст «Previous pass» не показываются. Обычный ход следующего игрока доступен сразу; такой ход сбрасывает consecutivePasses, возвращает подпись «Pass» и прекращает действие защиты.  
Два последовательных Pass:  
GameEngine возвращает состояние с условием окончания основной фазы.  
GameSession запускает EndgameClassifier.  
В 0.1 используется ManualEndgameClassifier.  
Полученная EndgameClassification передаётся выбранной ScoringStrategy.  
ScoringStrategy создаёт FinalScore.  
GameSession фиксирует finished/final result.  
PresentationModel показывает территорию, dead stones и окно результата.  
Новые игровые ходы блокируются; навигация/просмотр 2D/3D остаются разрешены.  
Undo после завершения: GameSession отменяет второй Pass через History; finished/endgame result удаляется, первый Pass остаётся, доска снова принимает ходы, а временная защита Pass не восстанавливается. Redo после такого Undo повторно применяет отменённый второй Pass и возвращает соответствующее endgame/finished state, если пользователь не сделал нового игрового действия.

# 21\. Поток Undo и Redo

UI → GameSession.undo/redo.  
GameSession получает точный GameState от History.  
Это состояние становится текущим authoritative state локальной сессии.  
GameSession сохраняет восстановленное состояние при необходимости.  
PresentationModel и Renderer получают восстановленный state.  
currentPlayer, captures, move numbers, ko, passes, last move marker и прочие rule-relevant данные должны совпасть с восстановленным history state.  
Renderer не реконструирует прошлое самостоятельно.

# 22\. Поток переключения 2D ↔ 3D

Этот поток вводится только в версии 0.5. В версиях 0.2–0.3 Cube использует только Cube2DRenderer; наличие архитектурного контракта 2D ↔ 3D не является разрешением реализовывать Cube 3D раньше 0.5. UI просит сменить view mode.  
GameSession/presentation layer не изменяют GameState.  
Сохраняется/преобразуется только ViewState и orientation anchor.  
3D → 2D: наиболее обращённая к камере грань становится центральной доской 2D без произвольного поворота.  
2D → 3D: центральная доска становится фронтальной гранью куба с сохранением ориентации.  
PresentationModel строит данные для нового renderer.  
Во время transition игровой input блокируется; после transition input включается.  
GameEngine, History, Scoring и Storage не должны замечать факт переключения renderer.

# 23\. Направления зависимостей

Разрешённые основные зависимости:  
UI → GameSession.  
GameSession → GameAuthority или локальный command execution boundary.  
LocalGameAuthority → GameEngine.  
GameEngine → Topology.  
GameEngine → RepetitionPolicy.  
GameSession → History.  
GameSession → GameStorage.  
GameSession → EndgameClassifier.  
GameSession/endgame flow → ScoringStrategy.  
GameSession/GameState → PresentationModel.  
PresentationModel → Renderer2D/Renderer3D.  
Renderer → Animation/Effects.  
RemoteGameAuthority → NetworkTransport в будущем.

Запрещённые зависимости:  
UI → GameEngine напрямую.  
Renderer → GameEngine для изменения состояния.  
GameEngine → Renderer.  
GameEngine → GameStorage.  
GameEngine → NetworkTransport.  
Topology → Renderer.  
ScoringStrategy → Renderer.  
EndgameClassifier → Renderer.  
GameStorage → GameEngine.  
Animation → изменение GameState.

# 24\. Композиция по версиям

Версия 0.1:  
UI; GameSession; опционально тонкий LocalGameAuthority; GameEngine; TorusTopology; RepetitionPolicy с SimpleKoPolicy/SuperkoPolicy; ChineseScoring; JapaneseScoring; ManualEndgameClassifier; LinearHistory с Undo/Redo; Torus2DRenderer; PresentationModel; GameStorage с LocalStorageGameStorage или эквивалентным простым локальным adapter; автотесты GameEngine и сценарные тесты полной партии.  
Версия 0.2:  
GameEngine не переписывается; TorusTopology дополняется параметризованной CubeTopology(N); CubeOrientation остаётся renderer-neutral источником ориентации; Cube2DLayout представляет 12 screen slots с ровно 6 Cube2DLayoutCell и 6 null, без isDuplicate; presentation-only verticalAnchorColumn 0–3 определяет, в какой колонке верхней/нижней строки находится единая пара TOP/BOTTOM, и может меняться кликом по пустому layout slot без изменения CubeOrientation или GameState. Добавляется Cube2DRenderer, который в стабильном состоянии рисует только шесть уникальных SVG-досок и ровно 6 × N × N visual points; пустые anchor-slots могут быть UI-controls перестройки layout, но не имеют logical PointId и не принимают игровые ходы. Cube2DRenderer подключается к общему с Torus 2D BoardTheme и shared visual assets; в New Game появляются selectable controls «Cube» и «Torus» с маленькими SVG-иконками. Конкретный список Cube-размеров остаётся UI-конфигурацией. Актуальная последовательность: 01.01 CubeTopology не меняется; 01.02.1 исправляет Cube2DLayout, сохраняя CubeOrientation и rotation; 01.03 строит renderer заново поверх исправленного layout; 01.04 добавляет навигацию: moveLeft()/moveRight() — бесконечная циклическая gallery-анимация четырёх боковых граней, moveUp()/moveDown() — смена CENTER через TOP/BOTTOM и пересборка креста. Animation-only clone для бесшовного горизонтального wrap допустим только как временный неинтерактивный renderer-элемент вне Cube2DLayout.  
Версия 0.3:  
ManualEndgameClassifier сохраняется как обязательный fallback; добавляется AssistedEndgameClassifier, который автоматически принимает только очевидные alive/dead/seki и передаёт всё недоказанное пользователю. ScoringStrategy и GameEngine не переписываются. Это единственный нормативный смысл версии 0.3; Cube3DRenderer в 0.3 не входит.  
Версия 0.5:  
CubeTopology остаётся; добавляется Cube3DRenderer и orientation bridge Cube 2D ↔ Cube 3D. GameState, GameEngine, scoring, endgame и окончательная линейная история Undo/Redo остаются общими; 3D library выбирается после отдельного Library/Reuse Review, базовый кандидат — Three.js/экосистема.  
Future online:  
добавляется RemoteGameAuthority; NetworkTransport; server-side GameSession/GameEngine; login/matchmaking/reconnect/cloud persistence отдельно от domain core.

# 25\. Тестовые границы

GameEngine tests: группы, liberties, captures, suicide, pass, turn switching, move/action numbering, integration с RepetitionPolicy.  
Topology tests: у каждой точки ровно четыре соседа; симметрия/корректность соседств; Torus wrap; Cube edges; Cube corners; группы и взятия через стыки. Для CubeTopology тесты запускаются на нескольких N, включая чётные и нечётные размеры и как минимум один технический размер, не представленный в текущем UI-наборе, чтобы доказать отсутствие hardcode под конкретные кнопки размеров.  
Scoring tests: ChineseScoring и JapaneseScoring на одной и той же классифицированной позиции; komi; dead/alive/seki; нейтральная территория; captures не добавляются ошибочно в Chinese area score.  
History tests: undo/redo stone; undo/redo pass; canUndo/canRedo; восстановление currentPlayer; ko/repetition state; captures; consecutivePasses; undo/redo second pass around endgame/finish; очистка redo-будущего новым действием.  
Renderer contract tests: renderer не создаёт собственную игровую истину; hitTest возвращает logical pointId. Для Cube 2D обязательно проверяются: в каждом стабильном состоянии матрица layout ровно 3×4; ровно 6 непустых cells и 6 null; каждая CubeFace присутствует ровно один раз; каждая logical PointId имеет ровно одно игровое визуальное представление; общее число стабильных visual points равно 6 × N × N; rotation приходит из Cube2DLayout/CubeOrientation и не вычисляется renderer-ом. Дополнительно для verticalAnchorColumn \= 0/1/2/3 проверяется перенос TOP/BOTTOM кликом по пустым slots: обе доски переезжают вместе, пустой slot получает только layout-control interaction, не logical PointId/stone hit target, CubeOrientation и GameState не меняются, а уникальность шести CubeFace и корректность стыков сохраняются. Отдельно проверяется бесконечная горизонтальная галерея: повторные moveLeft()/moveRight() циклически переставляют четыре боковые грани без накопления дублей; временный animation-only clone, если используется для wrap, не входит в layout, не участвует в hitTest и исчезает после transition. Отдельно проверяется совместимость shared BoardTheme и единственного StoneArtwork. Для Cube zoom автоматически проверяются 0.78/1.0/1.35: steady root stage не имеет CSS scale, неподвижные boards не имеют постоянного `will-change`, hit-testing и anchor/navigation сохраняют тот же PointId. Для Torus zoom автоматически проверяются 0.7/1.0/1.5/2.5: root SVG использует vector camera, а не compositor scale, и hit-testing остаётся согласованным с camera. Для Cube capture проверяются previous-rendered-scene source coordinates, white→left/black→right, stagger 0/150/300…, отсутствие flat fallback artwork, одна animation на PointId, отсутствие ложной capture при Undo/Redo, все verticalAnchorColumn и направления navigation, несколько Cube sizes и zoom 0.78/1.0/1.35. Browser regression сравнивает normal stone с первым кадром capture с допуском центра не более 0.5 CSS px; visual screenshots выполняются как минимум при DPR 1 и DPR 1.5. Для Torus 2D renderer-only edge duplicates тестируются отдельно.  
Persistence tests: serialize → save → load → exact rule-relevant state restoration. Storage implementation можно заменить без изменения GameSession API.  
Network-readiness tests после появления сети: одни и те же commands применимы к LocalGameAuthority и RemoteGameAuthority; UI не зависит от network API; серверный state authoritative.

# 26\. Архитектурные анти-паттерны

Нельзя:  
— вписывать Cube-specific if/else в GameEngine;  
— хранить visual duplicates как отдельные игровые камни;  
— использовать координаты экрана как идентификатор игровой точки;  
— зашивать ChineseScoring в общую механику;  
— автоматически определять dead/alive внутри ScoringStrategy;  
— читать localStorage из GameEngine;  
— вызывать Three.js из Topology;  
— заставлять Renderer менять captures/currentPlayer/history;  
— делать animation callback источником момента фактического хода;  
— масштабировать steady-state 2D scene как долгоживущую compositor bitmap через root CSS scale вместо renderer/vector camera;  
— поддерживать независимые black/white stone artwork для Cube/Torus или normal/captured states;  
— после capture вычислять исходную позицию камня из уже перестроенного нового Cube2DLayout вместо snapshot предыдущей rendered scene;  
— размазывать сетевые проверки по UI и GameEngine;  
— создавать отдельный GameState для 2D и отдельный для 3D;  
— создавать отдельный GameEngine для Torus и Cube;  
— терять rule-relevant данные при undo/restore.

# 27\. Правила принятия архитектурных решений во время разработки

Перед добавлением новой функции определить:  
1\) Это доменная логика, orchestration, presentation, renderer, persistence или infrastructure?  
2\) Какой модуль должен быть единственным владельцем этой ответственности?  
3\) Нужна ли сменная реализация сейчас или в уже запланированной версии?  
4\) Существует ли подходящий интерфейс?  
5\) Если нет, действительно ли нужен новый интерфейс, или изменение локально для одного модуля?  
6\) Не создаёт ли изменение обратную зависимость от инфраструктуры к domain core?  
7\) Можно ли протестировать новую логику без браузера/Three.js?  
8\) Можно ли заменить TorusTopology на CubeTopology без изменения этой логики?  
9\) Можно ли заменить LocalStorageGameStorage на IndexedDbGameStorage без изменения этой логики?  
10\) Можно ли в будущем заменить local command execution на RemoteGameAuthority без изменения UI?  
11\) Сохраняется ли один authoritative GameState?  
12\) Не дублируется ли правило в нескольких слоях?  
Если ответ показывает нарушение границы, сначала исправить архитектуру или ввести узкий adapter/contract, затем писать функцию.

# 28\. Минимальная ментальная модель для агента

При любой задаче считать систему следующей цепочкой:  
Пользователь создаёт intent в UI.  
GameSession координирует.  
GameAuthority определяет, где исполняется команда: локально или в будущем удалённо.  
GameEngine решает, что произошло по правилам.  
Topology сообщает, кто сосед.  
RepetitionPolicy решает допустимость повторения.  
GameState является источником истины о партии.  
History хранит и восстанавливает GameState.  
EndgameClassifier классифицирует финальные группы.  
ScoringStrategy считает очки.  
PresentationModel переводит состояние в данные для показа.  
Renderer показывает эти данные в 2D или 3D и переводит pointer обратно в logical pointId.  
Animation визуализирует события, не изменяя правил.  
GameStorage сохраняет сериализованную партию.  
NetworkTransport в будущем только переносит commands/state между клиентом и сервером и не входит в domain core.

Главный критерий качества архитектуры:  
при переходе Torus 2D (0.1) → Cube 2D (0.2) → assisted endgame (0.3) → Cube 3D (0.5) → online должны меняться или добавляться только соответствующие реализации и адаптеры, а уже проверенные независимые модули не должны переписываться без необходимости. Версия 0.4 в текущем roadmap не используется.  
