import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS } from '../app/veyrnox/_lib/templates.js';
import { templateCards, templateCategories, templateDetail, searchTemplateIds } from '../lib/clientTemplates.js';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
const list = await import('../app/api/templates/route.js');
const one = await import('../app/api/templates/[id]/route.js');

test('the card list is the gallery: one card per video-backed template, with a clip and no full prompt', () => {
    const cards = templateCards();
    assert.equal(cards.length, PRESETS.length);
    for (const card of cards) {
        assert.ok(card.clip?.video, card.id);
        assert.equal('prompt' in card, false, `${card.id} sends only a preview of its prompt`);
    }
    assert.deepEqual(templateCategories().slice(0, 2), ['ALL', 'NEW']);
});

test('a template comes back whole, and an unknown or malformed id does not', () => {
    const preset = PRESETS[0];
    const detail = templateDetail(preset.id);
    assert.equal(detail.id, preset.id);
    assert.equal(detail.prompt, preset.prompt);
    assert.equal(templateDetail('nope-not-a-template'), null);
    assert.equal(templateDetail('../etc/passwd'), null);
});

test('a source prompt that cannot run is marked so the browser can refuse it', () => {
    for (const preset of PRESETS.filter((p) => p.promptOrigin === 'community-source-exact').slice(0, 50)) {
        assert.equal(typeof templateDetail(preset.id).sourcePromptRunnable, 'boolean', preset.id);
    }
});

test('search answers with ids from the whole prompt', () => {
    const preset = PRESETS[0];
    const word = preset.prompt.split(/\s+/).find((w) => /^[a-z]{6,}$/i.test(w));
    assert.ok(searchTemplateIds(word).includes(preset.id));
    assert.deepEqual(searchTemplateIds(''), []);
});

test('the routes are anonymous and cacheable and answer typed errors', async () => {
    const ok = await list.GET(new Request('https://example.test/api/templates'));
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get('cache-control'), /public/);
    const bad = await one.GET(new Request('https://example.test/api/templates/x'), { params: Promise.resolve({ id: 'no-such-template' }) });
    assert.equal(bad.status, 404);
    assert.match((await bad.json()).error, /^[a-z_]+$/);
});

test('the studio and its template cover never import the catalog: the browser reads /api/templates', async () => {
    const { readFileSync } = await import('node:fs');
    for (const file of ['app/veyrnox/app/create/page.js', 'app/veyrnox/_components/TemplateOpening.js', 'app/veyrnox/_lib/useTemplates.js', 'app/veyrnox/_lib/templateDraft.js', 'lib/templateStartCheck.js']) {
        const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
        assert.doesNotMatch(source, /from '[^']*_lib\/templates(?:\.js)?'/, `${file} imports the template catalog`);
        assert.doesNotMatch(source, /from '[^']*sourcePrompt(?:Audit|Records)(?:\.js)?'/, `${file} imports the source prompt data`);
    }
});
