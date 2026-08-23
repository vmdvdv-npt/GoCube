# Endgame Engine — рабочий план

## Статус документа

`docs/ENDGAME_ENGINE.md` — **активный рабочий план** разработки движка определения `alive / dead / seki / unresolved` и последующего построения territory map.

Документ создан по явному решению владельца проекта и предназначен для интенсивного использования в ближайшем цикле разработки 0.3. Он **может и должен быстро меняться** по мере экспериментов, сравнений с внешними движками, появления новых тестов, обнаружения ошибок и уточнения алгоритмов.

Этот файл не заменяет три канонических документа проекта:

- продуктовые требования и пользовательское поведение принадлежат `docs/GAME_CUBE_GO.md`;
- архитектурные контракты, module boundaries, dependency rules и library policy принадлежат `docs/ARCHITECTURE.md`;
- порядок разработки, version scope и checkpoints принадлежат `docs/ROADMAP.md`.

Если в ходе работы решение из этого плана становится обязательным продуктовым, архитектурным или roadmap-фактом, соответствующий канонический документ должен быть обновлён в той же работе. При конфликте канонический документ имеет приоритет, а этот план должен быть исправлен.

### Правило для агентов

При любой работе над automatic/assisted endgame engine агент должен:

1. сначала прочитать соответствующие канонические документы;
2. затем прочитать **актуальную версию этого рабочего плана**;
3. использовать его как текущую инженерную гипотезу и decomposition работы;
4. активно обновлять этот файл, если эксперименты, код, тесты или внешние исследования показывают, что план следует изменить;
5. не сохранять устаревший пункт «ради истории» — история остаётся в Git;
6. не превращать этот файл в зеркальную копию канонических требований.

Главная ценность документа — не стабильность текста, а сохранение актуального инженерного направления.

---

# 1. Цель движка

После завершения основной фазы партии движок должен максимально автоматически определить состояние групп и территорий без нейросетей в production correctness chain.

Целевой результат анализа:

```text
alive
 dead
 seki
 unresolved
```

`unresolved` является нормальным и безопасным результатом. Главный приоритет — **не ставить ложный automatic status**.

Движок должен:

- одинаково работать через topology-neutral contracts на Torus и Cube;
- использовать существующую Go-литературу и permissive open-source implementations вместо изобретения известных алгоритмов заново;
- отделять эвристики поиска от доказательства результата;
- возвращать объяснимый proof/evidence result;
- ограничивать expensive search локальными конфликтными областями;
- деградировать в `unresolved`, если доказательство не найдено в разрешённом budget;
- после полной классификации передавать результат отдельному territory/scoring pipeline.

Production engine не должен зависеть от KataGo, OGS, Sabaki, GNU Go, сети или локального AI. Они используются как references/oracles/test infrastructure там, где это корректно.

---

# 2. Главный принцип: proof, а не confidence

Ключевое правило всей системы:

```text
heuristic != proof
candidate != proof
ownership estimate != proof
failure to find a kill != proof of life
failure to find life != proof of death
```

Эвристика может:

- определить приоритет анализа;
- сформировать candidate;
- выбрать move ordering;
- определить search budget;
- предложить relevance zone;
- решить отказаться от дальнейшего search.

Эвристика **не может сама** породить `PROVEN_ALIVE`, `PROVEN_DEAD` или `PROVEN_SEKI`.

Если proof невозможно завершить:

```text
UNKNOWN / UNRESOLVED
```

Это особенно важно, потому что endgame engine не обязан выбирать следующий игровой ход. В отличие от обычного Go AI он может позволить себе не угадывать.

---

# 3. Не анализировать группы изолированно: Conflict Region

Базовый объект тяжёлого анализа — не отдельная stone group, а **связанный конфликтный регион**.

Причина: жизнь и смерть часто зависят сразу от нескольких объектов:

- shared liberties;
- connection с другой friendly group;
- захват соседней группы открывает eye-space;
- semeai;
- seki;
- snapback;
- ko;
- несколько strings образуют один функциональный dragon.

Сначала строится полный граф позиции.

```text
StoneString
  color
  stones
  liberties

EmptyRegion
  points
  borderingStrings
  borderingColors

ConflictRegion
  blackStrings
  whiteStrings
  emptyRegions
  sharedLiberties
  possibleConnections
  boundarySafeGroups
```

Conflict regions формируются из графа взаимодействий между unresolved strings и соседними empty regions.

Простая позиция может дать region из одной target group и окружающих attacker stones. Semeai или seki могут дать один region из нескольких групп обоих цветов.

---

# 4. Только graph topology

Endgame logic не должна знать о visual geometry.

Основной контракт:

```text
Topology.neighbors(PointId)
```

Запрещено делать correctness-зависимые проверки вида:

```text
x == 0
isEdge
isCorner
faceIndex == ...
```

для life/death semantics.

Это означает:

- Torus seam является обычным соседством графа;
- Cube edge является обычным соседством графа;
- группа через несколько Cube faces остаётся одной connected component;
- empty eye region может переходить через Cube edge или Torus seam без специальных правил.

Геометрия допустима только для UI/debugging или для доказанно безопасной search optimization, но не как источник правил.

---

# 5. Базовый pipeline

Целевая схема:

```text
FINAL POSITION
      │
      ▼
Endgame Graph Core
(groups / liberties / empty regions / relations)
      │
      ▼
Benson / Pass-Alive
      │
      ▼
remove PROVEN_ALIVE from expensive work
      │
      ▼
Conflict Regions
      │
      ▼
Relevance Zones
      │
      ├──────────────┬──────────────┐
      ▼              ▼              ▼
Tactical Reader  Connection Reader  Eye/Shape analysis
      └──────────────┴──────────────┘
                     │
                     ▼
             Life/Death Search
                     │
                     ▼
             Semeai / Seki
                     │
                     ▼
                ProofResult
                     │
                     ▼
          Endgame Adjudication
                     │
                     ▼
alive / dead / seki / unresolved
                     │
          manual resolution if needed
                     │
                     ▼
         EndgameClassification
                     │
                     ▼
            TerritoryResolver
                     │
                     ▼
      ChineseScoring / JapaneseScoring
```

Эта схема является текущей рабочей гипотезой и может изменяться.

---

# 6. Stage A — Endgame Graph Core

Первый слой не определяет жизнь и смерть вообще.

Он должен детерминированно построить:

- все connected strings;
- liberties каждой string;
- все connected non-color/empty regions, которые нужны последующим algorithms;
- boundary strings каждого region;
- shared liberties;
- adjacency между opposing groups;
- candidate friendly connections;
- mapping `PointId -> groupId/regionId`.

Алгоритмически это в основном BFS/DFS/flood fill поверх `Topology.neighbors()`.

Ожидаемая сложность базового прохода — линейная относительно размера graph.

Нельзя допускать вторую rectangular-specific реализацию групп для Cube/Torus analysis.

---

# 7. Stage B — Proven Alive: Benson / pass-alive

Первый автоматический статус — **безусловная жизнь**.

Основной алгоритм: Benson/pass-alive fixed-point analysis.

## Reuse

Основные источники:

- David Benson, *Life in the Game of Go*;
- Moka (`millionco/moka`, MIT) — современная TypeScript Benson-like implementation;
- `d180cf/tsumego.js` (Apache-2.0) — отдельная implementation для сравнения semantics.

Текущий предпочтительный production source для адаптации — Moka/Benson logic, заменяя rectangular adjacency на project topology contracts.

## Семантика

Для каждого цвета:

1. использовать friendly strings из общего `EndgameGraphCore` snapshot;
2. построить **color-specific non-color regions**: connected components всех logical points, не занятых анализируемым цветом, то есть empty points **и** opponent stones;
3. opponent stones участвуют в связности такого region, но `vitalGroups` вычисляются пересечением adjacent friendly groups только по **empty points** region;
4. начать со всех candidate strings;
5. итеративно удалить strings, которые не имеют необходимого числа vital regions;
6. удалить regions, граница которых больше не состоит из surviving strings;
7. повторять до fixed point.

Обычный `EndgameGraphCore.emptyRegion` и Benson non-color region — не один и тот же объект. General empty regions остаются общим structural graph для conflicts/connections; Benson строит только свой color-specific derived projection поверх общих `stringsByKey/stringByPoint` и `Topology.neighbors()`, не создавая второй stone-string/liberty index.

Surviving strings получают:

```text
PROVEN_ALIVE
proof = BENSON_PASS_ALIVE
```

## Почему не нужен отдельный примитивный `two eyes detector`

Простой визуальный критерий «две пустые дырки» не должен быть отдельным источником истины. Benson покрывает более общий доказуемый класс взаимно поддерживающих groups/regions.

Cheap eye-count может использоваться для diagnostics или ordering, но не нужен как параллельная competing definition of unconditional life.

---

# 8. Stage C — Priority / Candidate Analysis

После Benson остаются unresolved conflict regions.

На этой стадии мы **не фильтруем** regions из correctness pipeline. Все unresolved regions теоретически могут попасть в solver.

Candidate logic нужна только для приоритета и budget.

Признаки:

- 1 liberty;
- 2 liberties;
- 3 liberties;
- enclosed by opponent-safe boundary;
- small eye-space;
- opponent pass-alive influence;
- shared liberties;
- immediate capture available;
- lack of obvious outside connection;
- small relevant point count.

## Moka aftermath

Moka содержит `getAutomaticallyDeadMoves()` и capture-aftermath logic. Его можно адаптировать как:

```text
candidate generator
priority signal
regression/reference source
```

но не как authoritative proof, потому что greedy/immediate-capture aftermath не перебирает оптимальную защиту как полный exact solver.

Правильная связь:

```text
Moka says suspicious
      ↓
raise priority
      ↓
run verifier/search
```

а не:

```text
Moka says dead
      ↓
DEAD
```

---

# 9. Stage D — Tactical Reader

Перед тяжёлым life/death search нужен специализированный быстрый tactical reader.

Это соответствует классическому разделению в mature Go engines: tactical reading отдельной string решает короткие захваты значительно дешевле полноценного dragon/life-death analysis.

Tactical Reader должен постепенно покрывать:

- immediate capture;
- atari escape;
- 1–3 liberty forced capture;
- short net;
- ladder;
- snapback;
- counter-capture;
- short sacrifice sequence;
- simple tactical connection/disconnection.

## Семантика search

Для доказательства kill:

```text
attacker node = OR
  достаточно одного winning move

defender node = AND
  каждый релевантный legal defense должен проигрывать
```

Если хотя бы один неотброшенный defensive move спасает target, kill не доказан.

Если defensive move не был исследован и его irrelevance не доказана, результат не может быть `PROVEN_DEAD`.

## Terminal states

Примеры:

```text
all crucial target stones captured -> PROVED_KILL
connects to proven-safe group -> PROVED_SURVIVAL
search budget exhausted -> UNKNOWN_BUDGET
position escapes local proof boundary -> UNKNOWN_BOUNDARY
ko required -> KO_DEPENDENT
```

---

# 10. Crucial Stones

Для life/death problem в начале фиксируется identity исходной target structure.

```text
crucialStones = original stones selected as target
```

Если в продолжении defender добавляет новые stones, это не должно терять identity исходной задачи.

Если все crucial stones удалены legal capture sequence:

```text
attacker objective satisfied
```

Эта идея присутствует в классических tsumego solvers и помогает не путать судьбу исходной группы с появившейся рядом новой группой.

Для multi-group ConflictRegion модель crucial targets должна быть расширена явно, а не скрыто внутри одного stone id.

---

# 11. Stage E — Connection Reader

Connection должен анализироваться отдельно, а не только как побочный эффект life/death search.

Цель:

```text
Can target force a connection to a known-safe friendly structure?
```

или симметрично:

```text
Can attacker force a cut?
```

Если target имеет доказанную forced connection к `PROVEN_ALIVE` structure, это может стать коротким proof:

```text
PROVEN_ALIVE
proof = FORCED_CONNECTION_TO_SAFE_GROUP
```

Connection Reader должен использовать те же legal move primitives, ko/repetition semantics и graph topology, что и основной engine.

---

# 12. Stage F — Eye / Shape analysis

Статический eye-space analysis полезен как terminal predicate, proof accelerator и move-ordering source.

Нельзя использовать правило:

```text
empty count < N -> dead
```

как общий proof.

Две отдельные одноточечные secure eyes уже могут давать unconditional life, а connected eye-space одного размера может иметь разные values в зависимости от формы и порядка хода.

## Для малых closed regions

Предпочтительный путь — exact enumeration/lookup по graph shape, а не большая handwritten база human shape names.

Возможная модель:

```text
EyeShapeKey = canonical local graph
            + occupancy mask
            + side to move
```

Результат:

```text
LIVE
DEAD
CRITICAL
KO_DEPENDENT
UNKNOWN
```

Из exact enumeration можно получить известные nakade-like shapes автоматически, вместо ручного списка `bulky-five`, `rabbity-six` и т. п.

## Источники идей

- Chen & Chen static life/death analysis;
- GNU Go optics/eye-space architecture — reference only, не копировать GPL production code;
- tsumego corpora как known-answer source.

---

# 13. Stage G — Relevance Zone

Relevance Zone должна появиться **до** дорогого search, а не после него.

Цель:

> доказать, какие logical points действительно могут повлиять на исход данного local life/death problem.

Начальная зона может включать:

- target stones;
- target liberties;
- adjacent enemy strings;
- neighboring empty regions;
- likely connection points;
- boundary groups;
- несколько graph layers вокруг конфликта.

Зона расширяется, если legal move:

- создаёт новую liberty target снаружи;
- соединяет target с внешней friendly group;
- захватывает boundary string и открывает наружу новый region;
- создаёт tactical interaction с ранее внешним group.

Если доказанная локальность теряется и region начинает выходить в большое open space:

```text
UNKNOWN_BOUNDARY
```

а не `ALIVE` и не `DEAD`.

## Research source

Обязательно изучать современные Relevance-Zone based Go life-and-death solvers, включая опубликованные research implementations, прежде чем закреплять собственный zone algorithm.

---

# 14. Stage H — Full Life/Death Search

После cheap/static layers остаются локальные conflict regions, требующие полноценного proof search.

## Внешние implementations для technical comparison

Перед окончательным production design сравнить как минимум:

### `d180cf/tsumego.js`

Сильные стороны:

- JavaScript/TypeScript lineage;
- Apache-2.0;
- target-group tsumego solving;
- transposition table;
- local pass;
- ko/repetition handling;
- compact and understandable implementation.

Ограничения:

- standard rectangular board assumptions;
- simple DFS search;
- особенно силён на enclosed problems;
- known limitations для больших/open-boundary problems.

### `cameron-martin/tsumego-solver`

Rust implementation, связанная с research line *Search versus Knowledge for Solving Life and Death Problems in Go*.

Использовать для сравнения search decomposition, representations и test methodology.

### Relevance-Zone research implementations

Использовать как современный reference для localisation/search reduction.

### DarkforestGo tsumego solver

Может использоваться как дополнительный permissive reference для move ranking, region-bound search и exhaustive solver structure.

## Решение о reuse

Не принимать заранее решение «подключаем библиотеку целиком».

Допустимые варианты после spike:

```text
A. adapt substantial permissive code
B. port search algorithm around project Topology
C. implement graph-native equivalent from literature
D. hybrid of A/B/C
```

Выбор должен основываться на:

- license;
- topology coupling;
- correctness;
- ease of testing;
- performance;
- maintainability;
- compatibility with project ko/rule semantics.

---

# 15. Search algorithm progression

Первая корректная версия не обязана сразу иметь df-pn.

Рабочая стратегия:

```text
v1: deterministic AND/OR DFS + memoization/transposition table
v2: improved move ordering / forced moves / relevance zones
v3: proof-number search / df-pn if benchmarks justify
```

Search scheduler можно менять, не меняя semantics result.

Главный invariant:

```text
optimization must not weaken proof boundary
```

## Proof Number Search / df-pn

Для AND/OR life-death tasks это естественный advanced search family.

Примерные proof/disproof semantics:

