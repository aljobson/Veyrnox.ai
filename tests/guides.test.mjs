import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GUIDES, guideById } from '../app/veyrnox/_lib/guides.js';
import { FAQ, SITE_PAGES } from '../app/veyrnox/_lib/tokens.js';
import { ALLOWED_UPLOAD_TYPES } from '../lib/uploadSource.js';

test('every guide has a slug, steps and links to real pages', () => {
    const known = new Set([...SITE_PAGES.map((p) => p.href), '/legal/aup']);
    const ids = new Set();
    for (const g of GUIDES) {
        assert.match(g.id, /^[a-z0-9-]+$/);
        assert.ok(!ids.has(g.id), `duplicate guide ${g.id}`);
        ids.add(g.id);
        assert.ok(g.title && g.summary && g.steps.length >= 3);
        for (const s of g.steps) assert.ok(s.title && s.body.length > 20);
        for (const l of g.links) assert.ok(known.has(l.href), `guide ${g.id} links to ${l.href}, which is not a site page`);
    }
    assert.equal(guideById('credits').id, 'credits');
    assert.equal(guideById('nope'), null);
});

// The guides repeat a few numbers the app states elsewhere. These fail when
// the source changes, so a guide cannot go on quoting the old figure.
test('the numbers a guide quotes match the app', () => {
    const text = GUIDES.flatMap((g) => g.steps.map((s) => s.body)).join(' ');
    const faq = FAQ.map((f) => f.a).join(' ');
    assert.match(faq, /10 credits granted on sign-up/);
    assert.match(text, /10 free credits/);
    assert.match(faq, /expire 90 days after grant/);
    assert.match(text, /expire 90 days after they are granted/);
    assert.match(faq, /10 generations per 60 seconds/);
    assert.match(text, /10 generations per minute/);
    const mb = (type) => ALLOWED_UPLOAD_TYPES[type].maxBytes / (1024 * 1024);
    assert.deepEqual([mb('image/png'), mb('image/jpeg'), mb('image/webp'), mb('video/mp4'), mb('audio/mpeg'), mb('audio/wav')], [20, 20, 20, 100, 20, 20]);
    assert.match(text, /PNG, JPEG or WebP up to 20 MB\. Video is MP4 up to 100 MB\. Speech is MP3 or WAV up to 20 MB\./);
});

test('/guides is routed and in the sitemap', () => {
    const config = readFileSync(new URL('../next.config.mjs', import.meta.url), 'utf8');
    assert.match(config, /source: '\/guides\/:id', destination: '\/veyrnox\/guides\/:id'/);
    assert.match(readFileSync(new URL('../app/sitemap.js', import.meta.url), 'utf8'), /GUIDES\.map/);
});
