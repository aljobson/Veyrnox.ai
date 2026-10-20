#!/usr/bin/env node
// Run from apps/mobile. Snapshot the plain web module without making Metro resolve outside the mobile app.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const file = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const source = readFileSync(file('../../../app/veyrnox/_lib/guides.js'), 'utf8');
const { GUIDES } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const strings = {};
function key(name, value) {
    const full = `helpGuides.content.${name}`;
    strings[full] = value;
    return full;
}
const guides = GUIDES.map(g => ({
    id: g.id,
    title: key(`${g.id}.title`, g.title),
    summary: key(`${g.id}.summary`, g.summary),
    steps: g.steps.map((s, i) => ({
        title: key(`${g.id}.s${i + 1}.title`, s.title),
        body: key(`${g.id}.s${i + 1}.body`, s.body),
    })),
    links: g.links.map((l, i) => ({ label: key(`${g.id}.l${i + 1}`, l.label), href: l.href })),
}));
const data = `// Generated from app/veyrnox/_lib/guides.js by node scripts/sync-help-guides.mjs.
// Do not edit. Copy lives in the helpGuides English area; mobile overrides are separate.
export const HELP_GUIDES = ${JSON.stringify(guides, null, 4)} as const;
`;
const areaPath = file('../src/lib/i18n/messages/en/helpGuides.ts');
const area = readFileSync(areaPath, 'utf8');
const marker = /    \/\/ BEGIN GENERATED GUIDE COPY\n[\s\S]*?    \/\/ END GENERATED GUIDE COPY/;
if (!marker.test(area)) throw new Error('Missing generated guide copy markers');
const generated = Object.entries(strings).map(([k, value]) => `    ${JSON.stringify(k)}: ${JSON.stringify(value)},`).join('\n');
const nextArea = area.replace(marker, `    // BEGIN GENERATED GUIDE COPY\n${generated}\n    // END GENERATED GUIDE COPY`);
for (const [output, expected] of [[file('../src/lib/helpGuidesData.ts'), data], [areaPath, nextArea]]) {
    if (process.argv.includes('--check')) {
        if (readFileSync(output, 'utf8') !== expected) {
            console.error('Guide snapshot is stale. Run node scripts/sync-help-guides.mjs');
            process.exitCode = 1;
        }
    } else writeFileSync(output, expected);
}
if (!process.exitCode) console.log(process.argv.includes('--check') ? 'Guide snapshot is current.' : 'Wrote guide snapshot and English copy.');
