#!/usr/bin/env node
/**
 * CI's dependency gate: any high or critical npm advisory fails the build,
 * except the ones named in ALLOWED.
 *
 * A bare `npm audit --audit-level=high` cannot make that exception, so an
 * advisory with no fixed version turned every pull request red at once with
 * nothing to upgrade to. ALLOWED is for that case only, one advisory at a
 * time, and an entry cannot outlive its cause: the gate fails again as soon
 * as the advisory can be fixed without a breaking upgrade, or stops being
 * reported. An entry also covers build and lint tooling only: it stops
 * applying the moment `npm audit --omit=dev` reports the advisory, which
 * means a production dependency now installs the package.
 *
 * Exit 0 = clean. Exit 1 = a finding, or an ALLOWED entry that has to go.
 * Exit 2 = could not tell (npm audit did not return a report).
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BLOCKING = new Set(['high', 'critical']);

// Add an entry only when there is no fixed version to move to, and say where
// the package sits and why that is tolerable. Remove it when the gate says so.
export const ALLOWED = [];

// The same gate for another lockfile: `node scripts/check-audit.mjs --prefix <dir>` audits <dir> and uses that
// directory's own list, so an exception for one lockfile can never hide, or be reported stale by, another.
export const ALLOWED_BY_PREFIX = {
  // picomatch <= 4.0.7 (ReDoS through repeated extglobs, published 2026-10-19) has no patched version. It reaches this
  // package only through vitest and @cloudflare/vitest-plugin, which run the signed-callback Workers tests in CI;
  // every dependency here is a devDependency, so nothing installs it in production.
  'tests/fal-signed-retry-runtime': [
    { id: 'GHSA-fc5q-39xc-vjpf', reason: 'picomatch <= 4.0.7 has no patched version; test-runner tooling only (vitest chain)' },
  ],
};

const advisoryId = (via) => /\/(GHSA(?:-[0-9a-z]{4}){3})$/i.exec(via.url || '')?.[1] ?? null;

function vulnerabilitiesOf(report) {
  if (report?.auditReportVersion !== 2 || typeof report.vulnerabilities !== 'object' || !report.vulnerabilities) {
    throw new Error('not an npm audit report (version 2)');
  }
  return report.vulnerabilities;
}

/**
 * @param {object} report  `npm audit --json`, report version 2
 * @param {{id: string, reason: string}[]} [allowed]
 * @param {object} [prodReport]  `npm audit --json --omit=dev`; when given, an
 *   allowed advisory it reports is a problem. The CLI always passes it.
 * @returns {{problems: string[], waived: {id: string, package: string, severity: string}[]}}
 */
export function assessAudit(report, allowed = ALLOWED, prodReport = undefined) {
  const vulnerabilities = vulnerabilitiesOf(report);
  const inProduction = new Set();
  if (prodReport !== undefined) {
    for (const vuln of Object.values(vulnerabilitiesOf(prodReport))) {
      for (const via of vuln.via || []) {
        if (typeof via === 'object' && BLOCKING.has(via.severity) && advisoryId(via)) inProduction.add(advisoryId(via));
      }
    }
  }
  const allowedIds = new Set(allowed.map((e) => e.id));
  const seen = new Set();
  const problems = [];
  const waived = [];
  // The package that owns an advisory carries it as an object in `via`;
  // packages that only inherit it carry the owner's name, and need no entry.
  for (const [name, vuln] of Object.entries(vulnerabilities)) {
    for (const via of vuln.via || []) {
      if (typeof via !== 'object' || !BLOCKING.has(via.severity)) continue;
      const id = advisoryId(via);
      if (id) seen.add(id);
      if (!id || !allowedIds.has(id)) {
        problems.push(`${via.severity}: ${name} — ${via.title || 'untitled advisory'} (${id || via.url || 'no advisory id'})`);
      } else if (inProduction.has(id)) {
        problems.push(`${id} (${name}) is now installed by a production dependency: ALLOWED covers build and lint tooling only`);
      } else if (vuln.fixAvailable === true) {
        problems.push(`${id} (${name}) can now be fixed without a breaking upgrade: run \`npm audit fix\` and remove it from ALLOWED`);
      } else {
        waived.push({ id, package: name, severity: via.severity });
      }
    }
  }
  for (const { id } of allowed) {
    if (!seen.has(id)) problems.push(`${id} is no longer reported as high or critical: remove it from ALLOWED`);
  }
  return { problems, waived };
}

function readReport(extraArgs = [], prefix = null) {
  const args = ['audit', '--json', ...(prefix ? ['--prefix', prefix] : []), ...extraArgs];
  const run = spawnSync('npm', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) throw run.error;
  // npm exits non-zero whenever it finds anything; the report is on stdout either way.
  let report;
  try { report = JSON.parse(run.stdout); } catch { report = null; }
  if (report?.auditReportVersion !== 2) {
    // Say which call failed and what npm printed; "not a report" alone cannot be acted on.
    const said = (run.stdout || run.stderr || '').replace(/\s+/g, ' ').slice(0, 300);
    throw new Error(`\`npm ${args.join(' ')}\` (exit ${run.status}) did not return a report: ${said || 'no output'}`);
  }
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let result;
  try {
    const at = process.argv.indexOf('--prefix');
    const prefix = at > 0 ? (process.argv[at + 1] || '').replace(/\/+$/, '') : null;
    if (at > 0 && !prefix) throw new Error('--prefix needs a directory');
    const allowed = prefix ? ALLOWED_BY_PREFIX[prefix] ?? [] : ALLOWED;
    result = assessAudit(readReport([], prefix), allowed, readReport(['--omit=dev'], prefix));
  } catch (e) {
    console.error(`[check-audit] could not read the audit report: ${e.message}`);
    process.exit(2);
  }
  for (const w of result.waived) console.log(`[check-audit] allowed: ${w.id} (${w.package}, ${w.severity})`);
  for (const p of result.problems) console.error(`[check-audit] ${p}`);
  if (result.problems.length === 0) console.log('[check-audit] no high or critical advisories outside the allowlist');
  process.exitCode = result.problems.length === 0 ? 0 : 1;
}
