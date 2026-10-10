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
    const pending = missingMigrationReceipts(names, files);
    const pendingNames = new Set(pending.map(f => f.name));
    const numbered = files.filter(f => /^\d{4}_[a-z0-9_]+\.sql$/.test(f.name));
    const missing = [];
    const reconciled = [];
    for (const file of pending) {
        // A forward repair needs its own real receipt and must name an older
        // source file explicitly. Prose, absent receipts and cycles cannot cover it.
        const repairs = numbered.filter(candidate => !pendingNames.has(candidate.name)
            && Number(candidate.name.slice(0, 4)) > Number(file.name.slice(0, 4))
            && [...candidate.text.matchAll(/^--\s*Reconciles migration:\s*(\d{4}_[a-z0-9_]+)\s*$/gm)]
                .some(match => match[1] + '.sql' === file.name));
        if (repairs.length > 1) throw Error('Ambiguous forward repairs for ' + file.name);
        if (repairs.length) reconciled.push({ migration: file.name, reconciled_by: repairs[0].name });
        else missing.push(file.name);
    }
    const unknown = unaccounted(names, files);
    return { missing_receipts: missing, reconciled_receipts: reconciled, unaccounted_receipts: unknown,
        complete: !missing.length && !unknown.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        const environment = process.argv[2];
        const root = join(dirname(fileURLToPath(import.meta.url)), '..');
        const config = coverageConfig(parseJsonc(readFileSync(join(root, 'wrangler.jsonc'), 'utf8')), environment);
        const coverage = assessCoverage(await fetchLedger(config), readSchemaFiles(root));
        for (const repair of coverage.reconciled_receipts) {
            console.log('Forward reconciliation: ' + repair.migration + ' via ' + repair.reconciled_by
                + '; the original receipt remains absent.');
        }
        if (coverage.complete) console.log(coverage.reconciled_receipts.length
            ? environment + ': every source migration has an accounted receipt or explicit applied forward repair.'
            : environment + ': every source migration has an accounted receipt.');
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
