// The landing tiles play short loops from public/showcase. The manifest is the
// only place that names a clip, so a typo or an oversized file has to fail
// here, not as a silent 404 (or a 20 MB download) on the live page.
//
// The real manifest starts empty, so the checks are proven against a fake one
// first: an empty manifest passing proves nothing on its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SHOWCASE_CLIPS, MAX_CLIP_BYTES } from '../app/veyrnox/_lib/showcase.js';
import { FEATURE_CARDS, EFFECT_PRESETS } from '../app/veyrnox/_lib/tokens.js';

const PUBLIC = new URL('../public', import.meta.url).pathname;
const TILE_KEYS = new Set([...FEATURE_CARDS.map((f) => f.key), ...EFFECT_PRESETS.map((e) => e.name)]);
const PATH_RE = {
    video: /^\/showcase\/[a-z0-9-]+\.(mp4|webm)$/,
    poster: /^\/showcase\/[a-z0-9-]+\.(jpg|webp)$/,
};

/** Returns a list of human-readable problems; empty means the manifest is sound. */
function problems(manifest, { tileKeys, publicDir, maxBytes }) {
    const found = [];
    for (const [key, clip] of Object.entries(manifest)) {
        if (!tileKeys.has(key)) found.push(`"${key}" matches no FEATURE_CARDS key or EFFECT_PRESETS name`);
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
            INCLINE: { video: '/showcase/does-not-exist.mp4', poster: '/showcase/does-not-exist.jpg' },
        },
        opts,
    );
    assert.ok(bad.some((p) => p.includes('no-such-tile')), 'unknown tile not caught');
    assert.ok(bad.some((p) => p.includes('wan-2.5-kie.video must be')), 'off-origin path not caught');
    const swapped = problems({ INCLINE: { video: '/showcase/a.jpg', poster: '/showcase/a.mp4' } }, opts);
    assert.ok(swapped.some((p) => p.includes('INCLINE.video must be')), 'image used as video not caught');
    assert.ok(swapped.some((p) => p.includes('INCLINE.poster must be')), 'video used as poster not caught');
    assert.ok(bad.some((p) => p.includes('INCLINE.video points at')), 'missing file not caught');
    assert.ok(bad.some((p) => p.includes('INCLINE.poster points at')), 'missing poster not caught');
});

test('the validator rejects a clip over the size cap and accepts one under it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'showcase-'));
    try {
        mkdirSync(join(dir, 'showcase'));
        writeFileSync(join(dir, 'showcase', 'big.mp4'), Buffer.alloc(2048));
        const manifest = { INCLINE: { video: '/showcase/big.mp4' } };
        const over = problems(manifest, { ...opts, publicDir: dir, maxBytes: 1024 });
        assert.ok(over.some((p) => p.includes('exceeds 1024 bytes')), `oversize not caught: ${over}`);
        assert.deepEqual(problems(manifest, { ...opts, publicDir: dir, maxBytes: 4096 }), []);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('the size cap is a sane hover-preview budget', () => {
    assert.equal(MAX_CLIP_BYTES, 3 * 1024 * 1024);
});

test('the real manifest is sound (empty is valid: tiles keep their gradient)', () => {
    assert.deepEqual(problems(SHOWCASE_CLIPS, opts), []);
});
