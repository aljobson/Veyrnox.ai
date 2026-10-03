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
export const ALLOWED = [
  {
    id: 'GHSA-vfj7-8cjw-p6xm',
    reason: 'braces <= 3.0.3 (every published version): stack exhaustion on deeply nested brace patterns. '
      + 'It reaches us only through devDependencies (tailwindcss 3 via chokidar and micromatch, '
      + 'eslint-config-next via fast-glob), which expand globs from our own config at build and lint time. '
      + 'Nothing on the Worker\'s request path loads it; `npm audit --omit=dev` is clean. Added 2026-10-03.',
  },
];

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

function readReport(extraArgs = []) {
  const run = spawnSync('npm', ['audit', '--json', ...extraArgs], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) throw run.error;
  // npm exits non-zero whenever it finds anything; the report is on stdout either way.
  return JSON.parse(run.stdout);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let result;
  try {
    result = assessAudit(readReport(), ALLOWED, readReport(['--omit=dev']));
  } catch (e) {
    console.error(`[check-audit] could not read the audit report: ${e.message}`);
    process.exit(2);
  }
  for (const w of result.waived) console.log(`[check-audit] allowed: ${w.id} (${w.package}, ${w.severity})`);
  for (const p of result.problems) console.error(`[check-audit] ${p}`);
  if (result.problems.length === 0) console.log('[check-audit] no high or critical advisories outside the allowlist');
  process.exitCode = result.problems.length === 0 ? 0 : 1;
}