```text
terminal proof:
  pn = 0
  dn = INF

terminal disproof:
  pn = INF
  dn = 0

OR:
  pn = min(child.pn)
  dn = sum(child.dn)

AND:
  pn = sum(child.pn)
  dn = min(child.dn)
```

Но точная implementation выбирается после technical spike и benchmarks.

---

# 16. Нельзя иметь две несогласованные версии правил Go

Одна из главных опасностей при port existing solver — импортировать его Board и получить вторую игровую механику.

Production correctness не должна зависеть от чужой rectangular board implementation.

Предпочтительно reuse:

- search algorithms;
- proof semantics;
- move ordering;
- repetition ideas;
- transposition logic;
- corpora/tests;

а legal move semantics должны оставаться согласованы с project rules.

## Возможный AnalysisPosition

Для performance допустима специализированная mutable search representation:

```text
AnalysisPosition
  play()
  undo()
  hash
  groups/liberties cache
```

Но она обязана иметь systematic differential tests против authoritative project move/rule semantics.

Пример invariant:

```text
for every generated legal/illegal sequence:
AnalysisPosition transition
==
project GameEngine transition
```

при одинаковом topology и ko context.

Иначе optimisation считается небезопасной.

---

# 17. ProofResult — обязательная observability

Solver не должен возвращать только enum `dead`.

Предлагаемая внутренняя модель:

```text
ProofResult {
  outcome:
    PROVED_ALIVE |
    PROVED_DEAD |
    PROVED_SEKI |
    CRITICAL |
    KO_DEPENDENT |
    UNKNOWN_BUDGET |
    UNKNOWN_BOUNDARY |
    UNKNOWN

  algorithm
  conflictRegionId
  crucialStones
  exploredNodes
  maxDepth
  principalVariation
  proofReason
  evidence
}
```

Это рабочая форма, не закреплённый API.

## Зачем

При любой ошибке разработчик должен видеть:

```text
что было доказано
каким алгоритмом
какая winning/defensive линия найдена
сколько nodes просмотрено
где search прекратился
```

Пример:

```text
PROVED_DEAD
algorithm: tactical-forced-capture
nodes: 43
PV: B:p17 W:q17 B:q18 W:p18 B:r18
reason: all defender replies lead to capture
```

Такой trace должен использоваться Test Lab и regression diagnostics.

---

# 18. Два порядка первого хода

Для unresolved local problem полезно решать как минимум две версии:

```text
attacker moves first

defender moves first
```

Пример рабочей интерпретации raw proof facts:

| Attacker first | Defender first | Raw fact |
|---|---|---|
| kill | kill | strongly dead |
| cannot kill | cannot kill | strongly survives |
| kill | survives | critical / unsettled |
| ko-dependent | any | ko-dependent |
| unknown | any | unresolved |

Важно: окончательное преобразование этих proof facts в `alive/dead/seki` может зависеть от endgame adjudication policy. Поэтому solver и rule interpretation не следует жёстко смешивать.

---

# 19. Endgame Adjudication Policy

Нужно отделить два вопроса:

```text
What tactical facts are proven?
```

и

```text
How should those facts be interpreted in endgame under current rules?
```

Особенно это важно вокруг:

- ko;
- seki;
- pass semantics;
- rule-set-specific post-game adjudication.

Рабочая архитектурная идея:

```text
Proof facts
   ↓
EndgameAdjudicationPolicy
   ↓
alive / dead / seki / unresolved
```

Этот слой **не считает очки**.

Если решение о таком контракте будет принято как production architecture, оно должно быть отражено в `docs/ARCHITECTURE.md`.

---

# 20. Stage I — Semeai

Capturing race должен рассматриваться отдельно от простого single-target dead detector.

Relevant inputs:

- exclusive liberties каждой стороны;
- shared liberties;
- approach moves;
- internal eyes;
- captures that change liberty count;
- connection possibilities;
- side to move;
- ko/repetition.

Простой `libertyCountA > libertyCountB` не является общим solver.

Для trivial cases допустимы exact formula/static proofs, если их correctness подтверждён литературой и tests.

Для остальных — тот же AND/OR search на whole conflict region.

---

# 21. Stage J — Seki

Seki следует анализировать **после** обычных alive/dead/tactical/connection passes среди оставшихся взаимодействующих unresolved regions.

Рабочая идея proof:

- opposing groups взаимно зависят от shared liberties/interaction;
- ни одна сторона не может принудительно получить выгодный capture при корректной защите другой;
- обе стороны могут сохранять существование без превращения позиции в обычную independent two-eye life;
- результат не зависит от недоказанного глобального ko.

Источники:

- Niu / Kishimoto / Müller, seki recognition research;
- GNU Go semeai/seki architecture как reference;
- `goscorer` для scoring/seki territory differential tests после dead marking.

Сложный или сомнительный seki:

```text
UNRESOLVED
```

---

# 22. Ko и repetition

Ko нельзя превращать в guess.

Если local proof зависит от внешних ko threats или сложной global history:

```text
KO_DEPENDENT
```

и на текущем conservative production level:

```text
UI-facing result -> unresolved
```

Search/cache key не должен предполагать, что одинаковая stone occupancy всегда означает идентичный game-theoretic node. Repetition/history context может быть relevant.

Existing solver implementations особенно полезны здесь как источник уже отлаженных идей.

---

# 23. PASS в local search

Local pass должен поддерживаться явно.

Он моделирует ситуацию, когда игрок делает irrelevent move elsewhere и передаёт локальный ход сопернику, не меняя local stones.

Pass важен для:

- seki-like states;
- repetitions;
- ko semantics;
- определения whether a side actually needs a local move.

Нельзя считать, что «в tsumego никто не пасует, значит pass не нужен движку».

---

# 24. Stage K — TerritoryResolver

Life/death engine и territory engine должны быть разделены.

После полной endgame classification, включая manual fallback:

```text
EndgameClassification
       ↓
TerritoryResolver
       ↓
neutral territory map
       ↓
ChineseScoring / JapaneseScoring
```

## Алгоритм

1. создать virtual scoring view, не мутируя authoritative game position;
2. виртуально удалить groups со статусом `dead`;
3. flood-fill remaining empty connected components через `Topology.neighbors()`;
4. для каждого empty region собрать bordering surviving colors/groups;
5. получить topology-neutral ownership/neutrality facts;
6. отдельно пометить interaction с seki там, где это нужно downstream scoring semantics.

Пример нейтральной структуры:

```text
ResolvedRegion {
  points
  borderingColors
  borderingGroups
  owner: BLACK | WHITE | NEUTRAL
  touchesSeki
}
```

TerritoryResolver не должен сам размазывать по коду формулы Chinese/Japanese scoring.

---

# 25. Scoring не переписывать без необходимости

После classification/territory facts используются существующие project scoring strategies.

Сторонние scorers полезны как references/oracles, но не должны автоматически заменить topology-neutral project scoring engine.

Главная новая сложность 0.3 — life/death/seki proof и territory resolution после корректной classification, а не создание ещё одного score engine.

---

# 26. External reuse / oracle strategy

## Moka — production adaptation candidate

Role:

- Benson/pass-alive source;
- candidate/aftermath ideas;
- TypeScript reference.

License: MIT.

Neural/model parts не нужны для authoritative engine.

## tsumego.js — search reference/adaptation candidate

Role:

- local life/death search;
- target semantics;
- transposition table;
- repetition/ko ideas;
- local pass;
- test corpus linkage.

License: Apache-2.0.

Не считать автоматически выбранной production dependency до technical comparison.

## cameron-martin/tsumego-solver

Role:

- independent life/death solver reference;
- Rust/search architecture comparison;
- research-based implementation ideas.

License/API должны быть повторно проверены перед любым code reuse.

## DarkforestGo tsumego

Role:

- additional search/move-order/reference source;
- implementation comparison.

License/revision проверять непосредственно перед reuse.

## GNU Go

Role:

- architecture/algorithm reference: tactical reading, connection reading, optics, OWL, semeai;
- offline oracle where useful.

Не копировать GPL code в production без отдельного сознательного license decision.

## KataGo

Role:

- strong independent planar/local oracle;
- discrepancy discovery;
- ownership/life-death diagnostics.

Не production authority.

## OGS score-estimator / goban autoscore

Role:

- independent practical planar dead/territory behavior;
- candidate generation ideas;
- differential test source.

OGS autoscore использует ownership estimates и thresholds, поэтому результат не является proof для GoCube automatic status.

## @sabaki/deadstones

Role:

- probabilistic candidate/discrepancy discovery;
- differential testing.

Никогда не authoritative proof.

## goscorer

Role:

- planar territory/seki scoring oracle after dead stones are correctly specified;
- source of scoring fixtures/ideas.

Не заменяет topology-neutral project scorer.

---

# 27. Known-answer corpus

Нельзя снова валидировать classifier в основном генератором, который подстраивается под тот же classifier.

Нужен независимый corpus, где expected answer существует до запуска нашего engine.

Категории:

```text
two-eye / Benson alive
single-eye
false eye
immediate atari
forced capture
ladder
net
snapback
sacrifice
nakade
connection to safe group
cut
semeai
seki
ko
open-boundary escape
unresolved by design
```

Источники:

- annotated tsumego SGF collections;
- existing solver repositories/tests;
- GNU Go regression ideas;
- goscorer fixtures;
- OGS/Sabaki discrepancies;
- manually verified project cases;
- user-reported regressions.

Каждый найденный реальный defect должен становиться постоянным deterministic regression case.

---

# 28. Differential testing

Для standard planar/local-equivalent cases сравнивать, где applicable:

```text
GoCube engine
vs KataGo
vs tsumego solver(s)
vs GNU Go
vs OGS estimator/autoscore
vs Sabaki deadstones
vs goscorer for territory/seki scoring facts
```

Разногласие с oracle не означает автоматически, что GoCube ошибается. Оно означает:

```text
investigate
classify cause
add fixed regression case
```

Нужно различать:

- oracle limitation;
- rules mismatch;
- ko semantics mismatch;
- heuristic disagreement;
- real GoCube bug.

---

# 29. Metamorphic topology testing

Для Cube/Torus особенно важны graph-isomorphism tests.

Берём один local semantic graph и размещаем эквивалентно:

```text
ordinary local patch
Torus interior
Torus across seam
Cube face interior
Cube across edge
Cube around vertex/face boundary configuration
```

Если relevant adjacency graph и rule context изоморфны, solver result должен быть идентичным.

Так проверяется topology-neutral engine сильнее, чем большим количеством ручных special-case tests.

---

# 30. Метрики качества

Одного `accuracy %` недостаточно.

## Precision

Доля automatic statuses, которые действительно корректны.

Для production automatic `alive/dead/seki` precision важнее coverage.

## Coverage / Recall

Доля settled/obvious cases, которые движок сумел resolve автоматически.

Нынешний defect 0.3 показывает, что высокая precision при почти нулевом dead recall практически бесполезна.

## Cost

Измерять минимум:

- median nodes;
- p95 nodes;
- max nodes;
- median time;
- p95 time;
- transposition hit rate;
- search depth;
- unresolved due to budget;
- unresolved due to boundary;
- unresolved due to ko.

## По классам

Метрики считать отдельно для:

- Benson alive;
- tactical dead;
- enclosed life/death;
- connection;
- open-boundary;
- semeai;
- seki;
- Torus topology stress;
- Cube topology stress.

---

# 31. Search budgets

Движок должен иметь deterministic bounded resource model.

Рабочие уровни сложности:

```text
Tier 0 — Static
Benson / trivial exact facts

Tier 1 — Tactical
short capture / ladder / net

Tier 2 — Small enclosed L&D
exact local search

Tier 3 — Open local L&D
relevance-zone search

Tier 4 — Connection / semeai / seki
multi-group search

Tier 5 — Exotic ko / huge region / budget overflow
UNRESOLVED
```

Точные node/time limits не закреплены этим документом и должны быть выбраны benchmark-driven.

Важно: time budget в tests может создавать nondeterminism на разных машинах. Для correctness tests предпочтительнее node/expansion budgets; wall-clock может быть production safety limit поверх них.

---

# 32. Shadow mode для нового engine

Крупную замену classifier следует вводить сначала в shadow/test mode.

Рабочая последовательность:

```text
current classifier -> player-facing result
new engine         -> diagnostic result only
```

Для каждой test/endgame position логировать:

```text
old result
new result
oracle results
ProofResult
cost metrics
```

После достижения нужных precision/coverage gates новый engine становится production classifier, старый implementation удаляется или упрощается.

Shadow mode не должен создавать вторую user-visible source of truth.

---

# 33. Предпочтительный порядок разработки

Текущая рекомендуемая decomposition:

## Work 1 — Technical reuse spike — CLOSED 2026-08-23

Сравнение `tsumego.js`, Cameron-Martin, Relevance-Zone и Darkforest на одном frozen corpus завершено настолько, насколько это допускают exact pinned upstream artifacts. Результатом считаются не только solver outcomes/time/nodes, но и воспроизводимые `unsupported`, upstream build failure и external runtime prerequisite. Нельзя патчить upstream или менять corpus только ради получения искусственно полной timing table.

Итог Work 1 зафиксирован в разделе 39: **готовой production solver foundation среди четырёх нет; production search shell должен быть graph-native, а permissive upstream code/ideas используются только выборочно**.

## Work 2 — Endgame Graph Core — CLOSED 2026-08-23

Topology-neutral structural core реализован поверх `BoardOccupancy + Topology.neighbors()` и стал общим источником strings/liberties/empty regions/relations для существующего assisted classifier.

Acceptance закрыт:

- Cube/Torus adjacency correctness — strings и empty regions проверяются через Torus seam и Cube face edge;
- graph-isomorphism fixtures — exact normalized graph сохраняется при чистом переименовании `PointId`;
- no renderer geometry dependency — production core импортирует только logical game/topology/endgame contracts.

Итог Work 2 и принятые structural/complexity decisions зафиксированы в разделе 40.

## Work 3 — Benson hardening — CLOSED 2026-08-23

Moka/Benson semantics сверены и вынесены в отдельный topology-neutral proof module поверх Work 2 graph snapshot. General `emptyRegions` больше не используются как скрытая подмена Benson color-regions.

Acceptance закрыт:

- существующий deterministic two-eye/pass-alive corpus остаётся proven alive;
- one-eye, false-eye и seki-like negative cases остаются unresolved;
- отдельный opponent-in-region case проверяет Moka non-color semantics;
- Torus seam и Cube face edge дают тот же Benson proof signature, что и interior placement;
- fixed-point elimination и partial-analysis fail-closed behavior сохранены.

Итог Work 3 и semantic boundary зафиксированы в разделе 41.

## Work 4 — Tactical Reader — CLOSED 2026-08-23

Topology-neutral bounded tactical reader реализован поверх authoritative `GameEngine.placeStone()` semantics. Automatic tactical `dead` допускается только когда capture доказан и при attacker-first, и при defender-first; selective attack search, budget/depth/boundary/cycle uncertainty и ko никогда не повышаются до `dead`.

Acceptance закрыт:

- immediate capture;
- escape from atari;
- forced 2–4 move capture;
- ladder;
- net;
- snapback;
- counter-capture;
- open escape remains unresolved/not-dead;
- terminal capture, зависящий от restoring ko recapture, возвращает `KO_DEPENDENT`;
- `KO_DEPENDENT` остаётся unresolved в classifier и имеет regression против ложного automatic `dead`.

Итог Work 4 и ko hardening зафиксированы в разделе 42.

## Work 5A — Relevance Zone Core — CLOSED 2026-08-23

Только доказанная локализация problem, без connection/cut proof.

Acceptance закрыт:

- topology-neutral dependency closure включает target, complete unresolved strings, direct tactical stone contacts и complete ordinary empty regions, reachable через liberties;
- Benson/pass-alive strings используются как текущая доказанная boundary: их stones включаются в zone, но expansion не продолжается через их внешние liberties/contacts;
- irrelevant occupancy change за неизменившейся safe boundary сохраняет **весь** bounded `RelevanceZoneResult`, включая `localPositionKey`;
- whole-board closure, deterministic point-budget overflow и target identity mismatch возвращают `unknown-boundary`;
- classifier/TacticalReader proof semantics этим этапом не расширялись.

