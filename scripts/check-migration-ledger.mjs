#!/usr/bin/env node
/**
 * Every migration the database has applied must be accounted for in this
 * repository. check-migration-numbers.sh only compares the repository's
 * files with each other, so it cannot see a migration that was applied
 * straight to the database and never committed. That gap hid four
 * unapplied security migrations on 2026-09-12 and, hours later, let a
 * catalog fix exist only in production.
 *
 * An applied migration is accounted for when either:
 *
 *   - a file in packages/db/schema/ carries its descriptive name. Numbers
 *     are ignored, because files were renumbered to apply order and the
 *     database keeps the names it was given at the time
 *     (0018_floor_pricing_and_veo_fast is now 0020_…); or
 *   - its full applied name is written inside a schema file or README. That
 *     is how a deliberate fold is recorded, so a follow-up merged into an
 *     earlier file is not reported as missing; or
 *   - it is a batched replay named for a range, NNNN_MMMM_…, and every file
 *     numbered NNNN through MMMM exists. A fresh project built from this
 *     folder records several files as one entry that way (PR #80's EU
 *     project). Requiring every number in the range keeps a deleted file
 *     from hiding inside a batch.
 *
 * Usage:
 *
 *   node scripts/check-migration-ledger.mjs             # fetch the live ledger
 *   node scripts/check-migration-ledger.mjs ledger.json # or read a saved one
 *
 * With no argument it calls the anon-callable applied_migration_names() RPC
 * (migration 0034). The Supabase URL and publishable key come from
 * SUPABASE_URL / SUPABASE_ANON_KEY if set, otherwise from wrangler.jsonc —
 * both are public by design, so CI needs no secret. A file argument is a JSON
 * array of names, for offline use.
 *
 * Exit 0 when every entry is accounted for, 1 when something is missing, 2
 * when the ledger could not be read. The distinction matters in CI: an
 * outage must not look like drift, and must not look like a pass either.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 'phase1_0006_ledger_rpc_functions' -> 'ledger_rpc_functions' */
export function descriptiveName(name) {
    return String(name).replace(/^phase\d+_/, '').replace(/^\d{4}_/, '').replace(/\.sql$/, '');
}

/**
 * @param {string[]} appliedNames  names from supabase_migrations.schema_migrations
 * @param {{name:string, text:string}[]} repoFiles  schema files and READMEs
 * @returns {string[]} applied names with no trace in the repository
 */
// A replay batch is named for the span it covers. Anything wider than this is
// not a batch anyone wrote; treat it as unaccounted rather than as a blanket.
const MAX_BATCH_SPAN = 50;

/** '0002_0005_seed…' -> {from: 2, to: 5}; anything else -> null. */
export function batchRange(name) {
    const m = /^(?:phase\d+_)?(\d{4})_(\d{4})_/.exec(String(name));
    if (!m) return null;
    const from = Number(m[1]);
    const to = Number(m[2]);
    if (to < from || to - from > MAX_BATCH_SPAN) return { invalid: true };
    return { from, to };
}

export function unaccounted(appliedNames, repoFiles) {
    const sqlFiles = repoFiles.filter((f) => f.name.endsWith('.sql'));
    const fileStems = new Set(sqlFiles.map((f) => descriptiveName(f.name)));
    const fileNumbers = new Set(
        sqlFiles.map((f) => /^(\d{4})_/.exec(f.name)).filter(Boolean).map((m) => Number(m[1])),
    );
    const corpus = repoFiles.map((f) => f.text).join('\n');
    return appliedNames.filter((applied) => {
        const range = batchRange(applied);
        if (range) {
            if (range.invalid) return true;
            for (let n = range.from; n <= range.to; n++) {
                if (!fileNumbers.has(n)) return true;
            }
            return false;
        }
        if (fileStems.has(descriptiveName(applied))) return false;
        return !corpus.includes(applied);
    });
}

/**
 * Parse wrangler.jsonc. Two JSONC features appear there: full-line // comments
 * (dropped whole, so the '//' inside URLs is never touched) and a trailing
 * comma that the dropped comment block leaves dangling before the closing
 * brace. No string value in that file contains ',}' or ',]', so the comma
 * rule cannot corrupt one.
 */
export function parseJsonc(text) {
    const withoutComments = String(text)
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('//'))
        .join('\n');
    return JSON.parse(withoutComments.replace(/,(\s*[}\]])/g, '$1'));
}

/** PostgREST returns RETURNS TABLE(name) as [{name}]; reduce to names. */
export function namesFromRpc(rows) {
    if (!Array.isArray(rows)) throw new Error('ledger RPC did not return an array');
    return rows.map((r) => {
        if (!r || typeof r.name !== 'string') throw new Error('ledger RPC row has no name');
        return r.name;
    });
}

function supabaseConfig(root) {
    let url = process.env.SUPABASE_URL;
    let key = process.env.SUPABASE_ANON_KEY;
    if (!url || !key) {
        const vars = parseJsonc(readFileSync(join(root, 'wrangler.jsonc'), 'utf8')).vars || {};
        url = url || vars.SUPABASE_URL;
        key = key || vars.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    }
    if (!url || !key) throw new Error('no Supabase URL or publishable key in env or wrangler.jsonc');
    return { url, key };
}

async function fetchLedger({ url, key }) {
    const res = await fetch(new URL('/rest/v1/rpc/applied_migration_names', url), {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
        throw new Error(`ledger RPC answered ${res.status} — is migration 0034 applied?`);
    }
    return namesFromRpc(await res.json());
}

function readSchemaFiles(root) {
    const out = [];
    for (const dir of ['packages/db/schema', 'packages/db/schema/supabase']) {
        let names;
        try { names = readdirSync(join(root, dir)); } catch { continue; }
        for (const name of names) {
            if (!name.endsWith('.sql') && name !== 'README.md') continue;
            out.push({ name, text: readFileSync(join(root, dir, name), 'utf8') });
        }
    }
    return out;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const ledgerPath = process.argv[2];
    let applied;
    try {
        applied = ledgerPath
            ? JSON.parse(readFileSync(ledgerPath, 'utf8'))
            : await fetchLedger(supabaseConfig(root));
    } catch (err) {
        // Exit 2, not 1: CI should show "could not check", never "drift" or "OK".
        console.error(`could not read the migration ledger: ${err && err.message}`);
        process.exit(2);
    }
    const missing = unaccounted(applied, readSchemaFiles(root));
    if (missing.length === 0) {
        console.log(`migration ledger OK — all ${applied.length} applied migrations accounted for`);
        process.exit(0);
    }
    console.error(`${missing.length} applied migration(s) with no trace in the repository:`);
    for (const m of missing) console.error(`  ${m}`);
    console.error('\nCommit the migration file. If it was folded into another file on purpose,');
    console.error('write its full applied name in that file or in the schema README.');
    process.exit(1);
}
