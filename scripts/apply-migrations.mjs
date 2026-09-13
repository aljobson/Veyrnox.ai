#!/usr/bin/env node
/**
 * Apply main's unapplied Supabase migrations to production, one at a time.
 *
 * On 2026-09-13 several sessions applied the same migration to production
 * within seconds of each other (0065 three times), some with comments
 * stripped, because every session could call apply_migration. This script
 * is the one path: .github/workflows/apply-migrations.yml runs it on main,
 * serialised, behind the owner's approval (ADR-0023).
 *
 *   node scripts/apply-migrations.mjs plan    list pending files (public ledger, no secret)
 *   node scripts/apply-migrations.mjs apply   apply them (SUPABASE_ACCESS_TOKEN)
 *
 * Pending = a packages/db/schema/supabase/NNNN_*.sql file that production
 * has not applied. A file counts as applied when production has a migration
 * with its descriptive name (numbers are ignored: files were renumbered after
 * applying, e.g. 0067_veo_4s_clip_costs was applied as 0066_…), when its
 * "-- Applied name: X" header names an applied X, or when an applied batch
 * name NNNN_MMMM_… spans its number. A name merely mentioned in prose does
 * not count, so a new file that refers to older migrations is still applied.
 *
 * Safety:
 *   - A pending file numbered below an applied one stops the run: either
 *     the accounting is wrong (and applying would re-run old DDL) or a file
 *     was merged out of order. A human decides.
 *   - The ledger is re-read before every apply, so a migration someone else
 *     applied meanwhile is skipped, not recorded twice.
 *   - Each file is sent byte for byte under its own name, with an
 *     Idempotency-Key bound to its content, so a retried request is tracked
 *     once. The first failure stops the run.
 *
 * Exit: 0 done (or nothing pending), 1 an apply failed, 2 could not plan.
 */

import { createHash } from 'node:crypto';
import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { batchRange, descriptiveName, fetchLedger, supabaseConfig } from './check-migration-ledger.mjs';

const MANAGEMENT_API = 'https://api.supabase.com/v1';
const FILE_RE = /^(\d{4})_[a-z0-9_]+\.sql$/;
const APPLIED_HEADER_RE = /^--\s*Applied name:\s*([0-9]{4}_[a-z0-9_]+)/gim;
const TIMEOUT_MS = 60000;

/** 'https://<20 lowercase letters>.supabase.co' -> ref. Anything else throws. */
export function projectRef(url) {
    const m = /^https:\/\/([a-z]{20})\.supabase\.co\/?$/.exec(String(url ?? ''));
    if (!m) throw new Error('not a Supabase URL: expected https://<project ref>.supabase.co');
    return m[1];
}

function fileNumber(name) {
    return Number(FILE_RE.exec(name)[1]);
}

function isApplied(file, applied, appliedStems, ranges) {
    if (appliedStems.has(descriptiveName(file.name))) return true;
    for (const m of file.text.matchAll(APPLIED_HEADER_RE)) {
        if (applied.has(m[1])) return true;
    }
    const n = fileNumber(file.name);
    return ranges.some((r) => n >= r.from && n <= r.to);
}

/**
 * @param {string[]} appliedNames  production's migration names
 * @param {{name: string, text: string}[]} files  supabase schema files
 * @returns {{name: string, text: string}[]} unapplied files, lowest number first
 */
export function pendingMigrations(appliedNames, files) {
    const applied = new Set(appliedNames);
    const appliedStems = new Set(appliedNames.map(descriptiveName));
    const ranges = appliedNames.map(batchRange).filter((r) => r && !r.invalid);

    const numbered = files.filter((f) => FILE_RE.test(f.name));
    const pending = [];
    let highestApplied = -1;
    for (const f of numbered) {
        if (isApplied(f, applied, appliedStems, ranges)) highestApplied = Math.max(highestApplied, fileNumber(f.name));
        else pending.push(f);
    }
    pending.sort((a, b) => fileNumber(a.name) - fileNumber(b.name) || a.name.localeCompare(b.name));

    const early = pending.filter((f) => fileNumber(f.name) < highestApplied);
    if (early.length) {
        throw new Error(
            `out of order: ${early.map((f) => f.name).join(', ')} not applied, but production has ` +
            `migration ${String(highestApplied).padStart(4, '0')}. Check the accounting or renumber; nothing was applied.`,
        );
    }
    return pending;
}

