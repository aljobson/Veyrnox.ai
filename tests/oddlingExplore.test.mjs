import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readdir, readFile } from 'node:fs/promises';
import { ODDLING_ARCHETYPES } from '../app/veyrnox/_lib/character.js';
import { ODDLING_PRESET_SOURCES, oddlingsForSource } from '../app/veyrnox/_lib/oddlingStudio.js';
import {
    ODDLING_EXPLORE_DEFAULT_SOURCE,
    ODDLING_EXPLORE_TABS,
    ODDLING_HERO_IDS,
    ODDLING_KIND_FILTERS,
    exploreCharacters,
    exploreKindCounts,
    heroCharacters,
    parseOddlingDeepLink,
    reconcileKindFilter,
    toggleKindFilter,
} from '../app/veyrnox/_lib/oddlingExplore.js';

const component = (file) => readFile(new URL(`../app/veyrnox/_components/${file}`, import.meta.url), 'utf8');

test('Explore opens on All, with the themed collections kept as tabs and Human / Other beings as filters', () => {
    assert.equal(ODDLING_EXPLORE_DEFAULT_SOURCE, 'all');
    assert.equal(oddlingsForSource(ODDLING_EXPLORE_DEFAULT_SOURCE).length, ODDLING_ARCHETYPES.length);
    assert.equal(ODDLING_EXPLORE_TABS[0].id, 'all');
    assert.deepEqual(ODDLING_EXPLORE_TABS.map(({ id }) => id), ['all', 'body', 'silhouettes', 'fashion', 'hair', 'denim', 'oddities', 'torsos']);
    assert.ok(ODDLING_EXPLORE_TABS.every((tab) => !tab.kind), 'kind sources became filter chips');
    assert.deepEqual(ODDLING_KIND_FILTERS.map(({ id }) => id), ['human', 'creature']);
    assert.deepEqual(ODDLING_KIND_FILTERS.map(({ label }) => label), ['Human', 'Other beings']);
    // The old kind tabs still resolve, so an older link or test keeps working.
    for (const id of ['humans', 'beings']) assert.ok(ODDLING_PRESET_SOURCES.some((source) => source.id === id));
});

test('the kind filter narrows any tab and never reaches outside it', () => {
    const everyone = exploreCharacters('all');
    const humans = exploreCharacters('all', 'human');
    const beings = exploreCharacters('all', 'creature');
    assert.equal(everyone.length, ODDLING_ARCHETYPES.length);
    assert.equal(humans.length + beings.length, everyone.length);
    assert.ok(humans.every(({ kind }) => kind === 'human'));
    assert.ok(beings.length > 0 && beings.every(({ kind }) => kind === 'creature'));
    assert.deepEqual(exploreCharacters('all', 'robot').map(({ id }) => id), everyone.map(({ id }) => id), 'an unknown filter is no filter');
    assert.deepEqual(exploreCharacters('all', undefined).map(({ id }) => id), everyone.map(({ id }) => id));
    for (const { id } of ODDLING_EXPLORE_TABS) {
        const tab = exploreCharacters(id).map((item) => item.id);
        for (const filtered of [exploreCharacters(id, 'human'), exploreCharacters(id, 'creature')]) {
            assert.ok(filtered.every((item) => tab.includes(item.id)), `${id} filter stays inside the tab`);
        }
    }
});

test('filter chips carry counts for the open tab and an emptied tab drops the filter', () => {
    const counts = exploreKindCounts('all');
    assert.equal(counts.human + counts.creature, ODDLING_ARCHETYPES.length);
    assert.equal(counts.human, exploreCharacters('all', 'human').length);
    assert.equal(counts.creature, exploreCharacters('all', 'creature').length);
    for (const { id } of ODDLING_EXPLORE_TABS) {
        const tab = exploreKindCounts(id);
        assert.equal(tab.human + tab.creature, exploreCharacters(id).length, id);
    }
    const humanOnly = ODDLING_EXPLORE_TABS.find(({ id }) => exploreKindCounts(id).creature === 0);
    assert.ok(humanOnly, 'a themed tab with no other beings exists to exercise the clamp');
    assert.equal(reconcileKindFilter(humanOnly.id, 'creature'), '');
    assert.equal(reconcileKindFilter(humanOnly.id, 'human'), 'human');
    assert.equal(reconcileKindFilter('all', 'creature'), 'creature');
    assert.equal(reconcileKindFilter('all', 'nonsense'), '');
    assert.equal(reconcileKindFilter('all', ''), '');
});

