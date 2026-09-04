# Game Cube Go — roadmap

## Назначение и границы документа

`ROADMAP.md` — единственный канонический источник порядка разработки, границ версий, milestones, checkpoints и последовательности внедрения функций.

Он отвечает только на вопросы **когда** появляется функция и **в каком порядке** выполняется работа.

- Подробное пользовательское поведение и визуальные требования находятся только в `docs/GAME_CUBE_GO.md`.
- Архитектура, контракты, state boundaries, зависимости модулей, persistence/testing architecture и library policy находятся только в `docs/ARCHITECTURE.md`.
- Если для понимания пункта roadmap нужны детали реализации или UX, этот документ ссылается на соответствующий канонический документ, но не копирует его содержимое.
- Один и тот же нормативный факт не должен иметь вторую копию в этом документе.

## Нормативный порядок версий

Текущий порядок:

**0.1 Torus 2D → 0.2 Cube 2D → 0.3 Automatic/Assisted alive-dead-seki → 0.5 Cube 3D**

Версия **0.4 сознательно не используется**. Прежний этап Advanced/Branching History удалён из roadmap; линейные Undo/Redo входят уже в 0.1 и остаются текущей пользовательской моделью истории.

Старая схема «0.3 = Cube 3D» отменена. Cube 3D появляется только в 0.5.

3D Torus не входит в 0.1, 0.2, 0.3 или 0.5 и остаётся отдельной будущей возможностью без назначенного номера версии.

## Обязательное правило принятия версий

Для **любой** нумерованной версии выполнение всех checkpoints, успешный automated regression/acceptance gate и зелёный CI означают только, что версия **технически готова к пользовательской приёмке**. Они сами по себе не означают, что версия принята, завершена как релиз или разрешена к публикации.

После технической готовности версия проходит пользовательскую/UAT-проверку владельцем проекта. Во время этой проверки могут появляться дополнительные исправления, UX-правки и release-blocking изменения. Они выполняются внутри acceptance-цикла этой же версии, после чего повторяются необходимые проверки и полный финальный CI. Такой цикл может повторяться столько раз, сколько потребуется.

**Ни один агент, CI, PR, merge, automated acceptance suite или отсутствие известных дефектов не может самостоятельно объявить версию принятой. Версия считается принятой только после явного подтверждения пользователя — владельца проекта.** Агент может сообщить, что все технические gates пройдены, и предложить принять версию, но обязан дождаться явного решения пользователя.

Пока пользователь явно не подтвердил принятие:

- статус версии должен оставаться `технически готова к приёмке` / `в пользовательской приёмке`, а не `принята`;
- дополнительные пользовательские правки до релиза остаются частью acceptance-цикла текущей версии и не требуют искусственного добавления нового roadmap checkpoint, если не меняется сам version scope;
- tag и GitHub Release этой версии не создаются.

Это правило применяется к 0.3 и ко всем текущим и будущим версиям без исключений.

## Текущий статус

Версия **0.2 Cube 2D завершена и принята** по границе `0.2 integration / regression acceptance`.

Активная разрабатываемая версия — **0.3 Automatic/Assisted alive-dead-seki**. Checkpoints **0.3.01 Library/Reuse Review и contract alignment**, **0.3.02 Deterministic Endgame Test Infrastructure**, **0.3.03 Differential Oracle Infrastructure**, **0.3.04 Automatic Alive core**, **0.3.05 Automatic Dead core**, **0.3.06 Obvious/Proven Seki**, **0.3.07 Assisted Review Integration** и **0.3.08 Stress / Differential Hardening** завершены. Следующий активный checkpoint — **0.3 integration / regression acceptance**.

Независимо от нумерованной release-sequence, перед дальнейшим AlphaZero training выполняется первый обязательный этап постоянной cross-version development infrastructure: **Developer Workspace foundation + AlphaZero game replay**. Он не меняет границы уже принятых 0.1/0.2 и не перенумеровывает 0.3/0.5.

---

# Cross-version Development Infrastructure

Development Workspace является постоянной инфраструктурой разработки, которая развивается рядом с нумерованными пользовательскими версиями и не считается отдельной пользовательской release-version.

Нормативный порядок AlphaZero-интеграции начинается с:

1. **Developer Workspace foundation + AlphaZero game replay** — подключить текущие AlphaZero checkpoints и реальный replay через существующий GoCube gameplay/rendering path до продолжения обучения;
2. последующие AlphaZero diagnostics/training integrations планируются только после того, как первый этап даёт визуальный и compatibility feedback loop.