Итог Work 5A зафиксирован в разделе 43.

## Work 5B — Safe Connection — CLOSED 2026-08-23

На bounded Relevance Zone реализован узкий proof `miai-two-shared-liberties-to-benson`: target group автоматически становится `alive` только если имеет две actual shared liberties с same-color Benson/pass-alive group и обе direct cut-order ветви безопасно проходят authoritative `GameEngine`.

Acceptance закрыт:

- safe connection к Benson-alive group доказывается только внутри bounded Relevance Zone;
- defender completeness для этого узкого miai-theorem покрывает обе прямые блокировки connectors; ход defender вне connectors оставляет оба connector свободными, поэтому immediate connection сохраняется;
- одна shared liberty не считается forced connection;
- capture/sacrifice/deeper cut/fight variants остаются `not-proven`;
- boundary/budget uncertainty возвращает `unknown-boundary` и не повышается до automatic `alive`;
- safe-connected group не становится новым Benson separator и не расширяет proof транзитивно.

Итог Work 5B зафиксирован в разделе 44.

## Work 5C — Cut + hardening — CLOSED 2026-08-23

Добавлен узкий proof `single-shared-liberty-benson-block`: attacker-first cut считается доказанным только если единственная direct shared liberty с Benson-alive friendly group legal quiet move'ом занята attacker, после чего blocker сам Benson/pass-alive, target и safe group остаются раздельными, а direct shared-liberty connection исчезает.

Acceptance закрыт:

- простой quiet proven cut возвращается отдельным Connection Reader fact `simple-cut-v1`;
- cut **не** превращается в automatic `dead`;
- две shared liberties, capture-on-cut и нестабильный non-Benson blocker остаются `not-proven`;
- far-away mutation за неизменившейся safe boundary сохраняет exact proof;
- point-budget и whole-board localisation возвращают `unknown-boundary`;
- финальный Work 5 acceptance закрыт совместно поверх 5A + 5B + 5C.

Итог Work 5C и closure исходного Work 5 зафиксированы в разделе 45.

## Work 6A — AND/OR Search Core — CLOSED 2026-08-23

Только универсальный deterministic search mechanism, без Go-specific move generation и без classifier integration.

Acceptance закрыт:

- OR/AND DFS semantics реализованы отдельно от Go rules;
- resolved-only transposition table не кеширует budget/cycle/incomplete uncertainty как доказательство;
- deterministic node budget возвращает `unknown/budget` при exhaustion;
- deterministic proof trace сохраняет caller-defined move ordering;
- incomplete AND expansion не может вернуть `proved`, а incomplete OR expansion не может вернуть `refuted`;
- one-sided proof/refutation разрешены только когда omitted branches уже не могут изменить результат;
- unresolved cycle возвращает `unknown/cycle`;
- classifier, Go move generation, first-player-order interpretation и tsumego solving этим этапом не расширялись.

Итог Work 6A зафиксирован в разделе 46.

## Work 6B — Local Life/Death Proofs — CLOSED 2026-08-23

Поверх готового search core подключена Go-specific local proof semantics внутри bounded Relevance Zone.

Acceptance закрыт:

- реальные complete-enough attack/defense move sets внутри certified zone;
- оба порядка первого хода;
- terminal capture/death и доказанное survival/alive;
- первые small enclosed life/death / nakade-like cases;
- любой непросмотренный релевантный defense запрещает false `dead`;
- timeout/budget exhaustion запрещает false `alive`;
- boundary/ko/uncertain semantics fail closed;
- classifier integration намеренно не добавлена и остаётся scope Work 6C.

Итог Work 6B зафиксирован в разделе 47.

## Work 6C — Hardening + classifier integration — CLOSED 2026-08-23

Work 6B reader расширен отдельным deterministic hardening corpus и подключён к `AssistedEndgameClassifier` только через полностью доказанные outcomes.

Acceptance закрыт:

- frozen elementary tsumego-equivalent known-answer subset покрывает enclosed 2-, 3- и 4-liberty local deaths плюс Benson/pass-alive survival reference;
- adversarial mixed-order case доказывает, что defender-first connection к Benson-safe group запрещает false overall `dead`;
- far-away mutation за неизменившейся Relevance Zone boundary сохраняет exact zone и оба search traces;
- exact node-budget threshold и one-node-below regression fail closed как `unknown-budget`;
- repeated reads дают deterministic proof traces;
- performance regression gate основан на deterministic explored-node count, а production classifier дополнительно имеет узкий candidate gate;
- classifier повышает только `proved-dead` / `proved-alive`, когда оба first-player orders совпадают; `unknown`, budget, boundary, cycle, incomplete и ko-dependent результаты остаются `unresolved`;
- production Local Life/Death search запускается только для unresolved target с 3–4 liberties, каждая из которых непосредственно ограничена opponent Benson/pass-alive string; 1-liberty и 2-liberty classes остаются у ранее принятых cheap proof layers.

Итог Work 6C зафиксирован в разделе 48.

## Work 7A — Semeai Core — CLOSED 2026-08-23

Реализован консервативный `simple-semeai-v1` для простых гонок захвата ровно двух opposing groups без shared-liberty play, third-group interaction и сложной life/death семантики.

Acceptance закрыт:

- отдельно считаются exclusive liberties обеих сторон и shared liberties;
- shared liberties явно возвращаются в result, но любая реальная shared-liberty гонка остаётся `unresolved` и передаётся Work 7B;
- каждый simple capture countdown подтверждается authoritative `GameEngine.placeStone()` для **всех** порядков заполнения exclusive liberties внутри explicit small-race budget;
- intermediate capture, suicide/illegal move, connection/merge, изменение target liberties вне чистого countdown или захват посторонних stones запрещают static proof;
- direct third-group interaction и пересекающиеся exclusive-liberty frontiers остаются `unresolved` для Work 7B;
- immediate restoring simple ko даёт `ko-dependent`, а не winner;
- оба first-player orders вычисляются отдельно; stable winner выдаётся только когда победитель один и тот же в обоих orders, иначе результат `first-player-dependent`;
- classifier integration не добавлена и остаётся scope Work 7D.

Итог Work 7A зафиксирован в разделе 49.

## Work 7B — Shared Liberties + Multi-group Semeai — CLOSED 2026-08-23

Поверх Work 6A AND/OR core и Work 5A Relevance Zone реализован `bounded-semeai-v1` для двух opposing target strings внутри одного certified local conflict region. Shared-liberty play, changing liberties, соединения и захваты соседних auxiliary groups теперь проходят как ordinary authoritative search transitions, а не как static rejection.

Acceptance закрыт:

- обе target Relevance Zones должны быть `bounded`; conflict region — deterministic union этих certified zones;
- every local empty point перебирается через authoritative `GameEngine.placeStone()` плюс явный `tenuki`;
- исходные stones обеих target groups фиксируются как independent crucial targets;
- third-group connections/merges/captures и changing shared/exclusive liberties разрешены внутри certified region и переоцениваются после каждого хода;
- выход любой target dependency zone за исходную certified union или `maxZonePoints` overflow -> `unknown-boundary`;
- оба first-player orders решаются отдельно через deterministic AND/OR search; stable winner и `first-player-dependent` различаются;
- simple ko, budget, boundary, cycle и incomplete uncertainty fail closed;
- Work 7B остаётся two-primary-target solver: остальные strings внутри region являются auxiliary interaction state; general N-primary-target public API не заявляется;
- seki не маркируется, classifier integration не добавлена — это scope 7C/7D.

Итог Work 7B зафиксирован в разделе 50.

## Work 7C — Basic Seki Proof — CLOSED 2026-08-23

Добавлен отдельный `basic-seki-v1`, который **не** выводит seki из неспособности Work 7B доказать победителя. Proof intentionally narrow: две opposing non-Benson target groups должны иметь actual shared liberties внутри одной certified bounded union, а каждый legal local первый ход каждой стороны должен быть доказанно проигрывающим против немедленно отвечающего соперника. Local tenuki/pass остаётся безопасной альтернативой, сохраняющей исходную позицию.

Acceptance закрыт:

- проверяются обе стороны как возможный initiator;
- every legal empty point certified union проходит authoritative `GameEngine.placeStone()`;
- immediate capture opponent target считается winning initiation и запрещает seki;
- nonterminal initiation делегируется `bounded-semeai-v1` с фактическим responder-to-move order;
- seki выдаётся только если **все** legal local initiations обеих сторон имеют outcome `initiator-loses`;
- Benson/pass-alive target исключается как independent life, а direct interaction без shared liberty не подходит под basic theorem;
- initiation-created restoring simple ko сохраняет exact previous-board context и даёт `ko-dependent`;
- boundary, budget, cycle и incomplete uncertainty fail closed и не повышаются до `seki`;
- classifier integration не добавлена и остаётся scope Work 7D.

Итог Work 7C и строгая production-scope гипотеза seki зафиксированы в разделе 51. Следующий этап — **Work 7D: Hardening + Classifier Integration**.

## Work 7D — Hardening + Classifier Integration

Adversarial cases, оба порядка первого хода, Relevance Zone invariance, budgets, determinism, performance и только после этого production classifier integration semeai/seki results.

## Work 8 — TerritoryResolver hardening

После fully resolved classification построить topology-neutral territory map.

Acceptance:

- planar differential with goscorer where semantics match;
- Torus/Cube graph fixtures;
- dead virtual removal only;
- seki/dame neutrality.

## Work 9 — Massive acceptance / shadow comparison

- known-answer corpus;
- differential oracles;
- fixed seeds;
- generated near-endgame positions;
- topology metamorphic tests;
- browser performance metrics.

После этого решать, готов ли новый engine заменить current classifier.

---

# 34. Что считать достаточным первым production уровнем

Не требуется решить всю теорию life-and-death Go.

Первый реально полезный уровень должен автоматически закрывать большую часть очевидных случаев:

```text
Benson / unconditional alive
obvious two-eye structures covered by Benson
immediate atari deaths
short forced captures
ladders
short nets
simple snapbacks
small enclosed life/death
basic nakade/eye-space shapes
forced connection to safe group
simple semeai
strictly proven basic seki
clear territory after classification
```

Оставлять `unresolved` допустимо для:

```text
large open fights
very deep tsumego
complex ko
history-sensitive repetitions
exotic seki
search budget exhaustion
failure to prove relevance boundary
```

---

# 35. Что не делать

Не добавлять новые ad-hoc rules только потому, что появился один failing screenshot.

Не считать:

```text
1 liberty -> dead
small eye-space -> dead
surrounded visually -> dead
ownership 90% -> dead
search did not find escape -> dead
search did not find kill -> alive
```

Не строить отдельный Torus dead detector и отдельный Cube dead detector.

Не использовать AI/Monte Carlo output как automatic proof.

Не проверять semantic correctness главным образом тем же classifier/generator code.

Не копировать GPL/AGPL code в production без отдельного explicit license decision.

Не менять scoring formula во время работы над life/death, если defect не относится к scorer.

---

# 36. Текущие открытые решения

Эти вопросы намеренно **не закреплены** и должны решаться исследованиями/benchmarks:

1. Нужен ли production df-pn или DFS + strong relevance/move ordering достаточно?
2. Какой exact representation использовать для `AnalysisPosition`?
3. Нужен ли в будущем general N-primary-target `ConflictRegion` / `RelevanceZone` API поверх принятой Work 7B композиции двух single-target bounded certificates?
4. Нужно ли отдельное `EndgameAdjudicationPolicy` или достаточно текущего classifier contract?
5. Какие raw outcomes хранить: `critical`, `ko-dependent`, multiple proof strengths?
6. Какой node budget приемлем для browser runtime на 19x19 Torus?
7. Какие small eye-shapes стоит precompute exhaustively?
8. Какой minimum coverage required перед acceptance 0.3?

Вопрос о direct external solver foundation закрыт Work 1: **ни один из четырёх сравниваемых solver’ов не должен становиться production foundation целиком**. Search shell строится graph-native поверх project topology/rule semantics; отдельные permissive идеи или code fragments могут переноситься только после локальной проверки пользы.

Вопрос о strict seki proof первого production scope закрыт Work 7C: `basic-seki-v1` является отдельным sufficient proof взаимного сдерживания и никогда не выводится из одного лишь unresolved semeai search. Расширение coverage этой теоремы остаётся benchmark/corpus-driven, а не новым ad-hoc status rule.

Каждый оставшийся ответ должен появляться сначала как tested engineering decision, затем при необходимости переноситься в canonical architecture/roadmap/product document.

---

# 37. Правило изменения этого плана

Этот документ специально создан как **быстро меняющийся**.

Во время разработки агенту разрешено и рекомендуется:

- удалять ошибочные идеи;
- менять порядок этапов;
- заменять выбранную библиотеку;
- уточнять algorithms;
- добавлять новые external references;
- фиксировать benchmark conclusions;
- добавлять новые risk/acceptance criteria;
- сокращать sections, которые больше не полезны.

Но нельзя использовать mutable nature этого файла, чтобы обходить канонические документы.

Если изменение затрагивает:

```text
product behavior -> docs/GAME_CUBE_GO.md
architecture/contracts/library production boundary -> docs/ARCHITECTURE.md
version order/scope/checkpoints -> docs/ROADMAP.md
```

канонический владелец обновляется вместе с реализацией.

Git history является историей эволюции этого плана; сам файл должен показывать **только актуальное направление**.

---

# 38. Кандидаты для реальной адаптации в GoCube

Срез на **2026-08-23**. В эту таблицу входят только проекты, для которых перенос или адаптация полезного кода в GoCube технически и лицензионно реалистичны. Oracle-only, нейросетевые и заведомо несовместимые по лицензии проекты в shortlist не входят.

Под «адаптацией» здесь понимается не обязательное подключение библиотеки целиком, а один из допустимых вариантов:

```text
reuse permissive source code
port isolated algorithm/subsystem
adapt implementation around Topology.neighbors(PointId)
rewrite a permissive implementation around project contracts
```

Перед фактическим reuse всё равно повторно проверяются license, revision, dependency surface и topology assumptions конкретного кода.

## 38.1. Приоритетные кандидаты

| Движок / библиотека | Что реально можно адаптировать | Почему приоритет | Основной риск |
|---|---|---|---|
| **Moka (`millionco/moka`)** | Benson/pass-alive, deterministic structural analysis, dead-candidate/aftermath ideas | Самый прямой production candidate: TypeScript, MIT, близкая decomposition и уже полезная conservative alive logic | Rectangular adjacency надо заменить на project topology; aftermath нельзя превращать в proof без verifier |
| **`d180cf/tsumego.js`** | Local life/death search ideas, target semantics, transposition table, local pass, ko/repetition handling | Самый прямой permissive search reference для selective port | Runtime spike подтвердил жёсткие conventional-grid/enclosed-problem assumptions: package ограничен размером до 16 и требует safe outer wall; Board целиком не переносить |
| **`@sabaki/deadstones`** | Monte-Carlo dead-candidate generation и связанные структуры анализа | MIT и непосредственно работает с dead-stone detection; может дать полезный candidate layer | Вероятностная природа: только candidate/priority signal, не automatic proof |
| **`online-go/score-estimator`** | Dead/score candidate heuristics, practical endgame analysis logic, browser-oriented implementation ideas | MIT, компактный C++/Emscripten код и реальное практическое использование | Heuristic/rectangular semantics; результат должен проходить наш verifier |
| **`goscorer` (`lightvector/goscorer`)** | Territory/seki/scoring algorithms и fixtures после заданной dead marking | Permissive код и полезная логика для downstream territory/seki verification | Не решает automatic dead сам по себе и не должен заменить topology-neutral scorer целиком |
| **`goplayerjuggler/goVariants` / Go-Variants-Engine** | Toroidal mechanics, region/scoring logic и Torus-specific representation ideas | Редкий permissive внешний код именно для Toroidal Go | Не является полноценным alive/dead solver; полезность в основном topology-specific |

## 38.2. Дополнительные кандидаты

