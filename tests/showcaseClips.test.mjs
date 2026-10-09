// The landing tiles play short loops from public/showcase. The manifest is the
// only place that names a clip, so a typo or an oversized file has to fail
// here, not as a silent 404 (or a 20 MB download) on the live page.
//
// Invalid fixtures exercise the validator; coverage checks keep every landing
// tile populated when the feature cards or template wall change.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SHOWCASE_CLIPS, SHOWCASE_SOURCES, MAX_CLIP_BYTES } from '../app/veyrnox/_lib/showcase.js';
import { FEATURE_CARDS, PRESETS, WALL_PRESETS } from '../app/veyrnox/_lib/tokens.js';

const PUBLIC = new URL('../public', import.meta.url).pathname;
const TILE_KEYS = new Set([...FEATURE_CARDS.map((f) => f.key), ...PRESETS.map((p) => p.id)]);
const PATH_RE = {
    video: /^\/showcase\/[a-z0-9-]+\.(mp4|webm)$/,
    poster: /^\/showcase\/[a-z0-9-]+\.(jpg|webp)$/,
};

/** Returns a list of human-readable problems; empty means the manifest is sound. */
function problems(manifest, { tileKeys, publicDir, maxBytes }) {
    const found = [];
    for (const [key, clip] of Object.entries(manifest)) {
        if (!tileKeys.has(key)) found.push(`"${key}" matches no FEATURE_CARDS key or PRESETS id`);
        for (const field of ['video', 'poster']) {
            const src = clip[field];
            if (field === 'poster' && src === undefined) continue;
            if (typeof src !== 'string' || !PATH_RE[field].test(src)) {
                found.push(`${key}.${field} must be /showcase/<slug> with a ${field} extension`);
            } else if (!existsSync(`${publicDir}${src}`)) {
                found.push(`${key}.${field} points at ${src}, which is not in public/`);
            }
        }
        const video = clip.video;
        if (typeof video === 'string' && existsSync(`${publicDir}${video}`)
            && statSync(`${publicDir}${video}`).size > maxBytes) {
            found.push(`${key} exceeds ${maxBytes} bytes`);
        }
    }
    return found;
}

const opts = { tileKeys: TILE_KEYS, publicDir: PUBLIC, maxBytes: MAX_CLIP_BYTES };

test('the validator rejects an unknown tile, an off-path clip and a missing file', () => {
    const bad = problems(
        {
            'no-such-tile': { video: '/showcase/x.mp4' },
            'wan-2.5-kie': { video: 'https://cdn.example.com/x.mp4' },
            'cctv-night': { video: '/showcase/does-not-exist.mp4', poster: '/showcase/does-not-exist.jpg' },
        },
        opts,
    );
    assert.ok(bad.some((p) => p.includes('no-such-tile')), 'unknown tile not caught');
    assert.ok(bad.some((p) => p.includes('wan-2.5-kie.video must be')), 'off-origin path not caught');
    const swapped = problems({ 'cctv-night': { video: '/showcase/a.jpg', poster: '/showcase/a.mp4' } }, opts);
    assert.ok(swapped.some((p) => p.includes('cctv-night.video must be')), 'image used as video not caught');
    assert.ok(swapped.some((p) => p.includes('cctv-night.poster must be')), 'video used as poster not caught');
    assert.ok(bad.some((p) => p.includes('cctv-night.video points at')), 'missing file not caught');
    assert.ok(bad.some((p) => p.includes('cctv-night.poster points at')), 'missing poster not caught');
});

test('the validator rejects a clip over the size cap and accepts one under it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'showcase-'));
    try {
        mkdirSync(join(dir, 'showcase'));
        writeFileSync(join(dir, 'showcase', 'big.mp4'), Buffer.alloc(2048));
        const manifest = { 'cctv-night': { video: '/showcase/big.mp4' } };
        const over = problems(manifest, { ...opts, publicDir: dir, maxBytes: 1024 });
        assert.ok(over.some((p) => p.includes('exceeds 1024 bytes')), `oversize not caught: ${over}`);
        assert.deepEqual(problems(manifest, { ...opts, publicDir: dir, maxBytes: 4096 }), []);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('the size cap is a sane hover-preview budget', () => {
    assert.equal(MAX_CLIP_BYTES, 2 * 1024 * 1024);
});

test('the real manifest is sound', () => {
    assert.deepEqual(problems(SHOWCASE_CLIPS, opts), []);
});

test('every landing tile has a distinct viral preview and a small poster', () => {
    const keys = [...FEATURE_CARDS.map((f) => f.key), ...WALL_PRESETS.map((p) => p.id)];
    const videos = new Set();
    for (const key of keys) {
        const clip = SHOWCASE_CLIPS[key];
        assert.ok(clip, `${key} has no landing preview`);
        assert.ok(clip.poster, `${key} has no still for reduced motion`);
        assert.ok(statSync(`${PUBLIC}${clip.poster}`).size <= 80 * 1024, `${key} poster exceeds 80 KB`);
        assert.ok(!videos.has(clip.video), `${key} repeats another tile's preview`);
        videos.add(clip.video);
    }
});

test('imported inspiration keeps its title and source credit', () => {
    const sources = new Set(SHOWCASE_SOURCES.map((source) => source.name));
    for (const [key, clip] of Object.entries(SHOWCASE_CLIPS)) {
        assert.ok(clip.title?.trim(), `${key} has no source title`);
        assert.ok(sources.has(clip.source), `${key} has an unknown source`);
    }
    assert.deepEqual(SHOWCASE_SOURCES.map((source) => source.url), [
        'https://syntx.ai/trends',
        'https://higgsfield.ai/',
    ]);
});
