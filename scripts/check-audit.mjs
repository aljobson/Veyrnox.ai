#!/usr/bin/env node
// The dependency audit gate (ADR-0067). Fails on any high or critical
// advisory, as `npm audit --audit-level=high` did, with one narrow way out:
// an advisory listed in scripts/audit-exceptions.json passes while its
// exception is in date AND the advisory does not reach a production
// dependency. Exit 0 clean, 1 findings, 2 the audit could not be read.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SEVERE = new Set(['high', 'critical']);
const GHSA_RE = /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i;
const GHSA_ID_RE = /^GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$/i;
// An exception is a deadline, not a waiver: none may run further out than this.
export const MAX_EXCEPTION_DAYS = 90;
const EXPIRY_WARNING_DAYS = 7;
const MIN_REASON_LENGTH = 20;
const DAY_MS = 86_400_000;

/** High and critical advisories in an `npm audit --json` report (version 2). */
export function severeAdvisories(report) {
    if (!report || report.auditReportVersion !== 2 || typeof report.vulnerabilities !== 'object' || report.vulnerabilities === null) {
        throw new Error('not an npm audit report (version 2)');
    }
    const seen = new Map();
    for (const entry of Object.values(report.vulnerabilities)) {
        for (const via of Array.isArray(entry.via) ? entry.via : []) {
            // A string names another vulnerable package; its own entry holds the advisory.
            if (!via || typeof via !== 'object' || !SEVERE.has(via.severity)) continue;
            const match = GHSA_RE.exec(String(via.url || ''));
            // No GHSA link means nothing an exception could name, so it always fails.
            const id = match ? match[0] : `npm:${via.source}`;
            const key = `${id.toLowerCase()}|${via.name}`;
            if (!seen.has(key)) seen.set(key, { id, package: via.name, severity: via.severity, title: via.title || '', url: via.url || '' });
        }
    }
    return [...seen.values()];
}

const dayOf = (text) => Date.parse(`${text}T00:00:00Z`);
// A real calendar day: 2026-02-31 parses, but not back to itself.
const isDay = (text) => typeof text === 'string' && !Number.isNaN(dayOf(text)) && new Date(dayOf(text)).toISOString().slice(0, 10) === text;

function exceptionProblem(e, today) {
    if (!e || typeof e !== 'object') return 'is not an object';
    if (typeof e.id !== 'string' || !GHSA_ID_RE.test(e.id)) return 'has no GHSA id';
    if (typeof e.package !== 'string' || !e.package) return 'names no package';
    if (typeof e.reason !== 'string' || e.reason.trim().length < MIN_REASON_LENGTH) return 'has no written reason';
    if (!isDay(e.expires)) return 'has no expiry date (YYYY-MM-DD)';
    if (dayOf(e.expires) - dayOf(today) > MAX_EXCEPTION_DAYS * DAY_MS) return `expires more than ${MAX_EXCEPTION_DAYS} days out`;
    return null;
}

/**
 * @param {{ full: object, prod: object, exceptions: unknown, today: string }} input
 *   full: audit of every dependency; prod: audit with dev dependencies omitted;
 *   today: YYYY-MM-DD (UTC). An exception is valid through its expiry day.
 */
export function assessAudit({ full, prod, exceptions, today }) {
    const failures = [];
    const warnings = [];
    const excepted = [];
    const list = Array.isArray(exceptions) ? exceptions : null;
    if (!list) failures.push('audit-exceptions.json must hold an array');

    const valid = [];
    for (const e of list || []) {
        const problem = exceptionProblem(e, today);
        if (problem) failures.push(`exception ${JSON.stringify(e && e.id)} ${problem}`);
        else valid.push(e);
    }

    const keyOf = (id, pkg) => `${String(id).toLowerCase()}|${pkg}`;
    const reachesProd = new Set(severeAdvisories(prod).map((a) => keyOf(a.id, a.package)));
    const used = new Set();
    for (const a of severeAdvisories(full)) {
        const label = `${a.id} ${a.package} (${a.severity})${a.title ? `: ${a.title}` : ''}`;
        const key = keyOf(a.id, a.package);
        if (reachesProd.has(key)) {
            failures.push(`${label} — reaches a production dependency; no exception applies`);
            continue;
        }
        const exception = valid.find((e) => keyOf(e.id, e.package) === key);
        if (!exception) {
            failures.push(`${label} — no fix applied and no exception`);
            continue;
        }
        used.add(exception);
        const daysLeft = Math.round((dayOf(exception.expires) - dayOf(today)) / DAY_MS);
        if (daysLeft < 0) {
            failures.push(`${label} — its exception expired on ${exception.expires}`);
            continue;
        }
        excepted.push(`${label} — excepted until ${exception.expires}`);
        if (daysLeft <= EXPIRY_WARNING_DAYS) warnings.push(`the exception for ${a.id} (${a.package}) expires on ${exception.expires}`);
    }
    const unused = valid.filter((e) => !used.has(e)).map((e) => `${e.id} (${e.package})`);
    return { failures, warnings, excepted, unused };
}

function npmAudit(args) {
    return new Promise((resolve, reject) => {
        // npm exits 1 when it finds anything; the JSON on stdout is what counts.
        execFile('npm', ['audit', '--json', ...args], { maxBuffer: 64 * 1024 * 1024 }, (_error, stdout) => {
            try {
                const report = JSON.parse(stdout);
                if (report.error || report.auditReportVersion !== 2) throw new Error((report.error && report.error.summary) || 'unexpected audit output');
                resolve(report);
            } catch (err) {
                reject(new Error(`npm audit ${args.join(' ')} gave no readable report: ${err.message}`));
            }
        });
    });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        const exceptions = JSON.parse(readFileSync(new URL('./audit-exceptions.json', import.meta.url), 'utf8'));
        const [full, prod] = await Promise.all([npmAudit([]), npmAudit(['--omit=dev'])]);
        const today = new Date().toISOString().slice(0, 10);
        const { failures, warnings, excepted, unused } = assessAudit({ full, prod, exceptions, today });
        for (const line of excepted) console.log(`excepted: ${line}`);
        for (const line of unused) console.log(`unused exception, remove it: ${line}`);
        for (const line of warnings) console.log(`::warning::${line}`);
        if (failures.length === 0) {
            console.log('Audit gate passed: no unexcepted high or critical advisory.');
        } else {
            console.error(`Audit gate failed (${failures.length}):`);
            for (const line of failures) console.error(`- ${line}`);
            process.exitCode = 1;
        }
    } catch (error) {
        console.error(error.message);
        process.exitCode = 2;
    }
}
