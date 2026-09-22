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
 * Needs network; not part of `npm test`.
 */

import { REGISTRY } from '../lib/modelCapabilities.js';

const BILLED = ['duration', 'duration_seconds', 'resolution', 'generate_audio', 'num_images',
    'num_outputs', 'max_images', 'image_size', 'thinking', 'video_quality', 'quality'];

async function schemaFor(endpoint) {
    const url = `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=${encodeURIComponent(endpoint)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const doc = await res.json().catch(() => null);
    const schemas = doc && doc.components && doc.components.schemas;
    if (!schemas) return null;
    const name = Object.keys(schemas).find((k) => k.endsWith('Input') && schemas[k].properties);
    return name ? schemas[name] : null;
}

function enumOf(prop) {
    if (!prop) return null;
    if (Array.isArray(prop.enum)) return prop.enum;
    const variant = (prop.anyOf || []).find((a) => Array.isArray(a.enum));
    return variant ? variant.enum : null;
}

function checkRecord(endpoint, record, schema) {
    const problems = [];
    const props = schema.properties;
    const sent = new Set();
    const need = (field, why) => {
        sent.add(field);
        if (!Object.prototype.hasOwnProperty.call(props, field)) problems.push(`${why} field "${field}" does not exist`);
    };
    const inEnum = (field, value, why) => {
        const values = enumOf(props[field]);
        if (values && !values.map(String).includes(String(value))) problems.push(`${why} ${field}=${JSON.stringify(value)} not in ${JSON.stringify(values)}`);
    };

    for (const [key, rule] of Object.entries(record.inputs)) {
        const field = record.rename[key] || key;
        need(field, 'input');
        if (rule.type === 'enum') for (const v of rule.values) inEnum(field, v, 'input');
    }
    for (const spec of Object.values(record.media)) need(spec.field, 'media');
    for (const field of record.derives || []) need(field, 'derived');
    if (record.lengths) {
        need(record.lengths.field, 'length');
        for (const v of Object.values(record.lengths.map)) inEnum(record.lengths.field, v, 'length');
    }
    for (const [field, value] of Object.entries(record.fixed)) {
        need(field, 'pinned');
        inEnum(field, value, 'pinned');
    }
    for (const [field, value] of Object.entries(record.assumes)) {
        if (!Object.prototype.hasOwnProperty.call(props, field)) { problems.push(`assumed field "${field}" does not exist`); continue; }
        const live = props[field].default;
        if (JSON.stringify(live) !== JSON.stringify(value)) problems.push(`assumed default ${field}=${JSON.stringify(value)} but fal now defaults to ${JSON.stringify(live)}`);
    }
    for (const field of schema.required || []) {
        if (!sent.has(field)) problems.push(`fal requires "${field}", which we never send`);
    }
    for (const field of BILLED) {
        if (!Object.prototype.hasOwnProperty.call(props, field)) continue;
        if (sent.has(field) || Object.prototype.hasOwnProperty.call(record.assumes, field)) continue;
        problems.push(`billing-sensitive "${field}" (default ${JSON.stringify(props[field].default)}) is neither pinned nor assumed`);
    }
    return problems;
}

let failed = 0;
for (const [endpoint, record] of Object.entries(REGISTRY)) {
    if (record.provider !== 'fal') continue;
    const schema = await schemaFor(endpoint);
    if (!schema) {
        console.log(`FAIL ${endpoint}: no live schema`);
        failed += 1;
        continue;
    }
    const problems = checkRecord(endpoint, record, schema);
    if (problems.length) {
        failed += 1;
        console.log(`FAIL ${endpoint}`);
        for (const p of problems) console.log(`  - ${p}`);
    } else {
        console.log(`ok   ${endpoint}`);
    }
}
console.log(failed ? `\n${failed} endpoint(s) out of step with fal` : '\nall fal records match the live schema');
process.exit(failed ? 1 : 0);