test('pressing the active chip clears it and pressing another switches', () => {
    assert.equal(toggleKindFilter('', 'human'), 'human');
    assert.equal(toggleKindFilter('human', 'human'), '');
    assert.equal(toggleKindFilter('human', 'creature'), 'creature');
    assert.equal(toggleKindFilter('creature', 'bogus'), '');
});

test('deep link resolves only a built-in archetype id', () => {
    for (const oddling of ODDLING_ARCHETYPES) {
        assert.equal(parseOddlingDeepLink(`?oddling=${encodeURIComponent(oddling.id)}`), oddling);
    }
    assert.equal(parseOddlingDeepLink('oddling=shelf-life').id, 'shelf-life');
    assert.equal(parseOddlingDeepLink('?utm_source=x&oddling=mossbyte&oddling=shelf-life').id, 'mossbyte', 'the first value counts');
    const refused = [
        '', '?', '?oddling=', '?oddling=1', '?oddling=unknown', '?oddling=SHELF-LIFE', '?oddling=%20shelf-life',
        '?oddling=shelf-life%20', '?oddling=../../etc/passwd', '?oddling=__proto__', '?oddling=constructor',
        '?oddling=%3Cscript%3Ealert(1)%3C/script%3E', '?oddling=https://example.com/portrait.webp',
        '?oddling[]=shelf-life', '?Oddling=shelf-life', `?oddling=${'a'.repeat(5000)}`, '?oddling=%E0%A4%A',
    ];
    for (const search of refused) assert.equal(parseOddlingDeepLink(search), null, search.slice(0, 40));
    for (const bad of [undefined, null, 42, {}, []]) assert.equal(parseOddlingDeepLink(bad), null);
    assert.equal(parseOddlingDeepLink(), null);
});

test('the hero strip uses portraits that already ship, with no new assets', async () => {
    assert.equal(new Set(ODDLING_HERO_IDS).size, ODDLING_HERO_IDS.length);
    assert.equal(heroCharacters().length, ODDLING_HERO_IDS.length);
    assert.ok(heroCharacters().some(({ kind }) => kind === 'human') && heroCharacters().some(({ kind }) => kind === 'creature'));
    for (const { id } of heroCharacters()) {
        await access(new URL(`../public/oddlings/portraits/${id}.webp`, import.meta.url));
    }
    const shipped = (await readdir(new URL('../public/oddlings/portraits/', import.meta.url))).filter((name) => name.endsWith('.webp'));
    assert.equal(shipped.length, ODDLING_ARCHETYPES.length, 'one portrait per character, none added for the strip');
});