| Кандидат | Что можно адаптировать | Почему не в приоритетных |
|---|---|---|
| **Tenuki** | JavaScript rules/scoring/seki logic и отдельные endgame helpers | MIT и легко читается, но seki detection простая, rectangular и значительно слабее нужного proof-oriented уровня |
| **`@sabaki/go-board`** | Group/liberty/board data structures и отдельные utility patterns | MIT и технически переносим, но базовую topology-neutral механику групп GoCube уже имеет; риск дублирования выше пользы |
| **Sente** | C++/Python board/rules/SGF primitives и отдельные implementation patterns | MIT, но automatic dead/life solver отсутствует, поэтому для 0.3 полезность ограничена |
| **Fuego** | Search architecture, tactical/board/search utilities и отдельные mature algorithms | BSD-3-Clause, но framework большой и C++-heavy; адаптация отдельных частей возможна, целиком — неоправданно тяжёлая |
| **DarkforestGo — только идеи из `tsumego` subsystem** | Local exhaustive-search structure, move ordering, region-bound search ideas | BSD, но exact pinned `tsumego` source не собирается без исправления внутреннего API mismatch и жёстко фиксирован на 19×19; это reference для selective reimplementation, не drop-in subsystem |

## 38.3. Исключённые из shortlist

Следующие проекты больше **не рассматриваются как кандидаты на адаптацию кода**:

- **KataGo** — нейросетевой AI; может оставаться внешним диагностическим oracle, но не кандидат на production adaptation;
- **`govariantsteam/govariants`** — AGPL-3.0;
- **GNU Go** — GPL/copyleft;
- **Pachi** — GPLv2;
- **`cameron-martin/tsumego-solver`** — repository не предоставляет явной лицензии на code reuse;
- **`rlglab/study-LD-RZ` и аналогичные Relevance-Zone research repositories без permissive license** — идеи из опубликованных papers можно реализовывать самостоятельно, но их repository code не рассматривается для адаптации без явного лицензионного разрешения.

Исключение из shortlist не запрещает использовать публичные papers, наблюдаемое поведение или отдельный внешний executable как research/oracle source там, где это разрешено и полезно. Оно означает только, что такой проект **не участвует в сравнении кандидатов на перенос кода в GoCube**.

---

# 39. Work 1 — Technical reuse spike: финальный результат

Срез на **2026-08-23**. **Work 1 закрыт.** Один deterministic corpus, одна двухсторонняя постановка (`attacker-first` и `defender-first`) и exact upstream identities были реально проверены настолько далеко, насколько это возможно без изменения самих upstream projects или их environment contract.

Ключевое правило закрытия spike: `unsupported`, reproducible upstream build failure и обязательная external runtime dependency являются валидными результатами technical reuse benchmark. Нельзя патчить чужой solver, менять board size, дорисовывать outer wall или подменять build environment только ради того, чтобы получить формально заполненную четырехстороннюю timing table.

## 39.1. Общий deterministic corpus и benchmark boundary

Для всех кандидатов используется один и тот же planar SGF corpus. Conventional SGF намеренно не пытается кодировать Cube/Torus adjacency: topology-specific correctness будущего production engine проверяется graph/metamorphic tests отдельно.

Frozen Work 1 corpus:

- `xuanxuan-qijing:1` — 19×19, внешний public-domain problem source, source answer `unknown`;
- `work1:forced-capture` — 9×9 hand-authored known-answer `dead` sanity case;
- `work1:two-eye-alive` — 9×9 hand-authored known-answer `alive` sanity case.

Каждый solver проверяется в двух одинаковых постановках:

```text
attacker-first
defender-first
```

Если обе стороны выигрывают при своём первом ходе, normalized raw fact — `critical`, а не `unknown`. Если ни одна сторона не доказала победу, это **не** становится автоматически `seki`.

External solver result никогда напрямую не повышается до production `PROVEN_ALIVE / PROVEN_DEAD / PROVEN_SEKI`.

Общий Work 1 vocabulary:

```text
target-survives
target-captured
critical
seki
ko-dependent
unknown
unsupported
error
```

Для accuracy считаются только source labels `alive / dead / seki`; unknown/unresolved source cases не участвуют в accuracy.

## 39.2. Exact execution manifest

Source identity и execution artifact identity фиксируются отдельно. Числа benchmark не считаются воспроизводимыми без обоих уровней identity.

| Candidate | Exact source | Exact execution boundary |
|---|---|---|
| **`tsumego.js`** | `58a079aac928c7bd59dc398d014f1f2b743f692e` | npm `tsumego.js@1.1.0`; SHA-1 `bf82348af36f919d4942a5746eb49506a789b8e3`; SHA-512 `sha512-W/MQDhaMKiM15wd8YRjonXgZm+T1YxZRhavvv0sDPDywEidgDzN8s5Jum/aU0GIruGz5L/GDygn2/TQ34+btcg==` |
| **Cameron-Martin** | `7408523ae34d9f890eef08d7f39fae683dee1a4e` | source build with pinned `Cargo.lock` blob `bc18b817de7811efa91be5d16ebd95d703948faf`; temporary black-box harness exists only in benchmark checkout and is not vendored into GoCube |
| **Relevance-Zone** | `be5c678694b3d2326e9924dad4443e0910d52cdc` | source build inside `rockmanray/gorzone@sha256:1d1b6babbd6c5978c14394aad16aeffcff3106eb78574ee8a577bbeec596849f` |
| **DarkforestGo** | `ef1885ed5004dac8cbea2cbd3644706565af0876` | exact source build attempt of BSD `tsumego` subsystem; no separate published executable artifact exists for this revision |

`tsumego.js` особенно требует этого разделения: его опубликованный executable package `1.1.0` не является просто `bin` из pinned source checkout.

RZ также требует двойной identity: pinned Docker image является build environment, но не содержит готового `CGI`; executable строится из pinned source внутри этого image.

## 39.3. Реальный runtime / execution result

Все результаты ниже получены из одного GoCube corpus; позиции не адаптировались под ограничения конкретного solver.

### `tsumego.js`

Правильный public runtime bridge — `new Solver(sgf).solve(player)`. SGF `MA[...]` target marker был корректным; первоначальная ошибка вызова low-level `solve(args)` была исправлена до измерения ограничений solver.

Результат:

| Case | attacker-first | defender-first |
|---|---:|---:|
| `xuanxuan-qijing:1` 19×19 | `unsupported` — upstream max board size 16 | `unsupported` — upstream max board size 16 |
| `work1:forced-capture` 9×9 | error `There must be a safe outer wall.` — 5.71 ms | same error — 3.24 ms |
| `work1:two-eye-alive` 9×9 | same error — 2.37 ms | same error — 2.44 ms |

Это не defect общего corpus. Это измеренное подтверждение, что опубликованный solver несёт собственную enclosed/thick-wall problem model и не является generic drop-in life/death engine для GoCube.

### Cameron-Martin

Pinned Rust source успешно собирается с pinned lockfile. Для black-box benchmark использован минимальный временный harness поверх публичных `Puzzle`/profiler APIs; код harness не переносится в GoCube.

Каждая из шести постановок получила одинаковый 10-second solve budget:

| Case | Role | Elapsed | Nodes | Result |
|---|---|---:|---:|---|
| `xuanxuan-qijing:1` | attacker-first | 10024 ms | 75,202,693 | no proof |
| `xuanxuan-qijing:1` | defender-first | 10024 ms | 75,571,977 | no proof |
| `work1:forced-capture` | attacker-first | 10018 ms | 63,442,461 | no proof |
| `work1:forced-capture` | defender-first | 10018 ms | 63,641,346 | no proof |
| `work1:two-eye-alive` | attacker-first | 10015 ms | 45,512,401 | no proof |
| `work1:two-eye-alive` | defender-first | 10016 ms | 45,453,659 | no proof |

Ни один timeout не превращается в `alive`, `dead` или `seki`. Этот результат показывает, что generic import нашего SGF corpus в его Puzzle semantics без специальной problem preparation не даёт полезной production baseline, а не то, что proof-number search сам по себе плох.

### Relevance-Zone

Для всех трёх cases и обеих ролей были сформированы JSON inputs из того же corpus с явными `masked_sgf_str`, `turn_color`, `winning_color`, black/white crucial stones, search goals, ko rules и region. Использован deterministic benchmark config: один thread, fixed seed, 5-second problem limit.

Exact pinned source внутри exact pinned `rockmanray/gorzone` image компилируется до link stage, после чего reproducibly останавливается на external host dependency: linker не находит `libcuda.so.1`, требуемую `libcaffe2_gpu.so`, и получает unresolved CUDA driver symbols.

Следствие: pinned image — **не self-contained CPU runtime**. Для честного upstream executable benchmark требуется NVIDIA/CUDA host environment. Добавлять fake CUDA stubs, менять build options или патчить source ради CPU CI означало бы уже benchmark модифицированного candidate, поэтому этого не делаем.

### DarkforestGo `tsumego`

Pinned revision жёстко фиксирует `BOARD_SIZE = 19`, поэтому оба 9×9 sanity cases честно `unsupported`.

Для 19×19 case был предпринят exact minimal build BSD `tsumego` path. Он воспроизводимо не собирается без изменения upstream source: `tsumego/solver.c` вызывает старую форму `GetRankedMoves(&s->b, r, -1, &s->m)`, тогда как pinned `rank_move.h` уже требует отдельный `defender` parameter. Корневого CMake target для этого subsystem в revision также нет; исторический `compile.sh` сам `tsumego/solver.c` не собирает.

Следствие: exact pinned revision полезен как permissive implementation/reference source, но **не предоставляет воспроизводимый готовый tsumego executable**, который можно честно включить в одинаковый runtime timing run без нашего исправления upstream.

## 39.4. Почему нет общей four-way timing table

Её отсутствие теперь является результатом spike, а не незавершённой работой:

- `tsumego.js` не принимает общий corpus из-за max-board-size и safe-outer-wall contracts;
- Cameron реально выполняет все шесть постановок, но упирается в budget без proof;
- RZ требует GPU/CUDA host dependency поверх pinned image;
- Darkforest pinned `tsumego` source internally inconsistent и не собирается as-is.

Получить четыре сравнимых `elapsed/nodes` числа можно только если изменить хотя бы один из трех факторов: candidate source, candidate runtime environment или общий corpus/problem semantics. Такое сравнение уже не отвечало бы исходному вопросу Work 1 — «что можно реально взять/адатировать в GoCube без скрытой подмены правил и assumptions».

Поэтому executable compatibility itself включается в reuse decision.

## 39.5. Финальное reuse decision

Work 1 фиксирует решение:

```text
GoCube production search shell = graph-native

adjacency = Topology.neighbors(PointId)
legal moves / captures / ko / repetition = project rule semantics
production Board/rules implementation = project-owned
```

По кандидатам:

- **`tsumego.js` — selective port/adapt:** изучать/переносить отдельно search semantics, transposition-table patterns, pass/ko/repetition ideas там, где они остаются корректны после замены rectangular Board; не подключать его Board/rules как production foundation;
- **Darkforest — selective reference/port of isolated permissive ideas:** move ordering, region-bound exhaustive-search structure и отдельные mechanics могут быть источником реализации, но pinned subsystem не является drop-in executable или dependency;
- **Cameron — reference/black-box only:** license не разрешает считать repository code source для переноса; PNS decomposition и methodology остаются research references;
- **Relevance-Zone — graph-native implementation from publication/ideas:** repository code без license не переносится, а runtime stack слишком тяжёл и environment-coupled для production; relevance-zone algorithm реализуется поверх нашего graph/rules boundary.

Ни один чужой `Board`/rules implementation не переносится целиком.

Work 1 **не доказал преимущество раннего PNS/df-pn над простым AND/OR DFS**: Cameron timing здесь смешан с его собственной problem/board semantics. Поэтому остаётся последовательность раздела 15 — сначала deterministic graph-native AND/OR DFS + TT/memoization, затем strong move ordering/relevance zones, а PNS/df-pn вводить только по project-native benchmarks.

Три текущих corpus cases достаточны для **reuse/foundation decision**, потому что различия проявились уже на execution contract level. Они недостаточны для будущего выбора search scheduler и performance budgets; расширение known-answer corpus продолжается в последующих Work stages, а не удерживает Work 1 открытым.

## 39.6. Project validation

На Work 1 validation PR #143 финальный очищенный head `e12fad7` прошёл полный CI run #645:

- lint — pass (существующие warnings не блокируют);
- typecheck — pass;
- coverage/unit — **519 tests pass**;
- build — pass;
- full Playwright E2E — pass.

На двух более ранних validation heads WebKit дважды давал **215/216 pass** с failure вне Engine scope в `e2e/torus-pan-animation.spec.ts`: test ожидал `data-pan-direction="right"`, но получал `"down"` после rapid navigation. Финальный clean-head run прошёл, поэтому этот эпизод фиксируется как non-Engine timing/flaky observation, а не как текущий Work 1 blocker. В рамках Engine spike Torus code не менялся.

Временный runtime-probe workflow удалён перед финальной проверкой; в PR остались только Work 1 code/tests и этот рабочий документ.

## 39.7. Closure

Work 1 закрыт со следующими fulfilled outputs:

1. deterministic shared corpus и two-role benchmark semantics;
2. adapters и normalized external outcomes, отделённые от production proof statuses;
3. exact source/execution identities для всех четырёх candidates;
4. реальный execution attempt каждого candidate без vendoring unlicensed code;
5. measured Cameron timing/nodes и воспроизводимые execution constraints/failures остальных candidates;
6. license/topology/runtime matrix;
7. окончательное решение `graph-native production shell + selective permissive reuse/reference`;
8. полный clean-head CI: lint/typecheck/unit+coverage/build/Playwright E2E — pass.

**Work 2 может начинаться.** Он не должен зависеть от внешней solver library как production foundation.

---

# 40. Work 2 — Endgame Graph Core: финальный результат

Срез на **2026-08-23**. **Work 2 закрыт.** Production structural layer теперь один и topology-neutral: он строится из logical `BoardOccupancy` и `Topology.neighbors(PointId)` и не зависит от renderer geometry.

## 40.1. Accepted structural snapshot

`EndgameGraphCore` детерминированно строит и индексирует:

- connected stone strings;
- liberties каждой string;
- connected empty regions;
- boundary groups и boundary colors каждого empty region;
- `vitalGroups` ordinary empty region — groups, смежные с каждой empty point этого region; это general structural relation, но **не** замена Benson color-region semantics;
- `stringByPoint` и `regionByPoint`;
- direct opponent adjacency;
- shared liberties между strings;
- candidate friendly connections;
- connected conflict components с обеими сторонами, их regions/shared-liberty/connection relations.

Весь correctness path использует только logical point identity/occupancy и `Topology.neighbors()`.

## 40.2. Connection и complexity decision

В Work 2 был отдельно отклонён опасный вариант «считать possible connection для каждой пары дружественных groups, которые просто граничат с одним большим empty region».

Такой вариант одновременно:

- создаёт false connection candidate для strings, находящихся на разных концах большой пустой области;
- создаёт потенциальный `O(k²)` all-pairs pass по числу boundary groups region.

Принятая Work 2 semantics:

```text
friendly connection candidate
=
same-color strings with an actual shared liberty
```

`viaRegions` выводится из `regionByPoint` для этих shared liberties.

Pair enumeration при построении shared liberties выполняется локально вокруг одной empty point. Для production Cube/Torus topology степень logical point ограничена четырьмя соседями, поэтому этот локальный pair work имеет постоянную верхнюю границу; базовые graph traversals остаются линейными относительно размера logical graph с детерминированной canonical sorting на выходе.

## 40.3. Integration with existing classifier

`AssistedEndgameClassifier` больше не строит собственные параллельные maps strings/liberties/empty regions.

Один `buildEndgameGraph(...)` snapshot теперь используется для:

- Benson/pass-alive как authoritative source strings/liberties/point ownership; Benson-specific non-color regions являются derived projection, а не вторым stone index;
- automatic dead candidate/verifier context;
- automatic seki candidate/verifier context.

Старый partial-analysis fail-safe сохранён: если analysis context не описывает все logical strings текущей позиции, automatic proof не запускается и baseline остаётся unresolved/manual-compatible.

Proof semantics пользовательского classifier в Work 2 намеренно не расширялись: этап стабилизирует structural foundation, а не добавляет новые `alive/dead/seki` правила.

