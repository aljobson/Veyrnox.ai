#!/usr/bin/env node
// Run from apps/mobile; resolve all paths inside this checkout.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const file = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const source = readFileSync(file('../../../app/veyrnox/social-cinema/editorialSeries.js'), 'utf8');
const { editorialSeries } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const validId = (id) => typeof id === 'string' && /^[a-z0-9-]{1,80}$/.test(id);
const episodeIds = new Set();
const series = editorialSeries.map(s => {
    if (!validId(s.slug)) throw new Error('Invalid Cinema series slug');
    if (typeof s.posterUrl !== 'string' || !s.posterUrl.startsWith('https://i.ytimg.com/vi/')) throw new Error('Invalid Cinema series poster');
    return {
        slug: s.slug, title: s.title, season: s.season, seasonTitle: s.seasonTitle,
        description: s.description, posterUrl: s.posterUrl, categories: s.categories,
        creatorName: s.creator.name, sourceName: s.source.name,
        episodes: s.episodes.map((e, index) => {
            if (!validId(e.id) || episodeIds.has(e.id)) throw new Error('Invalid or duplicate Cinema episode id');
            if (e.position !== index + 1) throw new Error('Invalid Cinema episode position');
            if (!Number.isInteger(e.durationSeconds) || e.durationSeconds <= 0) throw new Error('Invalid Cinema episode duration');
            episodeIds.add(e.id);
            return { id: e.id, position: e.position, title: e.title, durationSeconds: e.durationSeconds };
        }),
    };
});
const data = `// Generated from app/veyrnox/social-cinema/editorialSeries.js by node scripts/sync-cinema-series.mjs. Do not edit.
export const EDITORIAL_SERIES = ${JSON.stringify(series, null, 4)} as const;
`;
const output = file('../src/lib/cinemaEditorialData.ts');
if (process.argv.includes('--check')) {
    if (!existsSync(output) || readFileSync(output, 'utf8') !== data) {
        console.error('Cinema series snapshot is stale. Run node scripts/sync-cinema-series.mjs');
        process.exitCode = 1;
    } else console.log('Cinema series snapshot is current.');
} else {
    writeFileSync(output, data);
    console.log('Wrote Cinema series snapshot.');
}