Конкретный UX Development Workspace определяет `docs/GAME_CUBE_GO.md`, а application/infrastructure boundaries — `docs/ARCHITECTURE.md`.

---

# Версия 0.1 — Torus 2D

## Цель

Получить первую полностью играбельную локальную версию: полноценная партия от первого хода до финального результата на Torus 2D.

## Scope

В 0.1 появляются:

- Torus 2D как единственная topology и единственное игровое представление;
- размеры Torus 9×9, 13×13 и 19×19;
- базовая механика Go;
- Japanese и Chinese scoring;
- komi;
- Pass и завершение основной фазы двумя последовательными пасами;
- ручная классификация alive/dead/seki;
- финальный подсчёт и отображение результата;
- линейные Undo и Redo;
- локальное сохранение и продолжение текущей партии;
- базовый законченный игровой UI;
- Torus 2D navigation, zoom, pan, hover/forbidden interaction и duplicate-edge display option;
- пользовательские анимации постановки и снятия камней;
- единая основа тестирования доменного ядра, topology, history и persistence;
- архитектурные основы, необходимые последующим версиям, согласно `docs/ARCHITECTURE.md`.

## Не входит

- CubeTopology и Cube 2D;
- любой Cube 3D;
- автоматическая/assisted классификация alive/dead/seki;
- 3D Torus;
- online multiplayer, аккаунты и серверная инфраструктура.

## Критерий готовности

0.1 достигает технической готовности к пользовательской приёмке, когда полная партия на Torus 2D стабильно проходит от New Game до финального результата в обоих scoring modes, Undo/Redo и persistence работают через полный жизненный цикл партии, а автоматические проверки 0.1 проходят без известных correctness-регрессий. Фактическое принятие версии подчиняется общему обязательному правилу принятия версий выше.

---

# Версия 0.2 — Cube 2D

## Цель

Добавить CubeTopology и полноценное Cube 2D-представление рядом с уже работающим Torus 2D без создания отдельной версии базовых правил Go.

## Scope

В 0.2 появляются:

- CubeTopology;
- Cube 2D;
- выбор topology `Cube / Torus` при создании новой партии;
- новая Cube-партия стартует в Cube 2D; Cube 3D ещё отсутствует;
- Torus продолжает использовать Torus 2D;
- пользовательский набор размеров Cube 2D;
- Cube 2D layout и orientation model;
- Cube 2D navigation и ViewState;
- Cube 2D zoom и pan;
- повторное использование общей панели управления и общего 2D visual language;
- Cube-specific topology/layout/renderer regression coverage;
- сохранение полной совместимости существующей Torus 2D игры.

Точные правила Cube 2D layout, navigation, empty-slot interaction, visual behavior и supported UI sizes определяет только `docs/GAME_CUBE_GO.md`. Технические контракты CubeTopology, CubeOrientation, Cube2DLayout, renderer-neutral mapping и tests определяет только `docs/ARCHITECTURE.md`.

## Внутренний порядок 0.2

Последовательность checkpoints является нормативной:

1. **01.01 — CubeTopology**
2. **01.02.1 — Cube2DLayout**
3. **01.03 — Cube2DRenderer**
4. **01.04 — Cube 2D Navigation и ViewState**
5. **0.2 integration / regression acceptance**

Содержание каждого checkpoint уточняется по текущим `GAME_CUBE_GO.md` и `ARCHITECTURE.md`; roadmap не дублирует их требования.

## Критерий готовности

0.2 достигает технической готовности к пользовательской приёмке, когда полноценную партию можно сыграть на Cube 2D, Cube-specific automated coverage проходит, а существующая Torus 2D функциональность остаётся без correctness-регрессий. Фактическое принятие версии подчиняется общему обязательному правилу принятия версий выше.

---

# Версия 0.3 — Automatic/Assisted alive-dead-seki

## Цель

Сократить ручную работу при финальном разборе, автоматически определяя только те статусы, которые система может доказать достаточно надёжно, и сохраняя полноценный ручной fallback для всего недоказанного.

Главный приоритет 0.3 — **correctness выше процента автоматизации**. Неполная автоматическая классификация с `unresolved` предпочтительнее уверенной, но ошибочной автоматической маркировки.

## Scope

В 0.3 появляются:

