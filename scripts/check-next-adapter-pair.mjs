#!/usr/bin/env node
// Fails when the locked next major.minor is not one the locked
// @opennextjs/cloudflare is known to run. CI never ran the built Worker, so
// next 16.4.2 + adapter 1.20.8 shipped and every page 500ed on 2026-10-19:
// next 16.4 loads server/preview-props.json at runtime and only adapter
// >= 1.20.12 inlines it (dist/cli/build/patches/plugins/load-manifest.js).
// Reads package-lock.json, so it needs no install. The worker-smoke job in
// ci.yml is the runtime proof; this is the fast, readable version of it.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// adapter version -> next major.minor lines it is known to run.
// Add a row only after worker-smoke passes on that pair.
export const KNOWN_PAIRS = {
    '1.20.8': ['16.3'],
    // Verified in the adapter source (preview-props.json inlined); worker-smoke
    // must pass on the PR that moves to it.
    '1.20.12': ['16.4'],
};

export function checkPair(nextVersion, adapterVersion, table = KNOWN_PAIRS) {
    const line = String(nextVersion).split('.').slice(0, 2).join('.');
    const allowed = table[adapterVersion];
    if (!allowed) {
        return [`@opennextjs/cloudflare ${adapterVersion} is not in KNOWN_PAIRS (scripts/check-next-adapter-pair.mjs). `
            + `Known: ${Object.keys(table).join(', ')}. Run worker-smoke on the new version, then add a row.`];
    }
    if (!allowed.includes(line)) {
        return [`next ${nextVersion} (${line}.x) is not known to work with @opennextjs/cloudflare ${adapterVersion} `
            + `(known: next ${allowed.map((l) => `${l}.x`).join(', ')}). Bump the adapter in the same PR, or revert next. `
            + 'See the 2026-10-19 outage: next 16.4 + adapter 1.20.8 = every page 500.'];
    }
    return [];
}

export function lockedVersion(lock, name) {
    const v = lock.packages?.[`node_modules/${name}`]?.version;
    if (!v) throw new Error(`${name} not found in package-lock.json`);
    return v;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
    const next = lockedVersion(lock, 'next');
    const adapter = lockedVersion(lock, '@opennextjs/cloudflare');
    const problems = checkPair(next, adapter);
    if (problems.length) {
        for (const p of problems) console.error(`check-next-adapter-pair: ${p}`);
        process.exit(1);
    }
    console.log(`check-next-adapter-pair: next ${next} + @opennextjs/cloudflare ${adapter} ok`);
}
