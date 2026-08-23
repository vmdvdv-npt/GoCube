from pathlib import Path


def replace_once(path: str, old: str, new: str = '') -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, got {count}: {old[:100]!r}')
    p.write_text(text.replace(old, new, 1))


# App: remove all interactive Test Case/Test ID state, handlers and provider wiring.
p = Path('src/app/App.tsx')
text = p.read_text()
text = text.replace("import { externalCorpusCaseCount } from '../core/endgame/testlab/ExternalCorpusImporter';\n", '')
text = text.replace("import type { ReplayableTestCase, TestCaseSource } from '../core/endgame/testlab/TestCase';\n", '')
text = text.replace('  type NewGameSettings,\n', '')
text = text.replace('  type TestCaseActiveGame,\n', '')
text = text.replace("import {\n  LiveTestGeneratorProvider,\n  type LiveTestGeneratorControls,\n} from './LiveTestGeneratorContext';\n", '')
text = text.replace("const LIVE_TEST_CONTROLS_ENABLED =\n  import.meta.env.DEV || import.meta.env.VITE_ENABLE_LIVE_TEST_GENERATORS === '1';\nlet fallbackRandomCounter = 0;\n\n", '')
start = text.index('const randomUint32 = (): number => {')
end = text.index('export function App() {', start)
text = text[:start] + text[end:]
for line in [
    "  const [currentTestCase, setCurrentTestCase] = useState<ReplayableTestCase | null>(null);\n",
    "  const [testIdInput, setTestIdInput] = useState('');\n",
    "  const [testCaseBusy, setTestCaseBusy] = useState(false);\n",
    "  const [testCaseFeedback, setTestCaseFeedback] = useState<string | null>(null);\n",
]:
    if line not in text:
        raise SystemExit(f'App.tsx missing state line: {line!r}')
    text = text.replace(line, '', 1)
start = text.index('  const resetTestCaseState = (): void => {')
end = text.index('  const continueSavedGame', start)
text = text[:start] + text[end:]
if text.count('    resetTestCaseState();\n') != 3:
    raise SystemExit(f'App.tsx expected 3 resetTestCaseState calls, got {text.count("    resetTestCaseState();\\n")}')
text = text.replace('    resetTestCaseState();\n', '')
start = text.index('  const applyTestCase = (loaded: TestCaseActiveGame): void => {')
end = text.index('  const sizes = sizesForMode(gameMode);', start)
text = text[:start] + text[end:]
text = text.replace('    <LiveTestGeneratorProvider value={liveTestControls}>\n', '', 1)
text = text.replace('    </LiveTestGeneratorProvider>\n', '', 1)
p.write_text(text)

# Sidebar: remove Test Case controls and diagnostics, preserving gameplay/endgame controls.
p = Path('src/app/GameSidebar.tsx')
text = p.read_text()
text = text.replace("import type { ReferenceStatus } from '../core/endgame/testlab/TestCase';\n", '')
text = text.replace("import { useLiveTestGeneratorControls } from './LiveTestGeneratorContext';\n", '')
start = text.index('const referenceStatusLabel = (status: ReferenceStatus): string => {')
end = text.index('export function GameSidebar', start)
text = text[:start] + text[end:]
text = text.replace('  const developerGeneration = useLiveTestGeneratorControls();\n', '', 1)
start = text.index('\n        {developerGeneration ? (')
end_marker = '\n        ) : null}\n'
end = text.index(end_marker, start) + len(end_marker)
text = text[:start] + '\n' + text[end:]
p.write_text(text)

# Application lifecycle: remove generated/Test ID runtime API only.
p = Path('src/app/GameApplication.ts')
text = p.read_text()
import_end = text.index("import type { GameRepository, SavedGame } from '../core/persistence/GameRepository';")
prefix = "import type { RuleSet } from '../core/game/types';\n"
if not text.startswith(prefix):
    raise SystemExit('GameApplication.ts unexpected import prefix')
text = prefix + text[import_end:]
start = text.index('export interface GeneratedActiveGame {')
end = text.index('export interface ApplicationSavedState {', start)
text = text[:start] + text[end:]
start = text.index('const modeForTopology = (topology: TestCaseTopology): GameMode =>')
end = text.index('/**\n * Bridges the shared GameSession persistence contract', start)
text = text[:start] + text[end:]
old_ctor = """  constructor(
    private readonly repository: GameRepository<ApplicationSavedState> =
      new LocalStorageGameRepository<ApplicationSavedState>(),
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly testCases: TestCaseReplayService = new TestCaseReplayService({
      localAnalysisClient: new LocalAnalysisClient(),
    }),
  ) {}
"""
new_ctor = """  constructor(
    private readonly repository: GameRepository<ApplicationSavedState> =
      new LocalStorageGameRepository<ApplicationSavedState>(),
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}
"""
if old_ctor not in text:
    raise SystemExit('GameApplication.ts constructor shape changed unexpectedly')