- automatic/assisted classification очевидных или доказуемых alive/dead/seki;
- работа классификатора как с TorusTopology, так и с CubeTopology через общий topology-neutral contract;
- ручной fallback для недоказанных или спорных случаев;
- deterministic test-only fixtures и seeded generators для массовой автоматической проверки endgame logic;
- test-only differential/oracle validation infrastructure для применимых позиций;
- regression/fixture/property/stress coverage endgame-classification для обеих topology.

Внутренний пользовательский/developer Test Case/Test Lab runtime, Test ID, live/corpus generators, replay старых generator IDs и локальный KataGo bridge не входят в scope 0.3. Это ограничение не запрещает отдельный постоянный cross-version Development Workspace и AlphaZero game replay, введённые соответствующим infrastructure stage выше.

Cube 3D в 0.3 не входит. Cube-партии по-прежнему стартуют и играются в Cube 2D; Torus остаётся 2D.

Точные classifier contracts, test-only fixture generators, oracle adapters и правила differential validation определяет только `docs/ARCHITECTURE.md`. Пользовательское поведение assisted/manual review определяет только `docs/GAME_CUBE_GO.md`.

## Внутренний порядок 0.3

Последовательность checkpoints является нормативной. Следующий classifier checkpoint не начинается, пока предыдущая test/verification boundary не стала воспроизводимой и автоматизируемой.

1. **0.3.01 — Library/Reuse Review и contract alignment**
   - завершить reuse review кандидатов для alive/dead/seki и test oracles;
   - привести фактический endgame flow к proposal/review boundary с возможностью `unresolved`, не меняя scoring formula и не привязывая classifier к конкретному UI.

2. **0.3.02 — Deterministic Endgame Test Infrastructure**
   - создать воспроизводимые test-only generators legal game/endgame fixtures;
   - создать test-only generator небольших life-and-death/seki patterns;
   - добавить topology-stress fixtures для Torus seams и Cube edges/corners;
   - автоматические generated fixtures обязаны быть воспроизводимы по seed/fixture metadata без runtime Test ID или пользовательского replay UI.

3. **0.3.03 — Differential Oracle Infrastructure**
   - подключить независимые test-only reference/oracle abstractions для тех классов позиций, где сравнение корректно;
   - differential checks не входят в production correctness chain;
   - интерактивный Local KataGo bridge и внешний corpus runtime не являются частью classifier architecture.

4. **0.3.04 — Automatic Alive core**
   - сначала реализовать консервативное доказуемое определение живых/pass-alive групп;
   - проверить одинаковую topology-neutral работу на Torus и Cube.

5. **0.3.05 — Automatic Dead core**
   - добавить candidate generation и строгую verification boundary для dead;
   - недоказанный candidate остаётся `unresolved`, а не превращается в автоматический `dead`.

6. **0.3.06 — Obvious/Proven Seki**
   - автоматически resolve только те seki cases, которые проходят выбранный строгий criterion;
   - сложные, спорные и topology-sensitive случаи остаются `unresolved`.

7. **0.3.07 — Assisted Review Integration**
   - интегрировать automatic proposal с сохраняемым ручным review;
   - автоматически определённые группы предварительно заполнены, а ручная работа требуется только для unresolved;
   - визуальная полировка и конкретная форма controls выполняются после стабилизации classifier core и не должны менять classifier contracts.

8. **0.3.08 — Stress / Differential Hardening**
   - массовые deterministic прогоны test-only generated fixtures;
   - fixed-seed regression fixtures для всех найденных дефектов;
   - differential checks на применимых planar/Torus/Cube-reference cases;
   - отдельные проверки отсутствия ложных automatic resolutions и invariance итогового scoring после полного review.

9. **0.3 integration / regression acceptance**
   - полный automated regression/acceptance gate переводит 0.3 только в статус технической готовности к пользовательской приёмке;
   - затем выполняется ручная пользовательская/UAT-проверка, исправления по её результатам и повторный финальный CI;
   - checkpoint закрывается окончательным принятием версии только после явного подтверждения пользователя согласно общему правилу принятия версий.

## Критерий готовности

0.3 достигает технической готовности к пользовательской приёмке, когда:

- automatic assistance корректно работает на обеих topology через общий classifier boundary;
- нет известных случаев, где classifier автоматически присваивает недоказанный/ошибочный статус в acceptance fixtures;
- всё, что classifier не может доказать, остаётся `unresolved` и полностью разрешается ручным fallback;
- test-only generated/fixed fixtures и stress/differential checks воспроизводимы по seed;
- authoritative production gameplay и final scoring не зависят от Test Case/Test ID/generator/corpus/KataGo tooling или внешнего AlphaZero service; наличие отдельного Development Workspace не меняет этот invariant;
- assisted flow не создаёт расхождений в итоговом scoring относительно того же полного набора resolved statuses;
- полный regression/acceptance gate версии проходит.

