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
 *     earlier file is not reported as missing.
 *
 * Usage — the ledger comes from wherever has database access:
 *
 *   select name from supabase_migrations.schema_migrations order by version
 *
 *   node scripts/check-migration-ledger.mjs ledger.json
 *
 * where ledger.json is a JSON array of those names. Exit 0 when every entry
 * is accounted for, 1 otherwise.
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
export function unaccounted(appliedNames, repoFiles) {
    const fileStems = new Set(
        repoFiles.filter((f) => f.name.endsWith('.sql')).map((f) => descriptiveName(f.name)),
    );
    const corpus = repoFiles.map((f) => f.text).join('\n');
    return appliedNames.filter((applied) => {
        if (fileStems.has(descriptiveName(applied))) return false;
        return !corpus.includes(applied);
    });
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
    const ledgerPath = process.argv[2];
    if (!ledgerPath) {
        console.error('usage: node scripts/check-migration-ledger.mjs <ledger.json>');
        process.exit(2);
    }
    const applied = JSON.parse(readFileSync(ledgerPath, 'utf8'));
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
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