## 40.4. Acceptance tests

Зафиксированы отдельные deterministic tests:

1. stone string через Torus seam;
2. empty region через Torus seam;
3. stone string через Cube face edge;
4. empty region через Cube face edge;
5. direct opposing-string adjacency без duplicate relation;
6. shared liberties, same-color connection candidate и multi-color conflict component на маленьком arbitrary graph fixture;
7. negative case: две friendly strings на разных концах одного connected empty region не считаются connection candidate без shared liberty;
8. exact graph-isomorphism test: после произвольного чистого переименования `PointId` нормализованный полный graph snapshot совпадает, включая mappings/regions/relations/conflict components;
9. invalid board без occupancy для topology point fail-closed.

Renderer/presentation geometry не импортируется production graph core и не используется тестами как источник semantic adjacency.

## 40.5. Validation boundary

Work 2 validation выполняется на PR #146 в ветке `engine-work2-graph-core`.

До documentation closure code-head прошёл:

- lint — pass;
- typecheck — pass;
- unit/coverage — pass;
- build — pass.

Full Playwright остаётся обязательной проверкой final exact PR head перед merge. Если повторится ранее изолированный WebKit race `torus-pan-animation.spec.ts`, он должен рассматриваться отдельно и не должен исправляться изменением Torus production code ради Engine Work 2.

## 40.6. Closure

Work 2 закрывает Stage A foundation:

- одна topology-neutral representation вместо дублирующих private indexes;
- Cube/Torus boundary adjacency покрыта для stones и empty regions;
- graph-isomorphism является explicit acceptance invariant;
- conflict/shared-liberty/connection relations доступны дальнейшим proof layers;
- renderer geometry отсутствует в correctness dependency chain;
- внешний solver/Board не введён в production foundation.

Work 3 использует этот snapshot как единственный source stone-string/liberty/point ownership; отдельная Benson non-color projection допустима только потому, что она имеет другую semantics, чем general empty-region graph.

---

# 41. Work 3 — Benson hardening: финальный результат

Срез на **2026-08-23**. **Work 3 закрыт.** Старый локальный Benson helper удалён из `AssistedEndgameClassifier`; pass-alive proof вынесен в отдельный topology-neutral `BensonPassAlive` module и сверён с Moka semantics.

## 41.1. Moka/Benson semantic decision

Главное исправление Work 3 — не считать ordinary empty component эквивалентом Benson region.

Для анализируемого цвета `C` production semantics теперь такие:

```text
Benson non-color region(C)
=
connected component of points with occupancy != C
```

То есть в один region входят:

- empty points;
- opponent stones;
- связи между ними через `Topology.neighbors()`.

Opponent stones участвуют в connectivity, но vital relation строится только по empty points: group является vital для region, только если она adjacent к каждой empty point этого region. Region без empty points не даёт vital proof.

Это соответствует проверенной структуре Moka `getNonColorRegions()` / `getPassAliveAnalysis()` и устраняет прежнее скрытое предположение «Benson region = empty region, окружённый одним цветом».

## 41.2. Structural boundary

Work 3 не создаёт второй stone-group/liberty engine.

`EndgameGraphCore` остаётся единственным source для:

- stone strings;
- string colors;
- liberties;
- `stringByPoint` / `stringsByKey` identity.

`BensonPassAlive` строит только algorithm-specific color-region projection из `BoardOccupancy + Topology.neighbors()` и проверяет boundary group identity через общий graph snapshot.

Это намеренное разделение:

```text
EndgameGraphCore.emptyRegions
!=
Benson color-specific non-color regions
```

Пытаться хранить их как одну структуру было бы semantic bug: opponent stone должен разрывать ordinary empty region, но должен оставаться частью non-color connectivity для противоположного Benson color.

## 41.3. Fixed-point proof

Для каждого цвета:

1. берутся все strings этого цвета из `EndgameGraphCore`;
2. строятся color-specific non-color regions;
3. для каждого region фиксируются boundary groups и vital groups;
4. group удаляется, если у неё меньше двух surviving vital regions;
5. region удаляется, если он граничит с group, удалённой на этой итерации;
6. цикл продолжается до fixed point;
7. только surviving groups получают automatic `alive`.

Diagnostic evidence id намеренно остаётся `benson-pass-alive-v1`: Work 3 исправляет implementation semantics, но не создаёт новый внешний evidence contract.

Dead/seki verifier’ы не менялись: они получают обновлённый `passAliveGroupKeys` от hardened Benson.

## 41.4. Acceptance

Добавлены отдельные deterministic Work 3 tests:

1. Moka-parity case, где каждый Benson region содержит opponent stone: black group получает два distinct vital non-color regions и pass-alive proof;
2. one-eye case не получает proof;
3. false-eye-like case: две empty pockets, соединённые через opponent stone, становятся **одним** non-color region и не дают ложной two-region life;
4. Torus seam placement проверяет тот же proof signature, что interior placement;
5. Cube face-edge placement проверяет тот же proof signature, что interior placement.

Существующий classifier regression corpus дополнительно подтверждает:

- deterministic two-eye fixture proven alive на Torus и Cube;
- one-eye / false-eye / seki-like fixtures остаются unresolved;
- Benson fixed point удаляет зависимые regions/groups до стабильности;
- partial analysis context остаётся fail-closed;
- automatic dead boundary продолжает требовать opponent pass-alive proof.

## 41.5. Validation

Code-head `56ba426b39a572b78167abddffc1069c37c78f41` на PR #147 прошёл CI run #676:

- lint — pass;
- typecheck — pass;
- unit/coverage — **531 tests pass**;
- build — pass;
- Playwright E2E — pass.

Первый Work 3 CI run #673 был красным только из-за двух stale test expectations на временный diagnostic id `benson-pass-alive-v2`; сами новые Benson tests, typecheck и classifier tests уже проходили. Evidence id после этого сохранён как стабильный `benson-pass-alive-v1`, новый lint-warning удалён, run #676 полностью зелёный.

Final documentation head должен пройти тот же PR CI перед merge.

## 41.6. Closure

Work 3 закрывает Stage B hardening:

- Moka/Benson non-color semantics адаптирована без rectangular geometry;
- ordinary empty regions больше не используются как Benson-equivalent abstraction;
- proof остаётся topology-neutral через `Topology.neighbors()`;
- Work 2 graph остаётся единственным source stone-string/liberty identity;
- negative false-eye/one-eye boundaries сохранены conservative;
- diagnostic contract `benson-pass-alive-v1` сохранён;
- dead/seki proof layers не расширялись этим Work.

**Следующий этап — Work 4: Tactical Reader.**

---

# 42. Work 4 — Tactical Reader: финальный результат

Срез на **2026-08-23**. **Work 4 закрыт.** Добавлен topology-neutral bounded tactical reader, который использует `GameEngine.placeStone()` как единственный источник legal move / capture / suicide / simple-ko semantics и не вводит отдельную Board/rules implementation.

## 42.1. Production proof boundary

Reader фиксирует исходные `crucialStones` target и решает короткую forced-capture задачу как AND/OR search:

```text
attacker = OR
  достаточно одного доказанного kill continuation

defender = AND
  kill доказан только если каждая допустимая защита проигрывает
```

Поддерживаются deterministic depth/node budgets и raw outcomes:

```text
proved-kill
proved-survival
ko-dependent
unknown-budget
unknown-depth
unknown-boundary
unknown-cycle
```

Failure to find a kill через selective attacker move generation не считается proof survival; такой путь остаётся `unknown-boundary`/другим conservative unknown.

Classifier integration Work 4 намеренно узкая: новый tactical proof рассматривает contested unresolved strings с двумя liberties и повышает их до automatic `dead` только если **оба** запуска — attacker-first и defender-first — возвращают `proved-kill`. Existing Benson, sealed single-liberty verifier и seki evidence contracts остаются самостоятельными и не заменены.

## 42.2. Ko hardening

Найденный риск состоял в том, что terminal capture мог выглядеть как обычный kill, хотя восстановление исходной occupancy зависело от немедленного recapture, запрещённого simple-ko repetition rule.

Принята fail-closed semantics:

1. после terminal target capture reader проверяет legal target-color recaptures через authoritative `GameEngine`;
2. проверка получает `previousBoard` из позиции непосредственно перед capture;
3. если существует restoring recapture, который отвергается именно как `repetition`, terminal result становится `ko-dependent`, а не `proved-kill`;
4. `verifyTacticalDead()` никогда не возвращает `proven: true`, если любой обязательный first-player proof остаётся ko-dependent;
5. `AssistedEndgameClassifier` не повышает такую target group до automatic `dead`.

Это соответствует общему правилу раздела 22:

```text
KO_DEPENDENT -> unresolved
```

Work 4 не пытается решать global ko threats, positional history или multi-ko; такие задачи остаются за пределами current tactical proof boundary.

## 42.3. Regression coverage

TacticalReader deterministic corpus теперь покрывает:

- immediate capture даже при defender-first;
- legal atari escape;
- short forced capture;
- ladder;
- net move вне текущих target liberties;
- snapback с defender counter-capture sacrificial stone;
- counter-capture defense, которая предотвращает ложный `dead`;
- open escape boundary -> unresolved/not-dead;
- `KO_DEPENDENT`, где restoring recapture находится не на attacker capture point;
- classifier regression: ko-dependent target существует, но `status !== dead`;
- отдельный non-ko two-liberty classifier fixture подтверждает, что conservative ko hardening не уничтожил настоящий automatic tactical `dead`.

Положительный classifier fixture специально построен так, чтобы две target liberties принадлежали одной Benson non-color области через opponent stone. Это не позволяет Benson раньше tactical reader ошибочно забрать case как pass-alive и одновременно исключает simple-ko restoration после multi-stone capture.

## 42.4. Validation history

Во время hardening два красных CI дали полезные semantic regressions, а не были обойдены изменением expectations:

1. прежний 3×3 positive integration fixture после ko hardening стал `unresolved`: анализ показал, что ожидаемый «forced dead» фактически зависел от restoring ko recapture. Fixture был исключён из positive proof и сохранён как отдельный ko regression;
2. первая replacement topology случайно создала две Benson vital regions и корректно получила `alive`; fixture снова был исправлен, чтобы проверять именно Tactical Reader, а не конфликтовать с Benson semantics.

После второй корректировки code-head `7d4a0e1f7aa305382ff8aaee5433e2409ba98e11` прошёл CI run #711 полностью:

- lint — pass;
- typecheck — pass;
- unit/coverage — pass;
- build — pass;
- Playwright E2E — pass.

Final documentation head обязан пройти новый зелёный PR CI перед merge.

## 42.5. Closure

Work 4 закрывает первый production tactical layer:

- короткие capture/escape/ladder/net/snapback/counter-capture sequences читаются topology-neutral;
- legal transitions остаются полностью authoritative через project `GameEngine`;
- proof требует defender completeness в исследуемом bounded scope;
- selective search и resource/boundary uncertainty fail closed;
- ko-dependent capture теперь имеет отдельный raw outcome и не может породить false automatic `dead`;
- classifier сохраняет положительный non-ko automatic tactical-dead path;
- Work 5 relevance-zone/connection semantics намеренно не введены преждевременно.

**Work 5 продолжен как отдельные Work 5A / 5B / 5C; Work 5A закрыт в разделе 43.**

---

# 43. Work 5A — Relevance Zone Core: финальный результат

Срез на **2026-08-23**. **Work 5A закрыт.** Реализован первый topology-neutral localisation layer. Он только строит и сертифицирует локальную область задачи; Safe Connection и Cut proof намеренно не входят в этот этап.

## 43.1. Production localisation boundary

`RelevanceZone` строится поверх существующих `EndgameGraphCore` и hardened `BensonPassAlive`, без второй Board/group implementation и без renderer geometry.

Для single-target Work 5A dependency closure работает консервативно:

1. начинает с полной target string;
2. для каждой non-safe string включает все её stones;
3. включает **direct tactical stone contacts** через `Topology.neighbors()` — в частности, непосредственно соприкасающуюся opposing string нельзя потерять только потому, что между группами нет empty point;
4. из liberties string переходит в соответствующие ordinary `EndgameGraphCore.emptyRegions` и включает region целиком;
5. из полного empty region включает все его boundary strings;
6. повторяет expansion до closure;
7. Benson/pass-alive string считается текущей доказанной separator boundary: её stones входят в zone, но expansion не продолжается через её внешние liberties или внешние tactical contacts.

Таким образом Work 5A не пытается угадать arbitrary fixed radius. Зона выводится из graph dependencies и proven-safe separators.

Текущий deterministic safety budget:

```text
maxPoints = 96 by default
```

Это engineering safety limit текущего Work 5A, а не окончательный browser-performance contract; будущая настройка остаётся benchmark-driven.

Если closure:

- превышает `maxPoints`;
- охватывает весь logical topology graph, то есть фактически перестаёт быть локальной;
- или supplied target identity больше не соответствует board snapshot,

результат только:

```text
outcome = unknown-boundary
```

Ни один такой case не превращается в `alive`, `dead` или `seki`.

## 43.2. Outside-invariance certificate

Для bounded zone возвращается `localPositionKey`:

```text
topology.id
+ targetGroupKey
+ occupancy всех zone points
+ boundarySafeGroupKeys
```

Outside occupancy намеренно не входит в этот key.

Главный Work 5A metamorphic invariant проверяется сильнее, чем простым сравнением enum: если occupancy меняется далеко за доказанной и **не изменившейся** Benson-safe boundary, builder должен вернуть exact тот же bounded `RelevanceZoneResult`, включая:

- `points`;
- `stringKeys`;
- `emptyRegionKeys`;
- `boundarySafeGroupKeys`;
- `localPositionKey`.

Важно различать действительно irrelevant outside change и изменение самого proof boundary. Если внешний ход меняет Benson/pass-alive certificate boundary group, такое изменение больше не считается доказанно irrelevant: zone разрешено расширить или вернуть `unknown-boundary`. Work 5A не утверждает независимость от изменений, которые разрушают собственную локализационную предпосылку.

## 43.3. Regression coverage

Добавлен deterministic arbitrary-graph corpus, который проверяет именно topology semantics, а не rectangular coordinates:

1. bounded local problem, закрытый Benson-alive string;
2. exact equality bounded result после far-away occupancy mutation за той же safe boundary;
3. direct opponent contact входит в closure и не становится ложной границей;
4. open dependency chain, которая охватывает весь topology graph, -> `unknown-boundary`;
5. deterministic `maxPoints` overflow -> `unknown-boundary`;
6. stale/mismatching target identity -> `unknown-boundary`.

Прямой contact regression добавлен отдельно после проверки design: closure только через empty regions была бы неполной для двух непосредственно соприкасающихся strings и могла бы ложно объявить boundary раньше реального tactical interaction.

## 43.4. Integration boundary

Work 5A намеренно **не** подключает новый result к automatic classifier и не меняет Work 4 Tactical Reader outcome semantics.

На этом этапе `RelevanceZone` является подготовительным correctness primitive для следующих readers:

```text
bounded zone
  -> Work 5B Safe Connection
  -> Work 5C simple Cut / hardening
  -> later local L&D search
```

Поэтому Work 5A сам не создаёт новый proof вида `PROVEN_ALIVE` или `PROVEN_DEAD`. Если локализация не доказана, consumer обязан fail closed через `UNKNOWN_BOUNDARY`/unresolved semantics.

## 43.5. Validation

Code-head `cfe84fc40452fd69d50d693863d086ddbb3f3535` на PR #156 прошёл CI run #722 полностью:

- lint — pass;
- typecheck — pass;
- unit/coverage — pass;
- build — pass;
- Playwright E2E — pass.

Final documentation head должен пройти новый полный PR CI перед acceptance Work 5A.

## 43.6. Closure

Work 5A закрывает только localisation foundation:

- dependency closure topology-neutral;
- direct stone contacts не теряются;
- Benson-alive groups используются как доказанные separators;
- far-away occupancy за неизменившейся safe boundary не меняет bounded result;
- open/global/budget/stale-target cases fail closed как `unknown-boundary`;
- user-facing classification не расширена.

Продолжение Work 5 закрыто отдельно в разделах 44 и 45.

