#!/usr/bin/env node
/**
 * Violations report (engineering requirement: regular evaluation of violations).
 * Counts suppressions and prints coverage + outdated deps; reviewed at sprint close.
 * Exit code is 0 — the gate scripts (lint/test) fail the build; this one reports.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    return error.stdout ?? '';
  }
}

const suppressions = run(
  String.raw`grep -rnE "@ts-ignore|@ts-expect-error|eslint-disable|: any\b|as any\b" src --include='*.ts' --include='*.vue' || true`,
)
  .trim()
  .split('\n')
  .filter(Boolean);

console.log('=== Violations report ===');
console.log(`Suppressions / any-casts in src: ${suppressions.length}`);
for (const line of suppressions) console.log(`  ${line}`);

if (existsSync('coverage/coverage-summary.json')) {
  const summary = JSON.parse(readFileSync('coverage/coverage-summary.json', 'utf-8'));
  const { lines, branches } = summary.total;
  console.log(`Coverage: lines ${lines.pct}% · branches ${branches.pct}%`);
} else {
  console.log('Coverage: no coverage/coverage-summary.json — run `npm run test:coverage` first');
}

const outdated = run('npm outdated --json');
const outdatedCount = outdated.trim() ? Object.keys(JSON.parse(outdated)).length : 0;
console.log(`Outdated dependencies: ${outdatedCount}`);
