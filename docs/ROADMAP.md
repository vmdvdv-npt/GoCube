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

0.1 считается завершённой, когда полная партия на Torus 2D стабильно проходит от New Game до финального результата в обоих scoring modes, Undo/Redo и persistence работают через полный жизненный цикл партии, а автоматические проверки 0.1 проходят без известных correctness-регрессий.

---

# Версия 0.2 — Cube 2D

## Цель

Добавить CubeTopology и полноценное Cube 2D-представление рядом с уже работающим Torus 2D без создания отдельной версии базовых правил Go.

## Scope

В 0.2 появляются:

- CubeTopology;
- Cube 2D;
- выбор topology `Cube / Torus` при создании новой партии;
- при первом появлении этого выбора default topology — `Cube`;
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

0.2 считается завершённой, когда полноценную партию можно сыграть на Cube 2D, Cube-specific automated coverage проходит, а существующая Torus 2D функциональность остаётся без correctness-регрессий.

---

# Версия 0.3 — Automatic/Assisted alive-dead-seki

## Цель

Сократить ручную работу при финальном разборе, автоматически определяя только те статусы, которые система может установить достаточно уверенно, и сохраняя ручной fallback.

## Scope

В 0.3 появляются:

- automatic/assisted classification очевидных alive/dead/seki;
- работа классификатора как с TorusTopology, так и с CubeTopology;
- ручной fallback для недоказанных или спорных случаев;
- regression/fixture coverage endgame-classification для обеих topology.

Cube 3D в 0.3 не входит. Cube-партии по-прежнему стартуют и играются в Cube 2D; Torus остаётся 2D.

## Критерий готовности

0.3 считается завершённой, когда автоматическая помощь корректно работает на обеих topology, не ухудшает ручной fallback и не создаёт расхождений в итоговом scoring.

---

# Версия 0.5 — Cube 3D

## Цель

Добавить полноценное 3D-представление уже работающей Cube Go без изменения правил партии и без отдельной 3D-версии доменного состояния.

## Scope

В 0.5 появляются:

- Cube 3D renderer;
- новая Cube-партия по умолчанию стартует в Cube 3D;
- свободное переключение Cube 2D ↔ Cube 3D в рамках одной Cube-партии;
- Torus в текущем roadmap остаётся только Torus 2D;
- 3D input, rotation, zoom и picking;
- отображение полного текущего игрового состояния в 3D;
- сохранение пространственного orientation anchor между представлениями;
- feature parity основных игровых и endgame-визуализаций Cube 2D/Cube 3D;
- 3D-specific automated/visual regression coverage.

Точное 3D-поведение определяет `docs/GAME_CUBE_GO.md`; техническую границу Renderer3D и spatial mapping определяет `docs/ARCHITECTURE.md`.

## Внутренний порядок 0.5

Порядок реализации:

1. renderer core;
2. hit-testing/input;
3. feature parity with Cube 2D;
4. polish;
5. release acceptance.

## Критерий готовности

0.5 считается завершённой, когда одну и ту же Cube-партию можно без изменения игрового смысла продолжать, просматривать, откатывать и завершать в Cube 2D и Cube 3D.

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
- **Acceptance** — полный regression/acceptance gate версии.

Следующий крупный этап не начинается, пока предыдущий не является рабочей и тестируемой контрольной точкой.

Перед подробным планированием крупной версии и перед существенным техническим checkpoint применяется Library/Reuse Review по правилам `docs/ARCHITECTURE.md`. Roadmap определяет **когда** выполняется этот gate; критерии выбора библиотек и технические правила review принадлежат `ARCHITECTURE.md`.

# Правило scope

При составлении задачи на конкретную версию или checkpoint в scope включаются только функции, уже введённые этой версией или более ранними версиями, плюс техническая работа текущего checkpoint.

Наличие будущего поведения в `docs/GAME_CUBE_GO.md` или будущего архитектурного контракта в `docs/ARCHITECTURE.md` не означает разрешение реализовывать его раньше версии, указанной в этом roadmap.