---

# 44. Work 5B — Safe Connection: финальный результат

Срез на **2026-08-23**. **Work 5B закрыт.** Реализован intentionally narrow topology-neutral connection proof поверх Work 5A `RelevanceZone`, Work 3 Benson/pass-alive certificate и authoritative legal-move semantics `GameEngine`.

## 44.1. Accepted proof boundary

Production proof имеет evidence id:

```text
algorithm = safe-connection-v1
proof = miai-two-shared-liberties-to-benson
```

Для automatic `alive` одновременно требуются:

1. `RelevanceZone` target group имеет outcome `bounded`;
2. same-color friendly string на boundary имеет действующий Benson/pass-alive proof;
3. target и эта Benson-alive string имеют минимум две **actual shared liberties** из `EndgameGraphCore.possibleConnections` внутри zone;
4. оба connector moves target являются legal quiet non-capturing direct connections по `GameEngine`;
5. для пары connectors проверены обе прямые defender orders: block first connector -> connect second и block second connector -> connect first;
6. legal defender block с capture или response, требующий capture/fight, не принимается этим proof и оставляет result `not-proven`.

Одна shared liberty недостаточна. Capture, sacrifice, multi-step cut, deeper fight и иные более сложные connection shapes намеренно не входят в Work 5B.

## 44.2. Defender completeness узкого miai-theorem

Пусть `c1` и `c2` — две distinct shared liberties target и Benson-alive friendly string.

Если defender ходит **не** в `c1` и не в `c2`, обе точки остаются пустыми. Target может сыграть в любую из них и непосредственно соединиться с Benson-alive string; вторая shared liberty остаётся liberty уже объединённой группы. Поэтому такой внешний one-ply defender move не может разрушить theorem.

Единственные one-ply defenses, которые непосредственно удаляют один из двух connector, — ходы в `c1` или `c2`. Verifier симулирует обе orders через authoritative `GameEngine`. Illegal blocker не является допустимой защитой. Если blocker создаёт capture/fight semantics либо ответ перестаёт быть quiet direct connection, proof fail-closed и не выдаётся.

Ko/history не используется как optimistic shortcut. Target response принимается только как non-capturing move в ранее пустой connector, поэтому такой ход не является restoring simple-ko recapture. Для defender synthetic check отсутствие historical ko restriction консервативно: потенциально исторически запрещённый block может быть рассмотрен как legal и только лишить proof, но не создать ложный automatic `alive`.

Любой `maxPoints` overflow, whole-board localisation или другой `RelevanceZone` failure как есть распространяется как `unknown-boundary`.

## 44.3. Classifier integration

`AssistedEndgameClassifier` запускает Safe Connection только для unresolved string, которая уже имеет structural candidate shared-liberty connection к Benson/pass-alive group.

Разрешение происходит в порядке:

```text
Benson alive
-> Safe Connection alive
-> existing dead proofs
-> bounded tactical dead
-> existing seki proof
-> unresolved
```

Safe-connected group **не добавляется** обратно в `passAliveGroupKeys`, не становится новым Benson/RelevanceZone separator и не используется как transitive safe anchor в этом этапе. Это сохраняет proof strength Benson boundary и не превращает простой Work 5B theorem в недоказанную цепочку connections.

## 44.4. Regression / acceptance coverage

Отдельный deterministic arbitrary-graph corpus проверяет:

1. positive quiet two-shared-liberty miai connection к Benson-alive group;
2. exact equality connection proof после irrelevant far-away occupancy mutation за той же safe boundary;
3. one-shared-liberty negative case -> `not-proven`;
4. RelevanceZone `maxPoints` overflow -> `unknown-boundary`;
5. whole-board/open localisation -> `unknown-boundary`;
6. assisted classifier действительно повышает только proven target до automatic `alive` с `safe-connection-v1` evidence.

Общий deterministic endgame hardening corpus также знает новый automatic evidence id и продолжает проверять proposal/scoring invariants.

## 44.5. Validation

Code-head `a394ab4305252ec6362926c59f1fc1c215c108c5` на PR #159 прошёл полный CI run #738:

- lint — pass;
- typecheck — pass;
- unit/coverage — **553 tests pass**;
- build — pass;
- full Playwright E2E — pass.

Поскольку PR #159 был stacked в Work 5A branch, а не напрямую в `engine`, final integrated acceptance Work 5B выполняется также в PR #161 вместе с Work 5C.

## 44.6. Closure

Work 5B закрывает только простой доказанный Safe Connection:

- bounded localisation обязательна;
- proof anchor остаётся Benson/pass-alive group;
- две shared liberties дают проверяемый miai theorem;
- обе direct defender cuts проверяются authoritative rules engine;
- one-liberty, boundary/budget uncertainty и fight/capture variants не повышаются до `alive`;
- safe-connected groups не становятся новыми transitive safe boundaries.

Work 5C добавляет симметричный узкий cut fact и финально закрывает Work 5.

---

# 45. Work 5C — Cut + hardening: финальный результат

Срез на **2026-08-23**. **Work 5C закрыт; исходный Work 5 закрыт целиком.** Добавлен topology-neutral attacker-first cut proof поверх той же Work 5A Relevance Zone и authoritative `GameEngine` transitions.

## 45.1. Accepted cut proof boundary

Production fact имеет ids:

```text
algorithm = simple-cut-v1
proof = single-shared-liberty-benson-block
```

Proof выдаётся только если одновременно выполняются все условия:

1. target `RelevanceZone` доказанно `bounded`;
2. target сам не Benson/pass-alive;
3. target имеет ровно одну actual shared liberty с same-color Benson/pass-alive boundary group;
4. эта cut point находится внутри certified zone;
5. attacker legal ходом `GameEngine.placeStone()` занимает cut point без capture;
6. исходная target structure и исходная safe structure после хода обе сохраняются и остаются разными strings;
7. между ними больше нет direct shared-liberty `possibleConnection`;
8. attacker blocker, содержащий cut point, после хода сам имеет Benson/pass-alive proof.

Это намеренно сильнее, чем визуальное «attacker поставил камень между группами». Нестабильный blocker не считается доказанным cut, потому что немедленная локальная борьба может восстановить connection. Capture, sacrifice, ko-dependent restoration, multi-step cut и deeper fight не анализируются Work 5C и остаются `not-proven`/scope последующего search.

Cut proof является **Connection Reader fact**, а не life/death verdict:

```text
simple-cut-v1 != PROVEN_DEAD
```

Поэтому Work 5C намеренно не добавляет classifier path, который повышал бы target до automatic `dead` только из факта cut.

## 45.2. Fail-closed hardening

Зафиксированы основные отрицательные границы:

- две shared liberties -> simple one-point cut не доказан, потому что сохраняется alternate connector;
- legal cut move с capture -> не принимается этим quiet theorem;
- legal quiet block, который после хода не Benson/pass-alive -> не принимается как stable proven cut;
- stale/global/open/budget localisation -> `unknown-boundary`, а не positive cut;
- изменение за неизменившейся Benson-safe boundary не должно менять local proof certificate.

Это сохраняет общий Work 5 invariant: все новые connection/cut facts зависят только от доказанной bounded zone и не превращают неполный tactical search в automatic status.

## 45.3. Regression / acceptance coverage

`SimpleCut.test.ts` содержит семь targeted arbitrary-graph regressions:

1. positive quiet single-shared-liberty cut, где blocking attacker string после хода Benson-alive;
2. exact equality cut proof после irrelevant far-away mutation за неизменившейся safe boundary;
3. two-connectors negative case;
4. unstable non-Benson blocker negative case;
5. capture-on-cut negative case;
6. deterministic `maxPoints` overflow -> `unknown-boundary`;
7. whole-board/open localisation -> `unknown-boundary`.

Эти tests дополняют шесть Safe Connection regressions Work 5B и Relevance Zone corpus Work 5A.

## 45.4. Integrated validation

Первый integrated code-head `5978908f729dfc71e8d331e19b0dd8b882421d4a` на PR #161 прошёл CI run #745:

- lint — pass (два существующих non-blocking warnings вне Work 5 scope);
- typecheck — pass;
- unit/coverage — **560 tests pass**;
- build — pass;
- Chromium Playwright — **72/72 pass**.

После добавления отдельного unstable-blocker regression code-head стал `05291cd2bd562527babaae13e410baf143b2d4da`; final PR title переведён в `[full]`, чтобы exact documentation head прошёл полный multi-browser CI перед merge/acceptance.

## 45.5. Final Work 5 acceptance

Исходный Work 5 теперь состоит из трёх закрытых proof layers:

```text
5A Relevance Zone
  proves locality or UNKNOWN_BOUNDARY

5B Safe Connection
  proves narrow forced connection to Benson-safe group
  -> automatic alive only for the proven target

5C Simple Cut
  proves narrow stable attacker-first disconnection fact
  -> never automatic dead by itself
```

Общие invariants Work 5:

- topology-neutral через `Topology.neighbors(PointId)`;
- legal transitions только через authoritative `GameEngine`;
- Benson/pass-alive остаётся единственным safe boundary/anchor данного scope;
- far-away changes за неизменившейся certified boundary не меняют local proof;
- budget/global/boundary uncertainty fail closed;
- Safe Connection не создаёт transitive Benson anchors;
- cut fact не подменяет full life/death proof.

**Work 6A, Work 6B и Work 6C закрыты в разделах 46–48; следующий этап — Work 7: Semeai / Seki.**

---

# 46. Work 6A — AND/OR Search Core: финальный результат

Срез на **2026-08-23**. **Work 6A закрыт.** Реализован generic deterministic proof-search core без Go-specific state transitions, life/death terminals и classifier integration.

## 46.1. Search contract

`AndOrSearchCore` решает одно абстрактное утверждение с тремя raw outcomes:

```text
proved
refuted
unknown
```

Node semantics:

```text
OR
  proved, если найден хотя бы один proved child
  refuted, только если expansion complete и все children refuted

AND
  refuted, если найден хотя бы один refuted child
  proved, только если expansion complete и все children proved
```

Именно `complete` является safety boundary для будущего Go move generation. Если consumer знает только часть legal/relevant continuations, core не делает вид, что остальные отсутствуют.

## 46.2. Fail-closed incomplete semantics

Приняты две критические асимметрии:

- incomplete AND node **не может** стать `proved`, потому что непросмотренная defense branch потенциально может refute proof;
- incomplete OR node **не может** стать `refuted`, потому что непросмотренная attack branch потенциально может prove objective.

При этом безопасные one-sided результаты остаются допустимы:

- OR может стать `proved` сразу после одного proved child даже при `complete: false`;
- AND может стать `refuted` сразу после одного refuted child даже при `complete: false`.

Это structural basis для Work 6B acceptance invariant «непросмотренная defense не может создать ложный `dead`».

## 46.3. Transposition, cycles и budgets

Transposition key полностью принадлежит caller adapter и должен включать весь game-theoretic context, который влияет на future legality/outcome. Core дополнительно разделяет cache entries по AND/OR node type.

В transposition table кешируются только resolved outcomes:

```text
proved
refuted
```

Не кешируются:

```text
unknown/budget
unknown/incomplete
unknown/cycle
```

Поэтому результат, оборванный resource limit или path-cycle, не может позже маскироваться под proof.

Node budget deterministic и считает только новые non-transposition nodes, допущенные к evaluation. При exhaustion result только:

```text
unknown
reason = budget
```

Unresolved active-path repetition не получает guessed fixed point:

```text
unknown
reason = cycle
```

## 46.4. Deterministic proof trace

Core сохраняет caller-defined child order и возвращает immutable trace для реально исследованной части DFS.

Trace различает source:

```text
expanded
terminal
transposition
budget
cycle
```

Для каждого explored edge фиксируются move label, child outcome, unknown reason и nested trace. Short-circuit OR/AND поэтому остаётся observable и deterministic при одинаковых adapter/key/move-order inputs.

## 46.5. Regression coverage

`AndOrSearchCore.test.ts` содержит семь targeted tests:

1. deterministic OR DFS order и stable proof trace;
2. AND требует все continuations и reuse resolved transposition;
3. incomplete AND/OR fail closed;
4. one-sided proof/refutation остаются допустимы при incomplete expansion;
5. exact node-budget exhaustion даёт deterministic `unknown/budget`;
6. unresolved cycle даёт `unknown/cycle`;
7. invalid/non-integer node budgets отвергаются.

Эти tests intentionally используют маленький abstract graph adapter и не проверяют Go rules — это scope Work 6B.

## 46.6. Validation boundary

Code-head `b2f105feefdb492f3fc58e410effb561944a77f8` на PR #163 прошёл CI run #754:

- lint — pass, только два существующих non-blocking warnings вне Work 6A scope;
- typecheck — pass;
- unit/coverage — **568/568 tests pass**;
- `AndOrSearchCore.ts` coverage — 98.64% statements / 97.61% branches / 100% functions / 98.59% lines;
- build — pass;
- Chromium Playwright — **72/72 pass**.

Final documentation head должен пройти новый `[full]` PR CI перед merge.

## 46.7. Closure

Work 6A намеренно не решает ни одного реального tsumego и не меняет automatic classifier.

Закрыты только механические correctness properties search shell:

- deterministic AND/OR DFS;
- resolved-only TT;
- deterministic resource exhaustion;
- explicit expansion completeness;
- deterministic proof trace;
- fail-closed cycles/incomplete branches.

**Work 6B закрыт в разделе 47; Work 6C закрыт в разделе 48; следующий этап — Work 7: Semeai / Seki.**

---

# 47. Work 6B — Local Life/Death Proofs: финальный результат

Срез на **2026-08-23**. **Work 6B закрыт.** Добавлен `LocalLifeDeathReader`, который связывает generic Work 6A AND/OR core с authoritative Go transitions внутри Work 5A bounded `RelevanceZone`. Classifier integration этим этапом намеренно не добавлялась.

## 47.1. Local proof contract

Search запускается только если исходная target group имеет certified bounded `RelevanceZone`. Исходные target stones фиксируются как `crucialStones`, поэтому target identity сохраняется через friendly merges и defender extensions.

Для каждой позиции:

```text
attacker to move = OR
  достаточно одного proved-dead continuation

defender to move = AND
  dead доказан только если каждый legal relevant continuation proved-dead
```

Move generation complete-enough внутри certified scope:

- перебираются все empty points исходной bounded zone;
- legality, capture, suicide и simple-ko transition выполняются только через `GameEngine.placeStone()`;
- child ordering deterministic и не влияет на proof semantics;
- отдельная `tenuki` branch моделирует local pass или ход вне certified zone, который не меняет local occupancy по Work 5A locality certificate;
- если после local transition актуальная dependency zone перестаёт быть bounded subset исходной certified zone, continuation становится explicit `unknown-boundary`, а не silently omitted move.

Terminal facts:

```text
all original crucial target stones captured -> proved-dead objective
current target group Benson/pass-alive       -> proved-alive / refuted kill
```

Benson здесь является proof terminal, а не новым transitive boundary rule. Failure to reach Benson не считается proof death, а failure to find capture не считается proof life.

## 47.2. First-player orders and fail-closed semantics

Reader всегда решает две постановки отдельно:

```text
attacker-first
defender-first
```

Overall result:

```text
both proved-dead  -> proved-dead
both proved-alive -> proved-alive
anything else     -> unknown
```

Таким образом defender-first AND branch не может породить `dead`, пока существует хотя бы одна legal defense, которая не доказана проигрывающей. Work 6A incomplete semantics дополнительно гарантирует, что explicit unknown branch не подменяется отсутствующим child.

Ko не используется как optimistic proof. Если legal local move создаёт immediate simple-ko restoration, проверяемую через authoritative repetition semantics, continuation становится `ko-dependent`. Global ko-threat solving в Work 6B не выполняется.

Resource semantics:

- deterministic `maxNodes` применяется отдельно к каждому first-player search; current default `10_000`;
- exact exhaustion -> `unknown-budget`;
- Work 5A `maxZonePoints` current default `96`;
- unbounded/global/stale localisation -> `unknown-boundary` до search;
- unresolved cycle/incomplete branch остаются соответствующим `unknown`;
- timeout/budget никогда не преобразуется в `proved-alive`, а boundary/ko uncertainty никогда не преобразуется в `proved-dead`.