После выполнения этих технических критериев версия остаётся в пользовательской приёмке до явного подтверждения пользователя; только после него 0.3 считается принятой и может быть выпущена.

---

# Версия 0.5 — Cube 3D

## Цель

Добавить полноценное 3D-представление уже работающей Cube Go без изменения правил партии и без отдельной 3D-версии доменного состояния.

## Scope

В 0.5 появляются:

- Cube 3D renderer;
- после появления Cube 3D topology `Cube` становится default topology при открытии New Game; до 0.5 обязательного default `Cube` нет;
- новая Cube-партия по умолчанию стартует в Cube 3D;
- свободное переключение Cube 2D ↔ Cube 3D в рамках одной Cube-партии;
- Torus в текущем roadmap остаётся только Torus 2D;
- 3D input, rotation, zoom и picking;
- отображение полного текущего игрового состояния в 3D;
- сохранение пространственного orientation anchor между представлениями;
- feature parity основных игровых и endgame-визуализаций Cube 2D/Cube 3D;
- 3D-specific automated/visual regression coverage.

Точное 3D-поведение и пользовательская семантика default topology определяются `docs/GAME_CUBE_GO.md`; техническую границу Renderer3D и spatial mapping определяет только `docs/ARCHITECTURE.md`.

## Внутренний порядок 0.5

Порядок реализации:

1. renderer core;
2. hit-testing/input;
3. feature parity with Cube 2D;
4. polish;
5. release acceptance.

## Критерий готовности

0.5 достигает технической готовности к пользовательской приёмке, когда одну и ту же Cube-партию можно без изменения игрового смысла продолжать, просматривать, откатывать и завершать в Cube 2D и Cube 3D. Фактическое принятие версии подчиняется общему обязательному правилу принятия версий выше.

---

# Future — Online Multiplayer

Online Multiplayer начинается только после стабилизации текущего локального roadmap.

Будущий scope может включать:

- серверно-авторитетные партии;
- аккаунты;
- network transport;
- lobby/invitations/matchmaking;
- reconnect;
- cloud persistence;
- spectators/rating/friends/anti-cheat и другие сетевые функции.

Номер этой версии пока не назначен. Архитектурная готовность к сети описывается только в `docs/ARCHITECTURE.md` и не означает раннюю реализацию сетевых функций.

---

# Future — 3D Torus

3D Torus не входит в текущий нумерованный roadmap. Его продуктовые требования могут храниться в `docs/GAME_CUBE_GO.md`, но наличие этих требований не назначает ему версию и не разрешает реализовывать его в 0.1/0.2/0.3/0.5.

---

# Quality gates и порядок работы

Каждая пользовательская версия проходит последовательность:

**Core → Functional UI → Polish → Acceptance**

- **Core** — корректность логики и автоматические проверки без зависимости от финальной визуальной полировки.
- **Functional UI** — функцию можно полностью использовать через интерфейс.
- **Polish** — анимации, плавность и визуальная настройка после функциональной корректности.
- **Acceptance** — технический regression/acceptance gate, пользовательская/UAT-проверка, исправления по её результатам и финальное явное решение пользователя о принятии версии согласно обязательному правилу выше.

Следующий крупный этап не начинается, пока предыдущий не является рабочей и тестируемой контрольной точкой. Переход к следующей нумерованной версии как к принятой предыдущей версии не происходит без явного пользовательского acceptance.

Перед подробным планированием крупной версии и перед существенным техническим checkpoint применяется Library/Reuse Review по правилам `docs/ARCHITECTURE.md`. Roadmap определяет **когда** выполняется этот gate; критерии выбора библиотек и технические правила review принадлежат `ARCHITECTURE.md`.

# Правило scope

При составлении задачи на конкретную версию или checkpoint в scope включаются только функции, уже введённые этой версией или более ранними версиями, плюс техническая работа текущего checkpoint.

Наличие будущего поведения в `docs/GAME_CUBE_GO.md` или будущего архитектурного контракта в `docs/ARCHITECTURE.md` не означает разрешение реализовывать его раньше версии, указанной в этом roadmap. Постоянная cross-version development infrastructure, явно указанная выше, не считается пользовательским feature scope нумерованной версии и может развиваться между release checkpoints.
