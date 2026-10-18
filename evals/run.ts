/**
 * The eval workbench: run the cases against the scripted demo model or a live model, then see
 * how reliably the agent passes, what it costs, and why it fails.
 *
 *   npm run eval                                scripted demo model: checks the harness itself
 *   npm run eval -- --live --runs 5             your configured model (costs money)
 *   npm run eval -- --live --runs 5 --save     also write a report you can compare later
 *   npm run eval -- --compare a.json b.json    compare two saved reports
 *   npm run eval -- --list                      show the cases
 *   other options: --case <id,id>  --price <input,output $ per million tokens>  --budget <tokens>
 */
import path from 'node:path';
import { DemoModel } from '../src/server/demo.js';
import { cases } from './cases.js';
import { formatAttempt, formatComparison, formatSummary, type Price } from './format.js';
import {
  compareReports,
  loadReport,
  runCase,
  saveReport,
  summarize,
  type AttemptResult,
  type Report,
} from './harness.js';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const stop = (message: string): never => {
  console.error(message);
  process.exit(2);
};

if (flag('--list')) {
  for (const c of cases)
    console.log(`  ${c.id}${c.live ? '  (live model only)' : ''}\n      ${c.title}`);
  process.exit(0);
}

if (flag('--compare')) {
  const i = args.indexOf('--compare'),
    files = [args[i + 1], args[i + 2]];
  if (!files[0] || !files[1] || files.some((f) => f.startsWith('--')))
    stop('Usage: npm run eval -- --compare <first report.json> <second report.json>');
  const [a, b] = await Promise.all(files.map((f) => loadReport(path.resolve(f))));
  console.log(
    `  ${a.model} (${a.runsPerCase} runs per case) vs ${b.model} (${b.runsPerCase} runs per case)\n`,
  );
  console.log(formatComparison(compareReports(a, b), { a: a.model, b: b.model }));
  process.exit(0);
}

const live = flag('--live');
if (live && (process.env.TINKERFLEET_MODE !== 'live' || !process.env.TINKERFLEET_MODEL))
  stop('A live eval needs TINKERFLEET_MODE=live, TINKERFLEET_MODEL and OPENAI_API_KEY.');
const runsPerCase = Math.max(1, Math.floor(Number(value('--runs') ?? (live ? 3 : 1))) || 1);
const wanted = value('--case')?.split(',');
const unknown = wanted?.filter((id) => !cases.some((c) => c.id === id));
if (unknown?.length) stop(`Unknown case: ${unknown.join(', ')}. Run --list to see them.`);
let price: Price | undefined;
if (value('--price')) {
  const [input, output] = value('--price')!.split(',').map(Number);
  if (!(input >= 0) || !(output >= 0))
    stop('Use --price <input>,<output> in dollars per million tokens.');
  price = { input, output };
}
// A live eval can make many model calls. This stops the whole eval, not just one run.
const budget = Number(value('--budget') ?? (live ? 300_000 : Infinity));
if (!(budget > 0)) stop('--budget must be a positive number of tokens.');

const selected = cases.filter((c) => !wanted || wanted.includes(c.id));
const skipped = live ? [] : selected.filter((c) => c.live);
const toRun = selected.filter((c) => !skipped.includes(c));
const model = live ? process.env.TINKERFLEET_MODEL! : 'scripted demo model';
console.log(
  `  ${model}${live && process.env.TINKERFLEET_REASONING_EFFORT ? ` (reasoning ${process.env.TINKERFLEET_REASONING_EFFORT})` : ''}` +
    ` · ${toRun.length} case${toRun.length === 1 ? '' : 's'} × ${runsPerCase} run${runsPerCase === 1 ? '' : 's'}` +
    (live ? ` · stops after ${budget.toLocaleString('en-US')} tokens` : ''),
);
for (const c of skipped) console.log(`  skipped ${c.id}: only a live model can attempt it`);
console.log('');

const startedAt = new Date().toISOString();
const results: AttemptResult[] = [];
let spent = 0,
  stoppedEarly = false;
for (const c of toRun)
  for (let run = 1; run <= runsPerCase && !stoppedEarly; run++) {
    if (spent >= budget) {
      stoppedEarly = true;
      break;
    }
    const result = await runCase(
      c,
      { live, model: live ? process.env.TINKERFLEET_MODEL! : new DemoModel(0) },
      `eval-${c.id}-${run}`,
    );
    spent += result.tokens;
    results.push(result);
    console.log(formatAttempt(result, run));
  }
if (stoppedEarly)
  console.log(`\n  Stopped early: the ${budget.toLocaleString('en-US')} token budget was reached.`);

console.log('\n' + formatSummary(summarize(results), price));
if (price)
  console.log(
    '  cost is an estimate from the prices you gave; check your provider for real charges.',
  );

if (flag('--save')) {
  const report: Report = {
    model,
    reasoningEffort: live ? (process.env.TINKERFLEET_REASONING_EFFORT ?? null) : null,
    startedAt,
    runsPerCase,
    stoppedEarly,
    results,
  };
  console.log(
    `\n  saved ${path.relative(process.cwd(), await saveReport(path.resolve('.tinkerfleet/evals'), report))}`,
  );
}
// A scripted run checks the harness, so any failure there is a bug. A live score is a measurement.
if (!live && results.some((r) => !r.passed)) process.exit(1);
