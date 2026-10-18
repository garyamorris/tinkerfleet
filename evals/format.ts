/** Plain-text reports for the eval CLI. Pure functions, so the exact wording can be tested. */
import {
  estimateCost,
  failureReason,
  type AttemptResult,
  type CaseSummary,
  type Comparison,
} from './harness.js';

const pct = (value: number) => `${Math.round(value * 100)}%`;
const tokens = (value: number) =>
  value === 0
    ? '-'
    : value >= 10_000
      ? `${(value / 1000).toFixed(1)}k`
      : Math.round(value).toLocaleString('en-US');
const pad = (text: string, width: number) => text.padEnd(width);

export function formatAttempt(result: AttemptResult, run: number): string {
  const head =
    `  ${result.passed ? 'PASS' : 'FAIL'}  ${result.caseId} run ${run}: ` +
    `${result.modelCalls} model calls, ${tokens(result.tokens)} tokens, ${result.seconds.toFixed(1)}s`;
  if (result.passed) return head;
  const lines = [`${head}`, `        why: ${failureReason(result)}`];
  if (result.steps.length) lines.push(`        what it did: ${result.steps.join('  ')}`);
  return lines.join('\n');
}

export interface Price {
  input: number;
  output: number;
}

export function formatSummary(summaries: readonly CaseSummary[], price?: Price): string {
  const idWidth = Math.max(4, ...summaries.map((s) => s.caseId.length));
  const rows = [
    `  ${pad('case', idWidth)}  passed  95% range   tokens min / mean / max   time${price ? '    cost' : ''}`,
  ];
  for (const s of summaries) {
    const cost = price
      ? `  $${estimateCost(s.inputTokens * s.runs, s.outputTokens * s.runs, price).toFixed(4)}`
      : '';
    rows.push(
      `  ${pad(s.caseId, idWidth)}  ${pad(`${s.passes}/${s.runs}`, 6)}  ${pad(`${pct(s.low)}–${pct(s.high)}`, 10)}  ` +
        `${pad(`${tokens(s.tokens.min)} / ${tokens(s.tokens.mean)} / ${tokens(s.tokens.max)}`, 24)}  ${pad(`${s.seconds.toFixed(1)}s`, 6)}${cost}` +
        (s.stability === 'flaky' ? '  flaky' : ''),
    );
    for (const f of s.failures)
      rows.push(`  ${pad('', idWidth)}    failed ×${f.count}: ${f.reason}`);
  }
  const total = summaries.reduce((n, s) => n + s.passes, 0),
    runs = summaries.reduce((n, s) => n + s.runs, 0);
  rows.push('', `  score: ${total}/${runs}`);
  const fewest = Math.min(...summaries.map((s) => s.runs));
  if (summaries.length && fewest < 10)
    rows.push(
      `  note: with ${fewest} run${fewest === 1 ? '' : 's'} per case the 95% range is wide. A pass rate from so few runs cannot`,
      '  separate a good agent from a lucky one; run more before drawing conclusions.',
    );
  if (summaries.some((s) => s.stability === 'flaky'))
    rows.push('  note: flaky means the same task passed on some runs and failed on others.');
  return rows.map((row) => row.trimEnd()).join('\n');
}

export function formatComparison(
  comparisons: readonly Comparison[],
  names: { a: string; b: string },
): string {
  const idWidth = Math.max(4, ...comparisons.map((c) => c.caseId.length));
  const cell = (s?: CaseSummary) =>
    s ? `${s.passes}/${s.runs} (${pct(s.low)}–${pct(s.high)})` : 'not run';
  const widthA = Math.max(names.a.length, ...comparisons.map((c) => cell(c.a).length));
  const rows = [
    `  ${pad('case', idWidth)}  ${pad(names.a, widthA)}  ${pad(names.b, 22)}  tokens (mean)`,
  ];
  for (const c of comparisons) {
    const mean = (s?: CaseSummary) => (s ? tokens(s.tokens.mean) : '-');
    rows.push(
      `  ${pad(c.caseId, idWidth)}  ${pad(cell(c.a), widthA)}  ${pad(cell(c.b), 22)}  ${mean(c.a)} → ${mean(c.b)}` +
        (c.clear ? '  clear difference' : ''),
    );
  }
  rows.push(
    '',
    '  A "clear difference" means the two 95% ranges do not overlap. Without it, the gap may be luck.',
  );
  return rows.join('\n');
}
