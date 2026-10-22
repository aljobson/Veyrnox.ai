import { resolveI18nSource } from '../scripts/lib/vey-knowledge-i18n.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readdir, readFile } from 'node:fs/promises';
import { ODDLING_ARCHETYPES } from '../app/veyrnox/_lib/character.js';
import { AUTO_PRODUCT_INVENTORY } from '../lib/generatedProductInventory.js';
import { ODDLING_PRESET_SOURCES, oddlingsForSource } from '../app/veyrnox/_lib/oddlingStudio.js';
import {
    ODDLING_EXPLORE_DEFAULT_SOURCE,
    ODDLING_EXPLORE_TABS,
    ODDLING_HERO_IDS,
    ODDLING_KIND_FILTERS,
    cardButtonLabel,
    exploreCharacters,
    exploreKindCounts,
    heroButtonLabel,
    heroCharacters,
    parseOddlingDeepLink,
    reconcileKindFilter,
    toggleKindFilter,
    withoutDeepLink,
} from '../app/veyrnox/_lib/oddlingExplore.js';

const component = (file) => readFile(new URL(`../app/veyrnox/_components/${file}`, import.meta.url), 'utf8');

test('Explore opens on All, with the themed collections kept as tabs and Human / Other beings as filters', () => {
    assert.equal(ODDLING_EXPLORE_DEFAULT_SOURCE, 'all');
    assert.equal(oddlingsForSource(ODDLING_EXPLORE_DEFAULT_SOURCE).length, ODDLING_ARCHETYPES.length);
    assert.equal(ODDLING_EXPLORE_TABS[0].id, 'all');
    assert.deepEqual(ODDLING_EXPLORE_TABS.map(({ id }) => id), ['all', 'body', 'silhouettes', 'fashion', 'hair', 'denim', 'oddities', 'torsos',
        'head-sizes', 'neck-sizes', 'arm-sizes', 'leg-sizes', 'hand-sizes', 'foot-sizes',
        'eye-sizes', 'mouth-sizes', 'ear-sizes', 'nose-sizes']);
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
    const studio = resolveI18nSource(await component('OddlingStudio.js'));
    assert.match(studio, /\{sheet && <OddlingSheet /);
    assert.doesNotMatch(studio, /fixed inset-0|aria-modal/);
});

test('the whole gallery card opens the sheet through a real button and keeps Recreate and Animate', async () => {
    const explore = await component('OddlingExplore.js');
    const card = explore.slice(explore.indexOf('function GalleryCard'), explore.indexOf('export function OddlingExplore('));
    assert.match(card, /<button type="button" onClick=\{\(\) => onSheet\(oddling\)\} aria-label=\{t\('app\.oddlings\.explore\.card', \{ name: oddling\.name \}\)\}[^>]*absolute inset-0/);
    assert.match(resolveI18nSource(card), /onClick=\{\(\) => onRecreate\(oddling\)\}[\s\S]*Recreate/);
    assert.match(resolveI18nSource(card), /onClick=\{\(\) => onAnimate\(oddling\)\}[\s\S]*Animate this character/);
    assert.doesNotMatch(card, /<article[^>]*onClick/, 'no click handler on an element that holds other buttons');
    assert.match(card, /relative z-20/, 'the action buttons sit above the stretched button');
});

test('the card button keeps its keyboard focus ring inside the clipped card', async () => {
    const explore = await component('OddlingExplore.js');
    const card = explore.slice(explore.indexOf('function GalleryCard'), explore.indexOf('export function OddlingExplore('));
    const article = card.match(/<article className="([^"]*)"/)[1];
    const button = card.match(/<button type="button" onClick=\{\(\) => onSheet\(oddling\)\}[^>]*className="([^"]*)"/)[1];
    assert.match(article, /overflow-hidden/, 'the card clips its preview, which is why the ring must sit inside it');
    assert.match(button, /focus-visible:outline/, 'a visible ring on keyboard focus');
    assert.match(button, /focus-visible:-outline-offset-\d|focus-visible:outline-offset-\[-\d+px\]/, 'a negative offset draws the ring inside the card');
    assert.doesNotMatch(button, /focus-visible:outline-offset-(?!\[-)\d/, 'a positive offset would be drawn outside the clip and vanish');
});