const stem = (name) => name.replace(/\.sql$/, '');

/**
 * Apply pending files in order. The ledger is read once to plan and again
 * before each file.
 *
 * @param {{name: string, text: string}[]} files
 * @param {{listApplied: () => Promise<string[]>,
 *   apply: (req: {name: string, query: string, idempotencyKey: string}) => Promise<{ok: boolean, error?: string}>,
 *   log?: (...a: any[]) => void}} deps
 */
export async function applyPending(files, deps) {
    const log = deps.log ?? console.log;
    const out = { applied: [], skipped: [], failed: null };
    const planned = pendingMigrations(await deps.listApplied(), files);

    for (const file of planned) {
        const name = stem(file.name);
        const stillPending = pendingMigrations(await deps.listApplied(), files).some((f) => f.name === file.name);
        if (!stillPending) {
            log(`skip ${name}: applied by someone else since the plan`);
            out.skipped.push(name);
            continue;
        }
        const idempotencyKey = `${name}-${createHash('sha256').update(file.text).digest('hex').slice(0, 32)}`;
        const res = await deps.apply({ name, query: file.text, idempotencyKey });
        if (!res.ok) {
            out.failed = { name, error: res.error };
            return out;
        }
        log(`applied ${name}`);
        out.applied.push(name);
    }
    return out;
}

/** Management API client for one project. Response bodies never reach logs. */
export function managementClient({ token, ref, fetch }) {
    if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is not set');
    const url = `${MANAGEMENT_API}/projects/${projectRef(`https://${ref}.supabase.co`)}/database/migrations`;
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
    return {
        async listApplied() {
            const res = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
            if (!res.ok) throw new Error(`supabase ${res.status}`);
            const rows = await res.json();
            if (!Array.isArray(rows)) throw new Error('supabase migrations list is not an array');
            return rows.map((r) => r && r.name).filter((n) => typeof n === 'string');
        },
        async apply({ name, query, idempotencyKey }) {
            const res = await fetch(url, {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
                body: JSON.stringify({ name, query }),
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
            return res.ok ? { ok: true } : { ok: false, error: `supabase ${res.status}` };
        },
    };
}

function readSupabaseFiles(root) {
    const dir = join(root, 'packages/db/schema/supabase');
    return readdirSync(dir)
        .filter((name) => FILE_RE.test(name))
        .map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }));
}

function output(key, value) {
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const mode = process.argv[2];
    const files = readSupabaseFiles(root);

    if (mode === 'plan') {
        let pending;
        try {
            pending = pendingMigrations(await fetchLedger(supabaseConfig(root)), files);
        } catch (err) {
            console.error(`could not plan: ${err && err.message}`);
            process.exit(2);
        }
        output('count', pending.length);
        output('names', pending.map((f) => stem(f.name)).join(' '));
        console.log(pending.length ? `pending:\n${pending.map((f) => `  ${stem(f.name)}`).join('\n')}` : 'nothing pending');
        process.exit(0);
    }

    if (mode === 'apply') {
        let client;
        let result;
        try {
            client = managementClient({
                token: process.env.SUPABASE_ACCESS_TOKEN,
                ref: projectRef(supabaseConfig(root).url),
                fetch: globalThis.fetch,
            });
            result = await applyPending(files, client);
        } catch (err) {
            console.error(`could not apply: ${err && err.message}`);
            process.exit(2);
        }
        console.log(`applied: ${result.applied.join(', ') || 'none'}; skipped: ${result.skipped.join(', ') || 'none'}`);
        if (result.failed) {
            console.error(`FAILED ${result.failed.name}: ${result.failed.error}. Later files were not applied.`);
            process.exit(1);
        }
        process.exit(0);
    }

    console.error('usage: node scripts/apply-migrations.mjs plan|apply');
    process.exit(2);
}
