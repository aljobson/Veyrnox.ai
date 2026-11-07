#!/usr/bin/env node
/**
 * Daily dependency audit (the CI gate, scripts/check-audit.mjs, only runs on pull
 * requests and only fails on high and critical). This one reads a lockfile, reports
 * moderate and above, and fails the run so the owner gets GitHub's failed-workflow
 * email. It opens no issue and posts nothing: the repo is public.
 *
 *   node scripts/daily-audit.mjs [--dir apps/mobile]
 *
 * Exit 0 = nothing outside IGNORED. Exit 1 = a finding, or an IGNORED entry that has to
 * go. Exit 2 = could not tell (npm audit did not return a report).
 *
 * IGNORED is for an advisory that has no fix yet, one at a time, with the reason. An
 * entry cannot outlive its cause: it fails again once the advisory can be fixed without
 * a breaking upgrade, or stops being reported.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPORTED = new Set(['moderate', 'high', 'critical']);

/** @type {Record<string, {id: string, reason: string}[]>} keyed by lockfile directory */
export const IGNORED = {
  '.': [
    {
      id: 'GHSA-3g3m-2fjr-6pw4',
      reason: '@node-minify/core pins glob 10.5.0 (a package.json override) and is a build-time minifier pulled in by @opennextjs/cloudflare. The only offered fix is a major downgrade of that adapter.',
    },
  ],
  'apps/mobile': [],
};

const advisoryId = (via) => /\/(GHSA(?:-[0-9a-z]{4}){3})$/i.exec(via.url || '')?.[1] ?? null;

/**
 * @param {object} report  `npm audit --json`, report version 2
 * @param {{id: string, reason: string}[]} [ignored]
 * @returns {{problems: string[], ignored: string[]}}
 */
export function assessDaily(report, ignored = []) {
  if (report?.auditReportVersion !== 2 || typeof report.vulnerabilities !== 'object' || !report.vulnerabilities) {
    throw new Error('not an npm audit report (version 2)');
  }
  const ignoredIds = new Set(ignored.map((e) => e.id));
  const seen = new Set();
  const problems = [];
  const waived = [];
  // The package that owns an advisory carries it as an object in `via`; packages that only inherit it carry the owner's name.
  for (const [name, vuln] of Object.entries(report.vulnerabilities)) {
    for (const via of vuln.via || []) {
      if (typeof via !== 'object' || !REPORTED.has(via.severity)) continue;
      const id = advisoryId(via);
      if (id) seen.add(id);
      if (!id || !ignoredIds.has(id)) {
        problems.push(`${via.severity}: ${name} — ${via.title || 'untitled advisory'} (${id || via.url || 'no advisory id'})${vuln.fixAvailable === true ? ' [fix available: npm audit fix]' : ''}`);
      } else if (vuln.fixAvailable === true) {
        problems.push(`${id} (${name}) can now be fixed without a breaking upgrade: fix it and remove it from IGNORED`);
      } else {
        waived.push(`${id} (${name}, ${via.severity})`);
      }
    }
  }
  for (const { id } of ignored) {
    if (!seen.has(id)) problems.push(`${id} is no longer reported at moderate or above: remove it from IGNORED`);
  }
  return { problems, ignored: waived };
}

function readReport(dir) {
  const run = spawnSync('npm', ['audit', '--json', '--package-lock-only'], { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) throw run.error;
  // npm exits non-zero whenever it finds anything; the report is on stdout either way.
  let report;
  try { report = JSON.parse(run.stdout); } catch { report = null; }
  if (report?.auditReportVersion !== 2) {
    const said = (run.stdout || run.stderr || '').replace(/\s+/g, ' ').slice(0, 300);
    throw new Error(`\`npm audit\` in ${dir} (exit ${run.status}) did not return a report: ${said || 'no output'}`);
  }
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--dir');
  const dir = at > -1 ? process.argv[at + 1] : '.';
  if (!Object.hasOwn(IGNORED, dir)) {
    console.error(`[daily-audit] ${dir} has no entry in IGNORED: add one (an empty list is fine)`);
    process.exit(2);
  }
  let result;
  try {
    result = assessDaily(readReport(dir), IGNORED[dir]);
  } catch (e) {
    console.error(`[daily-audit] could not read the audit report: ${e.message}`);
    process.exit(2);
  }
  for (const w of result.ignored) console.log(`[daily-audit] ${dir}: ignored ${w}`);
  for (const p of result.problems) console.error(`[daily-audit] ${dir}: ${p}`);
  if (result.problems.length === 0) console.log(`[daily-audit] ${dir}: nothing at moderate or above outside IGNORED`);
  process.exitCode = result.problems.length === 0 ? 0 : 1;
}