test('the strip button and the card button for the same character have different accessible names', async () => {
    for (const oddling of heroCharacters()) {
        const hero = heroButtonLabel(oddling.name);
        const card = cardButtonLabel(oddling.name);
        assert.notEqual(hero, card, oddling.id);
        assert.ok(hero.includes(oddling.name) && card.includes(oddling.name), 'both still name the character');
    }
    const explore = await component('OddlingExplore.js');
    const hero = explore.slice(explore.indexOf('function OddlingHeroStrip'), explore.indexOf('function GalleryCard'));
    assert.match(hero, /aria-label=\{t\('app\.oddlings\.explore\.hero', \{ name: oddling\.name \}\)\}/);
    assert.doesNotMatch(hero, /aria-label=\{`Open /, 'the strip no longer shares the card wording');
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

test('builder wiring: Surprise me beside Generate, one catalog builder, motion captions', async () => {
    const studio = resolveI18nSource(await component('OddlingStudio.js'));
    const motion = await component('OddlingMotionPanel.js');
    assert.match(studio, /randomizeOddlingAll\(current\)/);
    assert.match(studio, />Surprise me</);
    assert.match(studio, />Randomize styling</, 'Randomize styling stays');
    assert.doesNotMatch(studio, /OddlingTraitSections|DETAILED TRAITS/, 'the catalog is the only builder: no second list of chips');
    assert.ok(studio.indexOf('Surprise me') < studio.indexOf('onClick={continueToCreate}'), 'Surprise me sits before Generate in the same row');
    assert.match(motion, /\{motion\.phrase\}/);
    assert.match(motion, /aria-describedby=/);
    assert.doesNotMatch(motion, /truncate|line-clamp|text-ellipsis|whitespace-nowrap/, 'a caption wraps so a keyboard or touch user can read the whole phrase');
    assert.match(motion, /break-words/);
    assert.match(studio, /ms-auto grid w-full gap-2 sm:flex sm:w-auto/, 'mobile footer actions stack before the wider flex layout');
    assert.match(studio, /data-assistant-target="oddlings\.chat"[\s\S]*w-full whitespace-normal/, 'the longest localized Chat label wraps at narrow widths');
    assert.match(studio, /data-assistant-target="oddlings\.continue"[\s\S]*w-full min-w-0 justify-between sm:w-auto/, 'Create stays a full-width direct path on mobile');
});

test('builder can carry the locked passport into multi-skill Chat without generating', async () => {
    const studio = await component('OddlingStudio.js');
    const chat = await component('chat/ChatWorkspace.js');
    const cards = await component('chat/StudioDraftCards.js');
    assert.match(studio, /writeOddlingChatHandoff\(window\.sessionStorage/);
    assert.match(studio, /skill=oddling-continuity&skill=storyboard&skill=prompt-writer&skill=bring-to-life&oddling=\$\{encodeURIComponent\(launchId\)\}/);
    assert.match(studio, /data-assistant-target="oddlings\.chat"/);
    assert.match(chat, /readOddlingChatHandoff\(window\.sessionStorage, launchId, getStoredUserId\(\)\)/);
    assert.match(chat, /removeOddlingChatHandoff\(window\.sessionStorage, launchId\)/, 'a rejected URL can remove only its own exact launch');
    assert.match(chat, /onSessionChange\(\(session\) => \{/);
    assert.match(chat, /removeOddlingChatHandoff\(window\.sessionStorage\)/, 'an account change clears pending private passport data');
    assert.match(chat, /setOddlingLaunchResolved\(true\)/, 'send stays blocked until the URL handoff has been resolved');
    assert.match(chat, /sendBlocked: oddlingSendPending/);
    assert.match(chat, /oddlingContextBlocked/);
    assert.match(chat, /app\.chat\.oddlingCanon\.tooLong/);
    assert.match(chat, /const oddlingSendPending = oddlingCanonBlocked \|\|/, 'a restored Oddling thread with changed canon stays explicitly blocked');
    assert.match(chat, /writeOddlingThreadContext\(store\(\), getStoredUserId\(\), threadId, oddlingContext, lockedOddlingInstructions\)/, 'the verified in-memory passport binds even if the launch timestamp expires while the tab is open');
    assert.match(chat, /removeOddlingChatHandoff\(window\.sessionStorage, oddlingLaunchId\)/, 'a successful bind consumes the exact launch');
    assert.match(chat, /fittingSkillsWithRequired\([\s\S]*'oddling-continuity'\)/, 'continuity is an all-or-nothing prerequisite for an Oddling launch');
    assert.match(chat, /readOddlingThreadContext\(store\(\), getStoredUserId\(\), id\)/);
    assert.match(chat, /expectedSystemPrompt: oddlingContext \? lockedOddlingInstructions : ''/, 'the exact canon reaches the atomic server send guard');
    assert.match(chat, /onThreadValidated: validateOddlingThread/, 'an already-open canon chat rechecks the server prompt before every send');
    assert.match(chat, /canFinishOddlingLaunch\(/, 'a late bind must still belong to the current Chat launch');
    assert.match(chat, /left: chatView\.current\.left/);
    assert.match(chat, /pathname: window\.location\.pathname/);
    assert.match(chat, /window\.history\.replaceState\(window\.history\.state/, 'finishing the launch preserves the destination history state');
    assert.match(chat, /lockedInstructions: lockedOddlingInstructions/, 'the immutable canon, not editable text, is patched before a paid send');
    assert.match(chat, /\? \(active \? oddlingContext\.instructions : instructionsFor\(/, 'a restored Oddling thread keeps the exact bound prompt even when the server copy differs');
    assert.match(chat, /if \(oddlingContext\) return;/, 'a persona cannot replace locked canon');
    const settings = await component('chat/SettingsPanel.js');
    assert.match(settings, /selectionDisabled=\{busy \|\| hasThread \|\| instructionsLocked\} manageDisabled=\{busy\}/);
    const persona = await component('chat/PersonaPicker.js');
    assert.match(persona, /disabled=\{selectionDisabled \|\| personas\.length === 0\}/);
    assert.match(persona, /disabled=\{manageDisabled\} onClick=\{onManage\}/, 'existing chats can still open persona management');
    assert.match(chat, /data-testid="oddling-canon-banner"/);
    assert.match(chat, /oddlingHandoff=\{oddlingContext\}/);
    assert.match(cards, /stageChatStudioDraft\(window\.sessionStorage, d, oddlingHandoff\)/);
    assert.match(cards, /if \(!destination\)/);
    assert.match(studio, /PORTRAIT_INVALIDATING_KEYS = new Set\(\[\.\.\.CHARACTER_GROUPS\.map\(\(group\) => group\.id\), 'oddling_rule'\]\)/, 'free-form visual canon is a portrait-defining value');
    assert.match(studio, /if \(PORTRAIT_INVALIDATING_KEYS\.has\(key\)\) setPortraitId\(''\)/, 'editing any visual source detaches the preset portrait');
    assert.match(studio, /if \(mode === 'motion' && portraitId\)/, 'a detached portrait is never silently handed to Create');
});

test('deep link loads the character once, then takes the parameter out of the address', async () => {
    const studio = resolveI18nSource(await component('OddlingStudio.js'));
    assert.match(studio, /parseOddlingDeepLink\(window\.location\.search\)/);
    const effect = studio.slice(studio.indexOf('parseOddlingDeepLink(window'), studio.indexOf('}, []);', studio.indexOf('parseOddlingDeepLink(window')));
    assert.match(effect, /setPicks\(\{ \.\.\.linked\.picks \}\)/);
    assert.match(effect, /setPortraitId\(linked\.id\)/);
    assert.match(effect, /setSheet\(linked\)/);
    assert.match(effect, /window\.history\.replaceState\(window\.history\.state, '', withoutDeepLink\(window\.location\)\)/, 'consumed once, so a remount or Back does not reopen it');
    assert.ok(effect.indexOf('setSheet(linked)') < effect.indexOf('replaceState'), 'the address is cleaned only after the link was applied');
    assert.doesNotMatch(effect, /pushState|router\./, 'no new history entry, no navigation');
    assert.doesNotMatch(studio, /dangerouslySetInnerHTML|location\.search\s*\)\s*\.get|URLSearchParams\(window/);
});

test('withoutDeepLink drops only the oddling parameter and keeps the rest of the address', () => {
    assert.equal(withoutDeepLink({ pathname: '/app/oddlings', search: '?oddling=mossbyte', hash: '' }), '/app/oddlings');
    assert.equal(withoutDeepLink({ pathname: '/app/oddlings', search: '?utm_source=mail&oddling=mossbyte&ref=a%20b', hash: '#cast' }), '/app/oddlings?utm_source=mail&ref=a+b#cast');
    assert.equal(withoutDeepLink({ pathname: '/app/oddlings', search: '?oddling=mossbyte&oddling=shelf-life', hash: '' }), '/app/oddlings', 'every copy goes');
    assert.equal(withoutDeepLink({ pathname: '/app/oddlings', search: '', hash: '#x' }), '/app/oddlings#x');
    assert.equal(withoutDeepLink({ pathname: '/app/oddlings', search: '?Oddling=keep', hash: '' }), '/app/oddlings?Oddling=keep', 'parameter names are case-sensitive, like the parser');
    assert.equal(withoutDeepLink({ pathname: '//evil.example/x', search: '?oddling=mossbyte' }), '/evil.example/x', 'never a protocol-relative address');
    for (const bad of [undefined, null, {}, 'oddlings']) assert.equal(withoutDeepLink(bad), '/');
    // What is left must not parse as a deep link, so the same address cannot reopen the sheet.
    const cleaned = withoutDeepLink({ pathname: '/app/oddlings', search: '?oddling=mossbyte', hash: '' });
    assert.equal(parseOddlingDeepLink(new URL(cleaned, 'https://example.test').search), null);
});

test('the Oddling Studio is split so no file passes the size ceiling', async () => {
    for (const file of ['OddlingStudio.js', 'OddlingExplore.js', 'OddlingExploreFilters.js', 'OddlingSheet.js', 'OddlingPortrait.js', 'OddlingMotionPanel.js']) {
        const lines = (await component(file)).split('\n').length;
        assert.ok(lines < 500, `${file} is ${lines} lines`);
    }
});

test('Vey can still quote that Explore previews are free: the sentence is within the scanner\'s description budget', async () => {
    // The scanner keeps the first eight <p> descriptions of a route's modules, in module order.
    // The studio file comes before the Explore files, so the sentence lives in the studio header too.
    const studio = resolveI18nSource(await component('OddlingStudio.js'));
    assert.match(studio, /<p [^>]*>[^<]*Dancing puppet previews in Explore are free: no generation or credits\./);
    const route = AUTO_PRODUCT_INVENTORY.find(({ id }) => id === 'route:/app/oddlings');
    assert.ok(route.descriptions.some((line) => /no generation or credits/.test(line)), 'the generated knowledge keeps it');
});
