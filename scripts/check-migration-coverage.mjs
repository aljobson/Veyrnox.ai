#!/usr/bin/env node
// Read-only release preflight. Health snapshots and ledger accounting alone do
// not show source migrations whose receipts are absent from an environment.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchLedger, parseJsonc, readSchemaFiles, unaccounted } from './check-migration-ledger.mjs';
import { missingMigrationReceipts } from './apply-migrations.mjs';

const PROJECTS = { production: 'xdxdzmsztyzbnzeforxx', staging: 'yrqzwqywxfesmbvhzjgj' };
export function coverageConfig(config, environment) {
    if (!Object.hasOwn(PROJECTS, environment)) throw Error('Choose production or staging explicitly');
    const vars = environment === 'production' ? config.vars : config.env?.staging?.vars;
    const url = vars?.SUPABASE_URL;
    const key = vars?.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key || new URL(url).origin !== `https://${PROJECTS[environment]}.supabase.co`) {
        throw Error(`${environment} database configuration missing or wrong project`);
    }
    return { url, key };
}

export function assessCoverage(names, files) {
    const missing = missingMigrationReceipts(names, files).map((f) => f.name);
    const unknown = unaccounted(names, files);
    return { missing_receipts: missing, unaccounted_receipts: unknown, complete: !missing.length && !unknown.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        const environment = process.argv[2];
        const root = join(dirname(fileURLToPath(import.meta.url)), '..');
        const config = coverageConfig(parseJsonc(readFileSync(join(root, 'wrangler.jsonc'), 'utf8')), environment);
        const coverage = assessCoverage(await fetchLedger(config), readSchemaFiles(root));
        if (coverage.complete) console.log(`${environment}: every source migration has an accounted receipt.`);
        else {
            console.error(`${environment}: migration coverage is incomplete; health snapshots are not a schema-readiness verdict.`);
            for (const name of coverage.missing_receipts) console.error(`Missing receipt: ${name}`);
            for (const name of coverage.unaccounted_receipts) console.error(`Unaccounted receipt: ${name}`);
            console.error('Inspect actual database state before replaying historical SQL; a missing receipt alone does not prove it never ran.');
        }
        process.exitCode = coverage.complete ? 0 : 1;
    } catch (error) {
        console.error(`Migration coverage could not be checked: ${error.message}`);
        process.exitCode = 2;
    }
}
