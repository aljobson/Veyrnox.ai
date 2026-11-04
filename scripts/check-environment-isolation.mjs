#!/usr/bin/env node
// Fails if production and staging share a database URL, publishable key,
// host or Access audience in wrangler.jsonc, or if a wallet project ref
// shows up. No network, no secrets. Exit 0 isolated, 1 problems.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findIsolationProblems } from '../packages/security/environmentIsolation.js';
import { parseJsonc } from './check-migration-ledger.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(join(root, 'wrangler.jsonc'), 'utf8');
const problems = findIsolationProblems(parseJsonc(raw), raw);
if (problems.length) {
    console.error(`Environment isolation FAILED:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    process.exit(1);
}
console.log('Environment isolation OK: separate Supabase projects, publishable keys and Access audiences; staging host is not a production hostname.');
console.log('Not checked here: production PUBLIC_HOST (set outside wrangler.jsonc) and all secrets (service-role, R2, Stripe keys). Those need an owner-run check.');
