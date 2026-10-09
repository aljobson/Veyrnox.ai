// The landing film is a rendered file with prices baked into its frames. Two
// things can go wrong without anyone noticing: the file goes missing or grows
// (a silent 404, or a 20 MB download under the hero), and a catalog price
// changes while the film keeps showing the old one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import vm from 'node:vm';
import { LANDING_FILM, MAX_FILM_BYTES } from '../app/veyrnox/_lib/film.js';
import { MODELS } from '../app/veyrnox/_lib/tokens.js';

const PUBLIC = new URL('../public', import.meta.url).pathname;
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

/** prices.js is a browser script that sets window.FilmPrices; run it as one. */
function filmPrices() {
    const window = {};
    vm.runInNewContext(read('../scripts/landing-film/prices.js'), { window });
    // Through JSON, so the rows are this realm's objects, not the sandbox's.
    return JSON.parse(JSON.stringify(window.FilmPrices)).flatMap(([, rows]) => rows);
}

test('the film and its poster are in public/, same-origin, with the right extensions', () => {
    assert.match(LANDING_FILM.video, /^\/film\/[a-z0-9-]+\.mp4$/);
    assert.match(LANDING_FILM.poster, /^\/film\/[a-z0-9-]+\.jpg$/);
    assert.ok(existsSync(`${PUBLIC}${LANDING_FILM.video}`), `${LANDING_FILM.video} is not in public/`);
    assert.ok(existsSync(`${PUBLIC}${LANDING_FILM.poster}`), `${LANDING_FILM.poster} is not in public/`);
});

test('the film stays under the size cap', () => {
    const { size } = statSync(`${PUBLIC}${LANDING_FILM.video}`);
    assert.ok(size <= MAX_FILM_BYTES, `${LANDING_FILM.video} is ${size} bytes, over the ${MAX_FILM_BYTES} cap: encode it again`);
    assert.ok(statSync(`${PUBLIC}${LANDING_FILM.poster}`).size <= 150 * 1024, 'the poster is over 150 KB');
});

test('every price in the film matches the landing fallback list', () => {
    const prices = filmPrices();
    assert.ok(prices.length > 0, 'prices.js lists no prices');
    for (const { id, credits } of prices) {
        const model = MODELS.find((m) => m.id === id);
        assert.ok(model, `the film shows "${id}", which the landing list no longer has: render the film again`);
        assert.equal(credits, model.credits, `the film shows ${id} at ${credits} credits, the landing list says ${model.credits}: update prices.js and render the film again`);
    }
});

test('the film shows no gated model, since the price list it prints is the open shelf', () => {
    const gated = new Set(MODELS.filter((m) => m.gated).map((m) => m.id));
    assert.deepEqual(filmPrices().filter(({ id }) => gated.has(id)), []);
});

test('the landing page mounts the film and gives it a text summary', () => {
    assert.match(read('../app/veyrnox/page.js'), /<LandingFilm \/>/);
    const section = read('../app/veyrnox/_sections/film.js');
    assert.match(section, /describedBy="film-summary"/);
    assert.match(section, /id="film-summary"/);
    // A price in the summary would go stale the same way the frames can.
    assert.doesNotMatch(section.match(/const FILM_SUMMARY =[\s\S]*?;/)[0], /\d+ (credits|cr)\b/);
});

test('the player has a pause control and never preloads the file', () => {
    const player = read('../app/veyrnox/_components/FilmPlayer.js');
    assert.match(player, /preload="none"/);
    assert.match(player, /<button[\s\S]*onClick=\{toggle\}/);
    assert.match(player, /playbackMode\(/);
});
