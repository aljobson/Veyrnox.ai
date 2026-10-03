#!/usr/bin/env node
/**
 * The dependency audit gate (ci.yml "Audit (high and above)", ADR-0067).
 *
 * Fails on every high or critical advisory `npm audit` reports, except the
 * ones listed in EXCEPTIONS by advisory id. An exception is for an advisory
 * with no fixed version that only build tools can reach. It never covers an
 * advisory that reaches production dependencies, and it stops working the day
 * after its review date, so it cannot outlive the reason it was granted.
 *
 * Plain `npm audit --audit-level=high` cannot hold an exception, and
 * `--omit=dev` would stop auditing wrangler and the OpenNext adapter, whose
 * code ships in the Worker.
 *
 * Exit 0 = pass. Exit 1 = a blocking advisory. Exit 2 = could not audit
 * (never a pass).
 */

import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// One entry per advisory, on purpose. Remove an entry as soon as a fixed
// version exists; renewing a review date is a decision, not a formality.
export const EXCEPTIONS = [
    {
        id: 'GHSA-vfj7-8cjw-p6xm',
        package: 'braces',
        // Stack exhaustion from a deeply nested brace pattern. Every release
        // (<= 3.0.3) is affected and none is fixed. Reached only through
        // tailwindcss 3 (chokidar, micromatch) and eslint-config-next
        // (fast-glob), which expand globs written in this repo's own config
        // at build and lint time; no request or user input reaches them.
        reason: 'no fixed version; build tools only, patterns come from our own config',
        reviewBy: '2026-11-02',
    },
];

const BLOCKING = new Set(['high', 'critical']);
const DAY_MS = 24 * 60 * 60 * 1000;
const WARN_DAYS = 7;
const GHSA_RE = /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i;

/**
 * The high and critical advisories in an `npm audit --json` report. A package
 * that only depends on a vulnerable one has strings in `via`; the advisory
 * itself is the object, so each is counted once however many packages it taints.
 */
export function highAdvisories(report) {
    const found = new Map();
    for (const entry of Object.values((report && report.vulnerabilities) || {})) {
        for (const via of (entry && entry.via) || []) {
            if (!via || typeof via !== 'object' || !BLOCKING.has(via.severity)) continue;
            const match = GHSA_RE.exec(String(via.url || ''));
            const id = match ? match[0].toUpperCase() : String(via.url || via.source || via.title);
            found.set(`${id}|${via.name}`, { id, package: via.name, severity: via.severity, title: via.title, url: via.url });
        }
    }
    return [...found.values()];
}

/**
 * @param {{ full: object, prod: object, exceptions?: typeof EXCEPTIONS, nowMs: number }} input
 *   full: audit of every dependency; prod: audit with --omit=dev.
 */
export function judgeAudit({ full, prod, exceptions = EXCEPTIONS, nowMs }) {
    const inProd = new Set(highAdvisories(prod).map((a) => `${a.id}|${a.package}`));
    const blocking = [];
    const excepted = [];
    const seen = new Set();
    for (const a of [...highAdvisories(full), ...highAdvisories(prod)]) {
        const key = `${a.id}|${a.package}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const ex = exceptions.find((e) => e.id.toUpperCase() === a.id && e.package === a.package);
        if (!ex) { blocking.push({ ...a, why: 'no exception' }); continue; }
        if (inProd.has(key)) { blocking.push({ ...a, why: 'reaches production dependencies; exceptions cover build tools only' }); continue; }
        const due = /^\d{4}-\d{2}-\d{2}$/.test(String(ex.reviewBy)) ? Date.parse(`${ex.reviewBy}T00:00:00Z`) : NaN;
        if (!Number.isFinite(due) || nowMs >= due + DAY_MS) {
            blocking.push({ ...a, why: `its exception expired on ${ex.reviewBy}: check for a fixed version, then remove or renew it` });
            continue;
        }
        excepted.push({ ...a, reason: ex.reason, reviewBy: ex.reviewBy, daysLeft: Math.floor((due + DAY_MS - nowMs) / DAY_MS) });
    }
    const stale = exceptions.filter((e) => !seen.has(`${e.id.toUpperCase()}|${e.package}`));
    return { blocking, excepted, stale };
}

function runAudit(extra) {
    const res = spawnSync('npm', ['audit', '--json', ...extra], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (res.error) throw res.error;
    let report;
    try {
        report = JSON.parse(res.stdout);
    } catch {
        throw new Error(`npm audit ${extra.join(' ')} did not return JSON (exit ${res.status})`);
    }
    if (!report || typeof report !== 'object' || report.error || !report.vulnerabilities || typeof report.vulnerabilities !== 'object') {
        throw new Error(`npm audit ${extra.join(' ')} returned no vulnerability report`);
    }
    return report;
}

/** @returns {0|1|2} */
export function main({ audit = runAudit, nowMs = Date.now(), out = console.log } = {}) {
    let verdict;
    try {
        verdict = judgeAudit({ full: audit([]), prod: audit(['--omit=dev']), nowMs });
    } catch (err) {
        out(`::error::could not audit dependencies: ${err && err.message}`);
        return 2;
    }
    for (const a of verdict.excepted) {
        out(`excepted: ${a.id} ${a.package} (${a.severity}) until ${a.reviewBy}: ${a.reason}`);
        if (a.daysLeft <= WARN_DAYS) out(`::warning::the audit exception for ${a.id} (${a.package}) expires in ${a.daysLeft} day(s), on ${a.reviewBy}`);
    }
    for (const e of verdict.stale) out(`::notice::${e.id} (${e.package}) is no longer reported; remove its exception from scripts/check-audit.mjs`);
    if (!verdict.blocking.length) {
        out('OK: no high or critical advisory outside the listed exceptions.');
        return 0;
    }
    for (const a of verdict.blocking) out(`::error::${a.id} ${a.package} (${a.severity}): ${a.title} — ${a.why}. ${a.url || ''}`);
    return 1;
}

function invokedDirectly() {
    try {
        return !!process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
    } catch {
        return false;
    }
}

if (invokedDirectly()) process.exit(main());