text = text.replace(old_ctor, new_ctor, 1)
start = text.index("  /**\n   * Legacy stage-1 compatibility path retained for existing fixed-seed tests.")
end = text.index('  async restoreSavedGame(): Promise<ActiveGame | null> {', start)
text = text[:start] + text[end:]
start = text.index('  private async loadReplayableTestCase(')
end = text.index('  private persistenceConfig(gameMode: GameMode)', start)
text = text[:start] + text[end:]
p.write_text(text)

# Runtime CSS import disappears with the panel.
replace_once('src/main.tsx', "import './app/live-test-generators.css';\n")

# Delete subsystem-only runtime/tests/E2E.
delete_paths = [
    'src/app/LiveTestGeneratorContext.tsx',
    'src/app/live-test-generators.css',
    'src/app/GameApplication.live-generators.test.ts',
    'src/app/GameApplication.test-cases.test.ts',
    'src/core/endgame/testlab/LiveTestGenerators.ts',
    'src/core/endgame/testlab/LiveTestGenerators.test.ts',
    'src/core/endgame/testlab/ControlledEndgameGenerator.ts',
    'src/core/endgame/testlab/ExternalCorpusImporter.ts',
    'src/core/endgame/testlab/TestCase.ts',
    'src/core/endgame/testlab/TestCaseReplayService.ts',
    'src/core/endgame/testlab/TestCaseReplayService.test.ts',
    'e2e/live-test-generators.spec.ts',
]
for path in delete_paths:
    p = Path(path)
    if not p.exists():
        raise SystemExit(f'Expected delete target missing: {path}')
    p.unlink()

# Record cleanup in the sole active Engine working document.
doc = Path('docs/ENDGAME_ENGINE.md')
checkpoint = """

---

# 55. Cleanup checkpoint — interactive Test Case / Test ID lab removed

Срез на **2026-08-24**. Старый пользовательский runtime Test Case / Test ID subsystem удалён из линии `engine`.

Удалены interactive `Generate Game`, `Generate Endgame`, `Generate Corpus`, Test ID input/load/current ID, Test Case feedback/diagnostics, live generator, controlled generated-endgame runtime, obsolete external-corpus runtime и legacy Test ID replay/compatibility. Dedicated UI/TestCase unit tests и E2E удалены вместе с feature; скрытого compatibility adapter или replacement generator не оставлено.

Production proof semantics, gameplay, persistence, Endgame Review и Chinese/Japanese scoring этим cleanup не менялись. Automated correctness infrastructure сохранена отдельно: `Work9Acceptance.ts`, `Work9Acceptance.test.ts`, `Work9TopologyAcceptance.test.ts`, `EndgameHardening`, differential/oracle utilities и deterministic test-only generators/fixtures продолжают выполнять proof/hardening/shadow acceptance задачи и не являются пользовательским Test Case runtime.

Новый neutral position generator в этот cleanup **не входит** и остаётся отдельной будущей задачей.
"""
current = doc.read_text()
if '# 55. Cleanup checkpoint — interactive Test Case / Test ID lab removed' in current:
    raise SystemExit('Cleanup checkpoint already exists')
doc.write_text(current.rstrip() + checkpoint + '\n')

# Strict runtime dead-code gate.
forbidden = [
    'LiveTestGenerator',
    'generateLiveTestCase',
    'replayLiveTestCase',
    'GameLikeGenerator',
    'TestCaseReplayService',
    'ReplayableTestCase',
    'TestCaseIdentity',
    'encodeTestCaseId',
    'decodeTestCaseId',
    'ControlledEndgame',
    'ExternalCorpus',
    'LIVE_ENDGAME_TEST_CASE_VARIANT',
    'CONTROLLED_ENDGAME_TEST_CASE_VARIANT',
    'VITE_ENABLE_LIVE_TEST_GENERATORS',
    'LIVE_TEST_CONTROLS_ENABLED',
    'game-like-background',
]
scan_roots = [Path('src'), Path('e2e'), Path('tools')]
scan_files = [Path('package.json'), Path('playwright.config.ts'), Path('.github/workflows/ci.yml')]
for root in scan_roots:
    for path in root.rglob('*'):
        if path.is_file() and path.name != 'temp-engine-testcase-cleanup.py':
            scan_files.append(path)
for path in scan_files:
    try:
        body = path.read_text()
    except UnicodeDecodeError:
        continue
    for token in forbidden:
        if token in body:
            raise SystemExit(f'Obsolete runtime token remains: {token} in {path}')

for path in [
    Path('src/core/endgame/testlab/Work9Acceptance.ts'),
    Path('src/core/endgame/testlab/Work9Acceptance.test.ts'),
    Path('src/core/endgame/testlab/Work9TopologyAcceptance.test.ts'),
]:
    if not path.exists():
        raise SystemExit(f'Required Work 9 file missing: {path}')