test('the character sheet renders through the shared Modal instead of a hand-rolled dialog', async () => {
    const sheet = await component('OddlingSheet.js');
    assert.match(sheet, /import \{ Modal \} from '\.\/Modal'/);
    assert.match(sheet, /<Modal[\s\S]*onCancel=\{onClose\}/);
    assert.match(sheet, /aria-labelledby="character-sheet-title"/);
    assert.match(sheet, /initialFocusRef=\{closeRef\}/);
    assert.match(sheet, /onRecreate\(oddling\)/);
    assert.match(sheet, /onAnimate\(oddling\)/);
    assert.doesNotMatch(sheet, /fixed inset-0|aria-modal|role="dialog"|onMouseDown/, 'Modal owns the scrim, the role and the keys');
    const studio = await component('OddlingStudio.js');
    assert.match(studio, /\{sheet && <OddlingSheet /);
    assert.doesNotMatch(studio, /fixed inset-0|aria-modal/);
});

test('the whole gallery card opens the sheet through a real button and keeps Recreate and Animate', async () => {
    const explore = await component('OddlingExplore.js');
    const card = explore.slice(explore.indexOf('function GalleryCard'), explore.indexOf('export function OddlingExplore('));
    assert.match(card, /<button type="button" onClick=\{\(\) => onSheet\(oddling\)\} aria-label=\{`Open \$\{oddling\.name\} character sheet`\}[^>]*absolute inset-0/);
    assert.match(card, /onClick=\{\(\) => onRecreate\(oddling\)\}[\s\S]*Recreate/);
    assert.match(card, /onClick=\{\(\) => onAnimate\(oddling\)\}[\s\S]*Animate this character/);
    assert.doesNotMatch(card, /<article[^>]*onClick/, 'no click handler on an element that holds other buttons');
    assert.match(card, /relative z-20/, 'the action buttons sit above the stretched button');
});

test('Explore wires the All default, filter chips, hero strip and motion preference', async () => {
    const explore = await component('OddlingExplore.js');
    const filters = await component('OddlingExploreFilters.js');
    assert.match(explore, /useState\(ODDLING_EXPLORE_DEFAULT_SOURCE\)/);
    assert.match(explore, /previewsPlaying=\{previewsPlaying && motionAllowed\}|previewsPlaying=\{explore\.previewsPlaying && motionAllowed\}/);
    assert.match(filters, /ODDLING_KIND_FILTERS\.map/);
    assert.match(filters, /aria-pressed=\{kind === id\}/);
    assert.match(filters, /ODDLING_EXPLORE_TABS\.map/);
    assert.match(explore, /<OddlingHeroStrip /);
    const hero = explore.slice(explore.indexOf('function OddlingHeroStrip'), explore.indexOf('function GalleryCard'));
    assert.match(hero, /heroCharacters\(\)/);
    assert.match(hero, /motion-safe:/);
    assert.doesNotMatch(hero, /animate-|@keyframes|setInterval|requestAnimationFrame/, 'the strip is still; hover transitions are motion-safe only');
});

test('builder wiring: Surprise me beside Generate, picked/total headers, many open sections, motion captions', async () => {
    const studio = await component('OddlingStudio.js');
    const sections = await component('OddlingTraitSections.js');
    const motion = await component('OddlingMotionPanel.js');
    assert.match(studio, /randomizeOddlingAll\(current\)/);
    assert.match(studio, />Surprise me</);
    assert.match(studio, />Randomize styling</, 'Randomize styling stays');
    assert.ok(studio.indexOf('Surprise me') < studio.indexOf('onClick={continueToCreate}'), 'Surprise me sits before Generate in the same row');
    assert.match(studio, /useState\(\['build'\]\)/);
    assert.match(studio, /toggleOpenSection\(current, id\)/);
    assert.match(sections, /sectionProgress\(section, picks\)/);
    assert.match(sections, /\{picked\}\/\{total\}/);
    assert.match(sections, /aria-expanded=\{open\}/);
    assert.match(motion, /\{motion\.phrase\}/);
    assert.match(motion, /aria-describedby=/);
    assert.match(motion, /truncate/);
});

test('deep link loads the character into the builder and opens its sheet without touching the URL', async () => {
    const studio = await component('OddlingStudio.js');
    assert.match(studio, /parseOddlingDeepLink\(window\.location\.search\)/);
    const effect = studio.slice(studio.indexOf('parseOddlingDeepLink(window'), studio.indexOf('}, []);', studio.indexOf('parseOddlingDeepLink(window')));
    assert.match(effect, /setPicks\(\{ \.\.\.linked\.picks \}\)/);
    assert.match(effect, /setPortraitId\(linked\.id\)/);
    assert.match(effect, /setSheet\(linked\)/);
    assert.doesNotMatch(effect, /history\.|replaceState|pushState|router\./, 'read-only: the address bar is left alone');
    assert.doesNotMatch(studio, /dangerouslySetInnerHTML|location\.search\s*\)\s*\.get|URLSearchParams\(window/);
});

test('the Oddling Studio is split so no file passes the size ceiling', async () => {
    for (const file of ['OddlingStudio.js', 'OddlingExplore.js', 'OddlingExploreFilters.js', 'OddlingSheet.js', 'OddlingPortrait.js', 'OddlingTraitSections.js', 'OddlingMotionPanel.js']) {
        const lines = (await component(file)).split('\n').length;
        assert.ok(lines < 500, `${file} is ${lines} lines`);
    }
});
