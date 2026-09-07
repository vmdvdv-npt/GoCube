import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const SUMMARY_PATH = resolve('coverage/coverage-summary.json');
const CRITICAL_ROOTS = ['src/core/endgame', 'src/core/scoring'];
const EXCLUDED_DIRECTORIES = new Set(['src/core/endgame/testlab']);
const THRESHOLDS = {
  statements: 80,
  branches: 70,
  functions: 75,
  lines: 80,
};

const toPosix = (value) => value.split(sep).join('/').replaceAll('\\', '/');

const toProjectRelative = (filePath) => {
  const absolutePath = isAbsolute(filePath) ? filePath : resolve(filePath);
  return toPosix(relative(process.cwd(), absolutePath));
};

const collectProductionFiles = (directory) => {
  const normalizedDirectory = toPosix(directory);
  if (EXCLUDED_DIRECTORIES.has(normalizedDirectory)) return [];

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const childPath = join(directory, entry.name);
    if (entry.isDirectory()) return collectProductionFiles(childPath);
    if (!entry.isFile()) return [];
    if (!/\.(?:ts|tsx)$/.test(entry.name)) return [];
    if (/\.test\.(?:ts|tsx)$/.test(entry.name) || entry.name.endsWith('.d.ts')) return [];
    return [toPosix(childPath)];
  });
};

if (!existsSync(SUMMARY_PATH)) {
  console.error(`Rule-critical coverage gate: missing ${toProjectRelative(SUMMARY_PATH)}.`);
  process.exit(1);
}

const summary = JSON.parse(readFileSync(SUMMARY_PATH, 'utf8'));
const entriesByPath = new Map(
  Object.entries(summary)
    .filter(([filePath]) => filePath !== 'total')
    .map(([filePath, metrics]) => [toProjectRelative(filePath), metrics]),
);

const criticalFiles = CRITICAL_ROOTS.flatMap(collectProductionFiles).sort();
const failures = [];
let checkedFiles = 0;
let noExecutableFiles = 0;

for (const filePath of criticalFiles) {
  const metrics = entriesByPath.get(filePath);
  if (!metrics) {
    failures.push(`${filePath}: missing from coverage summary`);
    continue;
  }

  const metricNames = Object.keys(THRESHOLDS);
  const executableMetrics = metricNames.filter((metricName) => metrics[metricName]?.total > 0);
  if (executableMetrics.length === 0) {
    noExecutableFiles += 1;
    continue;
  }

  checkedFiles += 1;
  for (const metricName of executableMetrics) {
    const actual = Number(metrics[metricName].pct);
    const minimum = THRESHOLDS[metricName];
    if (!Number.isFinite(actual) || actual < minimum) {
      failures.push(`${filePath}: ${metricName} ${metrics[metricName].pct}% < ${minimum}%`);
    }
  }
}

if (failures.length > 0) {
  console.error('Rule-critical coverage gate failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Rule-critical coverage gate passed for ${checkedFiles} executable files` +
    (noExecutableFiles > 0 ? ` (${noExecutableFiles} type-only/no-executable skipped)` : '') +
    '. Thresholds: statements 80%, branches 70%, functions 75%, lines 80%.',
);
