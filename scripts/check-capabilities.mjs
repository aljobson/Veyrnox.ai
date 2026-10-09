#!/usr/bin/env node
/**
 * Check every fal record in lib/modelCapabilities.js against fal's live
 * OpenAPI schema. Fails when fal's contract no longer matches what we send or
 * what the price assumes:
 *
 *   - a field we send (input, rename target, media slot, length field, pin)
 *     does not exist on the endpoint
 *   - a value we send is outside fal's enum
 *   - fal requires a field we never send
 *   - a default the price relies on (`assumes`) changed
 *   - the endpoint has a billing-sensitive field (length, resolution, audio,
 *     output count, size) that we neither pin, map, nor assume. That is how
 *     Veo (8s), Wan 2.5 (1080p) and Kling 2.6 (audio on) were billed above
 *     their catalog price in September 2026.
 *
 * Usage: node scripts/check-capabilities.mjs        # exit 1 on any finding
 * Needs network; not part of `npm test`. The comparison is in
 * scripts/lib/capability-check.mjs, which `npm test` covers.
 */

import { REGISTRY } from '../lib/modelCapabilities.js';
import { STEPS } from '../lib/autoShortSteps.js';
import { checkRecord, inputSchemaOf } from './lib/capability-check.mjs';

async function schemaFor(endpoint) {
    const url = `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=${encodeURIComponent(endpoint)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return inputSchemaOf(await res.json().catch(() => null));
}

let failed = 0;
// Auto Short steps (ADR-0029) call fal outside the catalog; check them too.
const stepRecords = Object.entries(STEPS).map(([name, s]) => [s.endpoint, s.record, `step:${name}`]);
for (const [endpoint, record, label = endpoint] of [...Object.entries(REGISTRY), ...stepRecords]) {
    if (record.provider !== 'fal') continue;
    const live = await schemaFor(endpoint);
    if (!live) {
        console.log(`FAIL ${label}: no live schema`);
        failed += 1;
        continue;
    }
    const problems = checkRecord(record, live.schema, live.schemas);
    if (problems.length) {
        failed += 1;
        console.log(`FAIL ${label}`);
        for (const p of problems) console.log(`  - ${p}`);
    } else {
        console.log(`ok   ${label}`);
    }
}
console.log(failed ? `\n${failed} endpoint(s) out of step with fal` : '\nall fal records match the live schema');
process.exit(failed ? 1 : 0);