Transposition key включает исходный local certificate, mover, local occupancy и ko-context, чтобы resolved-only Work 6A TT не смешивал позиции с различной future legality.

## 47.3. Regression / acceptance coverage

`LocalLifeDeathReader.test.ts` содержит шесть targeted deterministic tests:

1. маленькая enclosed two-point false-eye / nakade-like target доказывается `dead` и при attacker-first, и при defender-first;
2. уже Benson/pass-alive target является доказанным survival terminal в обоих orders;
3. defender move, соединяющий target с Benson-alive friendly group, реально присутствует в generated tree и запрещает ложный overall `dead`;
4. `maxNodes = 0` даёт `unknown-budget`, а не ложный `alive` даже для позиции с доступным alive terminal;
5. unbounded Relevance Zone fail closed до search как `unknown-boundary`;
6. immediate capture, создающий simple ko, остаётся `ko-dependent`/overall `unknown`.

Эти tests намеренно являются первым малым 6B corpus. Standard tsumego subset, adversarial breadth, far-away proof invariance, dedicated proof-trace determinism/performance regressions и classifier integration остаются Work 6C.

## 47.4. Validation boundary

Code-head `fea58f917378b4af6099467ed41d0c301558064e` на PR #165 прошёл standard CI run #759:

- lint — pass, только два существующих non-blocking warnings вне Work 6B scope;
- typecheck — pass;
- unit/coverage — **574/574 tests pass**;
- `LocalLifeDeathReader.test.ts` — **6/6 pass**;
- build — pass;
- Chromium Playwright — **72/72 pass**.

Work 6B не запрашивал Full CI; multi-browser hardening относится к отдельному acceptance scope, если будет явно выбран для Work 6C/final release gate. Final documentation head должен пройти новый standard PR CI перед merge.

## 47.5. Closure

Work 6B закрывает первый настоящий bounded local life/death proof layer:

- Go transitions authoritative через project `GameEngine`;
- bounded locality authoritative через Work 5A `RelevanceZone`;
- generic search semantics остаются Work 6A `AndOrSearchCore`;
- local legal placements и pass/tenuki представлены явно;
- оба first-player orders обязательны для final `proved-dead`/`proved-alive`;
- capture и Benson/pass-alive являются текущими proof terminals;
- ko, boundary, budget, cycle и incomplete uncertainty fail closed;
- ни один Work 6B result пока не подключён к automatic classifier.

**Work 6C закрыт в разделе 48; следующий этап — Work 7: Semeai / Seki.**

---

# 48. Work 6C — Hardening + classifier integration: финальный результат

Срез на **2026-08-23**. **Work 6C закрыт.** Work 6B `LocalLifeDeathReader` получил отдельный deterministic hardening layer и теперь консервативно используется `AssistedEndgameClassifier` после существующих cheap proofs и до seki analysis.

## 48.1. Hardening corpus и correctness boundary

Новый `LocalLifeDeathReader.hardening.test.ts` содержит семь targeted tests. Первый frozen known-answer subset намеренно topology-neutral и представляет elementary tsumego-equivalent local graphs, а не новый rectangular rules engine.

Покрыто:

1. enclosed local death с 2, 3 и 4 liberties: attacker-first и defender-first независимо доказывают `proved-dead`;
2. Benson/pass-alive boundary group как стабильный `proved-alive` reference terminal;
3. adversarial case, где attacker-first доказывает death, но defender-first legal connection к Benson-safe friendly group доказывает survival; overall остаётся `unknown`;
4. far-away occupancy mutation за неизменившейся safe boundary сохраняет exact `RelevanceZoneResult`, attacker-first search result и defender-first search result;
5. повторные reads одной позиции возвращают exact одинаковые proof traces;
6. exact deterministic node threshold сохраняет proof, а budget на один node меньше даёт `unknown-budget` и overall `unknown`;
7. classifier positive/negative integration: fully proved local death становится automatic `dead`, mixed first-player result остаётся exact `unresolved`.

Этот subset является первым frozen elementary L&D acceptance corpus для production reader. Более широкий внешний SGF corpus, oracle differential и массовая coverage evaluation остаются Work 9 и не подменяются hand-authored fixtures.

## 48.2. Classifier integration contract

Production order теперь:

```text
Benson alive
-> Safe Connection alive
-> sealed single-liberty dead proof
-> Work 4 two-liberty TacticalReader dead proof
-> Work 6 LocalLifeDeathReader
-> existing seki proof
-> unresolved
```

Local Life/Death result повышается до automatic status только если overall reader outcome уже полностью доказан:

```text
proved-dead  -> dead
proved-alive -> alive
unknown      -> unresolved
```

Так как Work 6B overall outcome требует совпадающего proof в обоих first-player orders, classifier не интерпретирует mixed/critical result самостоятельно. `unknown-budget`, `unknown-boundary`, `unknown-cycle`, incomplete search и `ko-dependent` могут появиться только внутри overall `unknown` и не повышаются до automatic status.

Classifier evidence сохраняет proof identity `local-life-death-v1`, `crucialStones`, общий `proofReason` и компактные summaries обоих first-player runs (`outcome`, `exploredNodes`, `transpositionHits`). Полные recursive traces остаются reader/test diagnostics и не копируются в каждый user-facing proposal.

## 48.3. Production candidate/performance gate

Первоначальная интеграция запускала `LocalLifeDeathReader` для каждого ещё unresolved group. Первый CI run #783 показал, что такой coverage слишком широк для текущего browser-oriented classifier:

- deterministic Full endgame sweep вышел за существующий 30-second test budget;
- controlled generator больше не мог гарантировать старые intentional two-liberty `unresolved` controls, потому что новый reader начал решать класс, который уже принадлежит Work 4 Tactical Reader.

Timeout не увеличивался, Test Lab expectations не ослаблялись. Вместо этого production search получил узкий candidate gate, который влияет только на cost/coverage, но не является proof:

- target должен оставаться unresolved после Benson / Safe Connection / existing dead / TacticalReader layers;
- target имеет 3 или 4 liberties;
- каждая target liberty непосредственно соседствует с opponent Benson/pass-alive string;
- classifier `maxNodes = 256` отдельно на first-player search;
- classifier `maxZonePoints = 24`.

Reader по-прежнему обязан доказать оба first-player orders внутри bounded Relevance Zone. Candidate gate никогда сам не выдаёт `alive` или `dead`.

1-liberty groups остаются у sealed dead verifier, 2-liberty groups — у Work 4 TacticalReader. Это убирает дублирование expensive search и сохраняет предыдущие deliberate unresolved controls.

## 48.4. Performance regression gate

Correctness/performance test не использует wall-clock как proof boundary. Для frozen 2/3/4-liberty subset проверяется deterministic `exploredNodes < 512` в каждом first-player run.

Отдельный exact-threshold regression вычисляет фактическое число необходимых nodes на frozen 3-liberty case:

```text
maxNodes = requiredNodes     -> proved-dead
maxNodes = requiredNodes - 1 -> unknown-budget / overall unknown
```

Это одновременно фиксирует resource determinism и запрещает будущей оптимизации превращать budget exhaustion в guessed result.

После production gating code-head `374343daedde6caed3d83a50625d300eef6daf06` прошёл standard CI run #785:

- lint — pass, только два существующих non-blocking warnings вне Work 6C scope;
- typecheck — pass;
- unit/coverage — **581/581 tests pass** в 78 test files;
- `LocalLifeDeathReader.hardening.test.ts` — **7/7 pass**;
- `EndgameHardening.test.ts` — pass; основной deterministic Full sweep — **19.741 s**, весь файл — **24.900 s**, то есть снова внутри существующего 30-second budget;
- build — pass;
- Chromium Playwright — **72/72 pass**.

PR переведён в `[full]` перед documentation closure, поэтому exact final documentation head должен пройти полный multi-browser CI перед merge.

## 48.5. Closure

Work 6 теперь закрыт как последовательность:

```text
6A — generic deterministic AND/OR proof-search core
6B — authoritative bounded Go local life/death adapter
6C — hardening, deterministic performance guard и conservative classifier integration
```

Главные invariants после closure:

- candidate logic управляет только приоритетом/cost, не proof semantics;
- legal Go transitions остаются authoritative через `GameEngine`;
- localisation остаётся authoritative через bounded `RelevanceZone`;
- automatic local `dead` / `alive` возможен только после совпадающего proof в обоих first-player orders;
- far-away changes за неизменившейся certified boundary не меняют proof;
- budget, boundary, ko, cycle, incomplete и mixed-order uncertainty остаются `unresolved`;
- ранее принятые Benson / Connection / TacticalReader layers сохраняют свои классы и precedence.

**Следующий этап — Work 7A: Semeai Core.**

---

# 49. Work 7A — Semeai Core: финальный результат

Срез на **2026-08-23**. **Work 7A закрыт.** Добавлен topology-neutral `SemeaiCore` для намеренно узкого класса простых two-group capturing races. Он не решает shared-liberty fight, multi-group semeai или seki и не подключён к production classifier.

## 49.1. Accepted proof boundary

Raw result имеет identity:

```text
algorithm = simple-semeai-v1
proof = all-exclusive-liberty-orders-capture-cleanly
```

Вход — две текущие opposing `EndgameStoneString` из одного board snapshot. Перед любым proof reader заново строит `EndgameGraphCore` и проверяет identity обеих supplied groups; stale group остаётся `unresolved`.

Для пары детерминированно считаются:

```text
leftExclusive
rightExclusive
shared
```

Shared liberties не игнорируются. Они присутствуют в result, но если `shared.length > 0`, Work 7A возвращает:

```text
unresolved
reason = shared-liberties-deferred
```

Именно их решение является scope Work 7B.

Work 7A также fail-closed, если:

- groups одного цвета;
- groups не взаимодействуют ни direct adjacency, ни shared liberty;
- третья stone group касается любой из двух groups или их liberty frontier;
- exclusive-liberty frontiers двух сторон непосредственно взаимодействуют друг с другом;
- один из чистых capture countdowns не проходит authoritative legality/capture checks;
- число exclusive liberties превышает explicit small-race budget, current default `5`.

## 49.2. Clean exclusive-liberty countdown certificate

Для каждой стороны отдельно проверяется утверждение «attacker может последовательно заполнить все текущие exclusive liberties opponent group и получить чистый capture».

Это **не** простой arithmetic liberty count. При числе target liberties до budget reader перебирает все их permutations. Каждый move выполняется только через `GameEngine.placeStone()`.

Для каждой intermediate позиции одновременно требуется:

1. attack move legal;
2. никаких intermediate captures;
3. исходные target stones всё ещё составляют ту же target string;
4. target liberties в точности равны ещё не сыгранным исходным liberties;
5. исходная attacker string не слилась с новой structure и не изменила свой stone set.

На final move требуется:

1. target полностью исчез;
2. именно исходные target stones составляют полный capture set;
3. никаких посторонних stones не захвачено.

Если хотя бы один порядок заполнения не удовлетворяет этому контракту, static countdown не считается доказанным и result остаётся `unresolved`. Capture/sacrifice/connection/approach-move variants тем самым не маскируются под простую гонку и передаются последующим Work stages.

## 49.3. Ko и first-player order

После terminal capture используется та же conservative immediate restoring-ko проверка через authoritative repetition semantics, что и в Tactical Reader. Если target-color recapture восстанавливает предыдущую occupancy и запрещён simple ko, semeai result становится:

```text
ko-dependent
```

а не winner.

Если обе стороны получили clean countdown certificates, Work 7A вычисляет exact capture ply отдельно для двух постановок:

```text
left moves first
right moves first
```

Для стороны, начинающей гонку, capture ply равен `2 * turns - 1`; для второй стороны — `2 * turns`.

Interpretation:

```text
same winner in both orders -> left-wins / right-wins
winner changes with first move -> first-player-dependent
```

`first-player-dependent` является raw semeai fact, а не automatic `dead`, `alive` или `seki`.

## 49.4. Regression coverage

`SemeaiCore.test.ts` содержит восемь targeted deterministic tests:

1. left side с более коротким capture countdown побеждает при обоих first-player orders;
2. symmetric right-side win;
3. equal one-liberty race -> `first-player-dependent`;
4. shared liberty корректно считается, но case остаётся `shared-liberties-deferred`;
5. third-group contact -> `multi-group-interaction` / unresolved;
6. intermediate suicide attack запрещает ложный countdown proof;
7. immediate restoring simple ko -> `ko-dependent`;
8. explicit reduced liberty budget -> `too-many-liberties` / unresolved.

Fixtures topology-neutral и используют arbitrary graph `Topology`; rectangular geometry в semeai correctness path отсутствует.

## 49.5. Validation

Первый code-head `cd4e4ebd30d8f594ff3cfa427b793aaf36aa592d` на PR #170 прошёл standard CI run #792 полностью:

- typecheck — pass;
- unit/coverage — **589/589 tests pass** в 79 test files;
- `SemeaiCore.test.ts` — **8/8 pass**;
- `SemeaiCore.ts` — 90.71% statements / 80.58% branches / 96.77% functions / 96.61% lines;
- build — pass;
- Chromium Playwright — **72/72 pass**.

Run #792 показал один новый non-blocking lint warning на неиспользуемый локальный helper `compareStrings`; helper удалён отдельным cleanup commit без изменения semantics. Exact final documentation head должен пройти новый standard PR CI перед merge.

## 49.6. Integration boundary и closure

Work 7A намеренно **не** меняет `AssistedEndgameClassifier`, automatic group statuses или существующий seki proof.

Закрыт только первый Semeai layer:

- explicit exclusive/shared liberty accounting;
- authoritative clean-capture verification, а не голая формула;
- оба first-player orders;
- stable winner и `first-player-dependent` различаются;
- ko fail closed;
- shared liberties, third groups, changing-liberty fights и oversized races остаются unresolved;
- classifier integration отложена до Work 7D.

**Work 7B закрыт в разделе 50; следующий этап — Work 7C: Basic Seki Proof.**

---

# 50. Work 7B — Shared Liberties + Multi-group Semeai: финальный результат

Срез на **2026-08-23**. **Work 7B закрыт.** Добавлен topology-neutral `SemeaiSearch` / `bounded-semeai-v1`, который переводит deferred shared-liberty и multi-group interaction cases Work 7A в bounded game-theoretic search. Production classifier этим этапом намеренно не менялся.

## 50.1. Accepted proof boundary

Raw result имеет identity:

```text
algorithm = bounded-semeai-v1
proof = bounded-and-or-capture-race
```

Вход остаётся pair-oriented: две текущие opposing target strings. Перед search обе supplied identities сверяются с новым `EndgameGraphCore` snapshot. `stale-group`, `same-color` и `not-interacting` остаются `unresolved`.

Обе target groups получают собственный Work 5A `RelevanceZone`. Search допускается только если обе зоны доказанно `bounded`. Certified Work 7B conflict region определяется как deterministic union двух bounded zones; union также обязан уложиться в `maxZonePoints`.

Текущий default safety boundary:

```text
maxZonePoints = 96
```

Оригинальные stones каждой target фиксируются отдельно как `leftCrucialStones` / `rightCrucialStones`. Это позволяет target расширяться и соединяться в ходе search, не теряя identity исходной capturing race.

Work 7B намеренно не вводит general N-primary-target public API. Две исходные groups являются primary objectives, а любые дополнительные strings внутри certified conflict region — auxiliary interacting groups, которые могут соединяться, захватываться или менять liberty structure в ходе search.

## 50.2. Search semantics

Search формулирует одно симметричное objective:

```text
left side = OR
  доказать force-capture исходного right target

right side = AND
  опровергнуть этот objective, в том числе force-capture исходного left target
```

Terminal facts:

```text
all right crucial stones captured -> proved -> left-wins
all left crucial stones captured  -> refuted -> right-wins
```

На каждом nonterminal node:

- перебираются **все empty points исходной certified union**;
- legal placement / capture / suicide / simple-ko legality выполняются только через authoritative `GameEngine.placeStone()`;
- illegal placements не являются children;
- connection/merge с friendly group, capture соседней auxiliary group и изменение shared/exclusive liberties не отклоняются статически — это обычные authoritative transitions;
- после хода заново строится `EndgameGraphCore`, восстанавливаются текущие target structures по crucial stones и заново строятся обе dependency zones;
- если любой current target больше не имеет bounded zone, либо его current zone выходит за исходную certified union, continuation становится explicit `unknown-boundary`;
- отдельный `tenuki` child моделирует pass / irrelevant outside move: local occupancy не меняется, side-to-move меняется, immediate local ko context снимается.

Work 6A `AndOrSearchCore` остаётся единственным search mechanism: deterministic DFS, resolved-only transposition reuse, explicit incomplete/cycle/budget uncertainty и immutable proof trace.

Текущий default node budget:

```text
maxNodes = 20_000 per first-player order
```

Это Work 7B engineering safety limit, а не финальный production performance contract. Performance/candidate gating относится к Work 7D.

## 50.3. Ko, first-player orders и raw outcomes

После legal local move reader проверяет immediate restoring simple-ko recapture через authoritative repetition semantics с exact previous-board context. Если continuation требует такой ko, она становится explicit `ko-dependent`, а не winner.

Global ko threats, positional-history solving и complex repetition Work 7B не решает.

Reader всегда решает обе постановки независимо:

```text
left moves first
right moves first
```

Per-order outcome:

```text
left-wins
right-wins
ko-dependent
unknown-budget
unknown-boundary
unknown-cycle
unknown-incomplete
```

Pair interpretation:

```text
same proved winner in both orders -> stable left-wins / right-wins
different proved winners           -> first-player-dependent
required simple ko                 -> ko-dependent
anything else                      -> unresolved
```

`first-player-dependent` и `ko-dependent` остаются raw semeai facts. Work 7B не преобразует их в `alive`, `dead` или `seki`.

## 50.4. Regression coverage

`SemeaiSearch.test.ts` содержит семь targeted deterministic tests:

1. shared-liberty race, которую Work 7A оставляет `shared-liberties-deferred`, реально решается search и даёт `first-player-dependent`;
2. shared-liberty race с одной дополнительной liberty у left target доказывает stable `left-wins` при обоих first-player orders;
3. third-group connection interaction, которую Work 7A отклоняет как `multi-group-interaction`, проходит через search как обычная authoritative transition и остаётся game-theoretically first-player-dependent;
4. `maxNodes = 0` даёт `unknown-budget` для обоих orders и общий `unresolved`;
5. conflict region, который нельзя сертифицировать как локальный, возвращает `unknown-boundary` до search;
6. restoring simple-ko capture возвращает `ko-dependent`, а не winner;
7. stale supplied target identity отвергается до search как `unresolved`.

Fixtures используют arbitrary graph `Topology`; rectangular geometry в correctness path отсутствует.

## 50.5. Validation

Code-head `560e6f8e41c03a99b68016bee0c6912c74046293` на PR #172 дважды прошёл Engine-relevant standard CI stages:

- lint — pass; остаются только два прежних non-blocking warning в `TestCaseReplayService.ts`, вне Work 7B scope;
- typecheck — pass;
- unit/coverage — **596/596 tests pass** в 80 test files;
- `SemeaiSearch.test.ts` — **7/7 pass**;
- `SemeaiSearch.ts` coverage — **90% statements / 85.62% branches / 100% functions / 92% lines**;
- build — pass.

Chromium E2E на том же code-head дважды дал **71/72 pass** из-за одного visual timing assertion вне Engine scope: `e2e/duplicate-regions.spec.ts:62` требует computed opacity exact `1`, но во время stone-placement animation получил промежуточное `0.998486`, а на retry — `0.999854`. Work 7B не меняет renderer, animation или этот E2E. Этот unrelated race не исправляется изменением Engine semantics; exact documentation head всё равно получает свой standard CI перед merge.

## 50.6. Integration boundary и closure

После Work 7B разделение остаётся явным:

```text
Work 7A
  cheap exact static proof простых exclusive-liberty races

Work 7B
  bounded game-theoretic search shared-liberty / auxiliary multi-group interactions

Work 7C
  отдельный strict proof basic seki

Work 7D
  adversarial hardening + invariance + budgets + determinism + performance
  + только после этого production classifier integration
```

Главные Work 7B invariants:

- authoritative Go transitions — только `GameEngine`;
- locality — только certified bounded Relevance Zones;
- original target identity — separate crucial-stone sets;
- shared liberties и auxiliary captures/connections являются searchable state transitions, а не static rejection;
- boundary, budget, cycle, incomplete и ko uncertainty fail closed;
- classifier integration отсутствует;
- seki status не выводится из невозможности доказать capture.

**Work 7C закрыт в разделе 51; следующий этап — Work 7D: Hardening + Classifier Integration.**

---

# 51. Work 7C — Basic Seki Proof: финальный результат

Срез на **2026-08-23**. **Work 7C закрыт.** Добавлен отдельный topology-neutral `SekiSearch` / `basic-seki-v1`. Reader использует Work 7B как continuation verifier, но принципиально не интерпретирует `bounded-semeai-v1` outcome `unresolved` как доказательство seki. Production classifier этим этапом намеренно не менялся.

## 51.1. Accepted proof boundary

Raw result имеет identity:

```text
algorithm = basic-seki-v1
proof = every-legal-local-initiation-is-losing
```

Вход остаётся pair-oriented: две текущие opposing target strings. Перед proof обе supplied identities сверяются с новым `EndgameGraphCore` snapshot.

Для positive theorem одновременно требуется:

1. targets разных цветов;
2. между targets есть actual shared liberty; одной direct stone adjacency без shared liberty недостаточно;
3. ни одна target не имеет independent Benson/pass-alive proof;
4. обе Work 5A `RelevanceZone` имеют outcome `bounded`;
5. deterministic union этих зон укладывается в `maxZonePoints`, current default `96`;
6. для **каждой** стороны отдельно рассматривается каждый legal первый ход на каждом empty point certified union;
7. каждый такой ход либо сразу доказывает, что initiator выигрывает и тем самым запрещает seki, либо continuation должен доказать, что responder force-captures initiator target;
8. только если все legal local initiations обеих сторон доказанно проигрывают initiator, outcome становится `seki`.

Отдельный local `tenuki`/pass в positive interpretation сохраняет исходную occupancy и тем самым показывает безопасную альтернативу началу проигрышного захвата. Это и есть текущий intentionally strong sufficient proof взаимного сдерживания.

## 51.2. Delegation to Work 7B

Первый local move Work 7C всегда выполняется authoritative `GameEngine.placeStone()`.

Если move не захватывает opponent target сразу, текущие target structures восстанавливаются по исходным crucial stones. Friendly merge/extension разрешены. Затем Work 7C вызывает `analyzeBoundedSemeai(...)` на post-initiation snapshot и использует **только фактический responder-to-move order**:

```text
left initiated  -> read continuation.rightFirst
right initiated -> read continuation.leftFirst
```

Interpretation continuation:

```text
responder wins  -> initiator-loses
initiator wins  -> initiator-wins
ko / budget / boundary / cycle / incomplete -> same fail-closed uncertainty
```

Continuation дополнительно обязана оставаться внутри исходной Work 7C certified union. Если Work 7B post-move conflict region выходит наружу, 7C возвращает `unknown-boundary`, даже если более широкий search потенциально мог бы решить позицию.

Когда initiation соединяет исходную target с friendly stones, передача расширенной current group в Work 7B является консервативной: capture исходных crucial stones всё равно требует capture всей connected current group. Это может уменьшить coverage, но не создаёт ложный `seki`.

## 51.3. Ko и fail-closed semantics

Есть отдельная важная boundary между first initiation и delegated Work 7B root. Work 7B намеренно начинает новый root с lifted initial ko context, поэтому Work 7C до delegation самостоятельно проверяет **initiation-created immediate restoring simple ko** с exact board до initiation как `previousBoard`.

Если responder recapture восстанавливает предыдущую occupancy и запрещён `GameEngine` как repetition:

```text
ko-dependent
```

а не `seki`.

Также не становятся seki:

- stale supplied target identity;
- same-color pair;
- pair без нужной interaction/shared-liberty semantics;
- target с independent Benson/pass-alive life;
- unbounded/oversized conflict union;
- любой legal winning initiation;
- `unknown-budget`;
- `unknown-boundary`;
- `unknown-cycle`;
- `unknown-incomplete`.

Таким образом Work 7C сохраняет главный Engine invariant:

```text
failure to prove capture != seki
failure to prove non-seki != seki
```

Positive `seki` требует конструктивного proof каждой local initiation branch.

## 51.4. Regression coverage

`SekiSearch.test.ts` содержит семь targeted deterministic tests:

1. basic mutual-restraint shape с двумя shared liberties: каждый legal local first move обеих сторон проигрывает и result = `seki`;
2. one-shared-liberty first-move capture race имеет winning initiation и не становится seki;
3. direct opposing contact без shared liberty не подходит под basic theorem;
4. `maxNodes = 0` даёт `unknown-budget` continuation и общий `unresolved`;
5. whole-conflict region без certified outside boundary возвращает `unknown-boundary`;
6. initiation-created restoring simple ko возвращает `ko-dependent`;
7. stale supplied target identity отвергается до proof.

Fixtures используют arbitrary graph `Topology`; rectangular geometry отсутствует в Work 7C correctness path.

## 51.5. Validation boundary

Первый code-head CI #810 остановился на одном TypeScript contract defect в mapper `BoundedSemeaiOrderOutcome -> BasicSekiMoveOutcome`; lint уже проходил, production search tests до этого шага ещё не запускались. Mapper был исправлен exhaustive `switch`, одновременно удалён новый unused-import warning; proof semantics не менялись.

Исправленный code-head `93cf6d34d69a8eeb39f5c5bef40c56fc7f028baf` в full CI #811 прошёл:

- lint — pass, только прежние warnings вне Work 7C scope;
- typecheck — pass;
- unit/coverage — pass, включая все **7/7** Work 7C regressions;
- build — pass.

На момент documentation closure full Playwright step того же code-head run ещё выполнялся. Exact final documentation head обязан пройти полный `[full]` PR CI перед merge; merge при красном final head запрещён.

## 51.6. Integration boundary и closure

Work 7C намеренно **не** меняет `AssistedEndgameClassifier`, user-facing automatic statuses или existing legacy seki precedence. Новый result существует как отдельный proof layer до Work 7D hardening.

После Work 7C separation становится:

```text
Work 7A
  cheap exact simple semeai

Work 7B
  bounded searched semeai with shared liberties / auxiliary interactions

Work 7C
  strict sufficient basic-seki proof
  never inferred from unresolved 7B search

Work 7D
  adversarial hardening
  topology / far-away invariance
  deterministic budgets and performance
  classifier integration only for accepted proofs
```

**Следующий этап — Work 7D: Hardening + Classifier Integration.**

---

# 52. Work 8 decomposition; Work 8A — TerritoryResolver Core: финальный результат

Срез на **2026-08-24**. Work 8 детализирован на три изолированных этапа. **Work 8A закрыт.** Work 8B и Work 8C остаются отдельным последующим scope.

## 52.1. Detailed decomposition

### Work 8A — TerritoryResolver Core — CLOSED 2026-08-24

- virtual removal только `dead`;
- flood-fill оставшихся empty regions;
- `borderingColors` и `borderingGroups`;
- базовый `BLACK / WHITE / NEUTRAL`;
- correctness только через `Topology.neighbors()`;
- без изменения Chinese/Japanese scoring.

### Work 8B — Seki / Dame + Scoring Handoff

- корректная нейтральность seki;
- `touchesSeki`;
- dame;
- передача результата Resolver существующим Chinese/Japanese scorers;
- никаких новых life/death proofs.

### Work 8C — Hardening + Differential

- planar comparison с `goscorer`, где semantics действительно совпадают;
- Torus seam и Cube edge/corner fixtures;
- graph-isomorphism/metamorphic tests;
- determinism;
- regression cases;
- полный pipeline `classification -> TerritoryResolver -> scoring`;
- performance/acceptance gate.

## 52.2. Accepted Work 8A contract

Добавлен independent topology-neutral `resolveTerritory(state, classification, topology) -> TerritoryResolution`.

`ResolvedRegion` содержит:

```text
key
points
borderingColors
borderingGroups
owner: BLACK | WHITE | NEUTRAL
```

`TerritoryResolution` дополнительно содержит `regionByPoint`.

Work 8A semantics:

1. classification points проверяются против topology и authoritative board occupancy;
2. создаётся отдельный virtual board; исходный `GameState` не мутируется;
3. только stone points со статусом `dead` виртуально становятся `empty`;
4. `alive`, `seki` и unclassified stones остаются на virtual board;
5. topology-neutral `EndgameGraphCore` строится заново на virtual board;
6. его `emptyRegions` являются deterministic flood-fill результатом через `Topology.neighbors()`;
7. `borderingGroups` берутся из surviving virtual-board strings;
8. `borderingColors` берутся из цветов этих surviving groups;
9. ровно один black bordering color -> `BLACK`, ровно один white -> `WHITE`, обе стороны или отсутствие bordering color -> `NEUTRAL`.

`touchesSeki` намеренно отсутствует в Work 8A. Seki/dame-specific neutrality и scoring interpretation принадлежат Work 8B.

## 52.3. Reuse / topology decision

Work 8A намеренно не создаёт второй собственный flood-fill/group index. После dead-only virtual removal Resolver переиспользует `EndgameGraphCore`.

Это сохраняет один topology-neutral structural implementation:

```text
virtual board
  -> buildEndgameGraph(...)
  -> deterministic empty regions / boundary groups / boundary colors
```

Correctness не зависит от coordinates, edge/corner helpers, face index или renderer geometry. Opaque arbitrary-graph fixtures дополнительно проверяют, что connectivity определяется только `Topology.neighbors()`.

## 52.4. Regression coverage

`TerritoryResolver.test.ts` содержит восемь targeted tests:

1. dead stone виртуально удаляется, соединяет ранее разделённые empty points в один region и не мутирует исходный `GameState`;
2. удаляется только `dead`; `alive`, `seki` и unclassified stones сохраняются;
3. single-white-boundary region получает `WHITE` и stable bordering group ids;
4. mixed black/white boundary получает `NEUTRAL`;
5. opaque unrelated point names соединяются исключительно через supplied `Topology.neighbors()`;
6. classification point вне topology rejected;
7. classification empty point rejected;
8. conflicting statuses одного stone point rejected.

Positive `BLACK` ownership также покрывается первым dead-removal fixture.

## 52.5. Scoring boundary

Work 8A не меняет существующие `ChineseScoring` / `JapaneseScoring` и не переключает их на новый Resolver. Existing scoring implementation продолжает работать как до этого PR.

Это сознательная граница этапа: 8A создаёт только reusable territory facts. Seki/dame semantics и scorer handoff должны быть сделаны вместе в Work 8B, чтобы не получить промежуточную несовместимую scoring semantics.

Новых life/death/seki proofs Work 8A также не добавляет.

## 52.6. Validation

PR #180 создан от exact `engine` HEAD `bcfb6a5f55b3c714a7aaa2500435b5b5a7d64af5`.

Code-head `67af5cba630804350f7eeaf86112e2b06cb87381` прошёл full CI run #843 полностью:

- lint — pass;
- typecheck — pass;
- unit/coverage — pass, включая все **8/8** Work 8A regressions;
- build — pass;
- full Playwright E2E — pass.

Exact final documentation head обязан пройти новый full `[full]` CI перед merge.

## 52.7. Closure

Work 8A закрывает только TerritoryResolver foundation:

- dead-only virtual removal;
- deterministic topology-neutral empty-region resolution;
- stable boundary colors/groups;
- базовая `BLACK / WHITE / NEUTRAL` ownership;
- no authoritative position mutation;
- no scoring behavior change;
- no seki/dame-specific Resolver semantics;
- no new life/death proofs.

Следующий этап именно TerritoryResolver track — **Work 8B: Seki / Dame + Scoring Handoff**. Work 7D остаётся отдельным ранее запланированным classifier hardening/integration scope и этим этапом не считается закрытым.
