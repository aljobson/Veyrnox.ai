// The public Oddlings gallery (/oddlings and /oddlings/<id>): the helpers the
// pages, the sitemap, the nav tables and the tests share. Plain data and string
// building, no React and no browser APIs, so the pages stay server components.
//
// The gallery shows the first-party cast only: original fictional adult
// characters whose portraits we made. It never lists user-made characters, so
// it needs no moderation. The cast, the portrait paths and the premise text are
// read from character.js and oddlingStudio.js and never copied here.

import { ODDLING_ARCHETYPES, ODDLING_SHOWS, ODDLING_TONES } from './character.js';
import { oddlingPortrait } from './oddlingStudio.js';
import { translator } from '../../../lib/i18n/translate.mjs';

const ENGLISH = translator('en');

// The flag lives in its own module so the shared layout can read it without
// loading the cast. Re-exported here so the gallery has one import.
export { ODDLINGS_PUBLIC_FLAG, oddlingsPublicEnabled } from './oddlingsPublicFlag.js';

export const ODDLINGS_PATH = '/oddlings';
export const ODDLINGS_STUDIO_PATH = '/app/oddlings';

// Lower-case words joined by single hyphens. Every cast id has this shape, and
// nothing else (a file name, a path, a prototype key) is ever looked up.
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_ID_LENGTH = 64;
const PORTRAIT_WIDTH = 1024;
const PORTRAIT_HEIGHT = 1536;
const NEIGHBOUR_COUNT = 4;

const KIND_LABELS = Object.freeze({ human: 'Human', creature: 'Other being' });
const KIND_HEADINGS = Object.freeze({ human: 'Humans', creature: 'Other beings' });
const KIND_ORDER = Object.freeze(['human', 'creature']);

export function oddlingKindLabel(kind) {
  return KIND_LABELS[kind] || 'Original character';
}

export function oddlingPath(id) {
  return `${ODDLINGS_PATH}/${encodeURIComponent(id)}`;
}

/** The studio deep link that Recreate and Animate use. */
export function oddlingStudioHref(id) {
  return `${ODDLINGS_STUDIO_PATH}?oddling=${encodeURIComponent(id)}`;
}

function describeChoice(table, label) {
  const row = table.find(([name]) => name === label);
  return row ? row[1] : '';
}

function toPublicOddling(archetype) {
  const portrait = oddlingPortrait(archetype.id);
  const picks = archetype.picks || {};
  return Object.freeze({
    id: archetype.id,
    name: archetype.name,
    hook: archetype.hook,
    accent: archetype.accent,
    kind: archetype.kind,
    kindLabel: oddlingKindLabel(archetype.kind),
    path: oddlingPath(archetype.id),
    studioHref: oddlingStudioHref(archetype.id),
    portrait: Object.freeze({
      src: portrait.image,
      width: PORTRAIT_WIDTH,
      height: PORTRAIT_HEIGHT,
      alt: `Portrait of ${archetype.name}, an original fictional character`,
    }),
    premise: Object.freeze({
      obsession: picks.oddling_obsession || '',
      voice: picks.oddling_voice || '',
      voiceNote: describeChoice(ODDLING_TONES, picks.oddling_voice),
      show: picks.oddling_show || '',
      showNote: describeChoice(ODDLING_SHOWS, picks.oddling_show),
    }),
  });
}

const ROSTER = Object.freeze(ODDLING_ARCHETYPES.map(toPublicOddling));
const BY_ID = new Map(ROSTER.map((oddling) => [oddling.id, oddling]));

/** The whole cast, in gallery order. */
export function listPublicOddlings() {
  return ROSTER;
}

/** The cast grouped by kind, humans first, empty groups left out. */
export function groupPublicOddlings() {
  return KIND_ORDER
    .map((kind) => ({ kind, heading: KIND_HEADINGS[kind], oddlings: ROSTER.filter((o) => o.kind === kind) }))
    .filter((group) => group.oddlings.length > 0);
}

const slugOf = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * One character in the page's language (ADR-0107): hook, tagline, obsession,
 * voice and show, kind and the portrait's alt text. Names are the characters'
 * own and stay as they are. `t` is a translator; a field with no translation
 * keeps its English words.
 */
export function localizeOddling(oddling, t = ENGLISH) {
  const say = (key, fallback) => t.messages[key] ?? fallback;
  const { premise } = oddling;
  return Object.freeze({
    ...oddling,
    hook: say(`oddling.${oddling.id}.hook`, oddling.hook),
    accent: say(`oddling.${oddling.id}.accent`, oddling.accent),
    kindLabel: say(`oddlings.kind.${oddling.kind}`, oddling.kindLabel),
    portrait: Object.freeze({ ...oddling.portrait, alt: t('oddlings.portraitAlt', { name: oddling.name }) }),
    premise: Object.freeze({
      obsession: say(`oddling.${oddling.id}.obsession`, premise.obsession),
      voice: say(`oddling.voice.${slugOf(premise.voice)}.name`, premise.voice),
      voiceNote: say(`oddling.voice.${slugOf(premise.voice)}.note`, premise.voiceNote),
      show: say(`oddling.show.${slugOf(premise.show)}.name`, premise.show),
      showNote: say(`oddling.show.${slugOf(premise.show)}.note`, premise.showNote),
    }),
  });
}

/** The character for an id, or null for anything that is not in the cast. */
export function publicOddlingById(id) {
  if (typeof id !== 'string' || id.length === 0 || id.length > MAX_ID_LENGTH || !ID_PATTERN.test(id)) return null;
  return BY_ID.get(id) ?? null;
}

/** The next characters after this one, wrapping round, never the character itself. */
export function neighbouringOddlings(id, count = NEIGHBOUR_COUNT) {
  const at = ROSTER.findIndex((oddling) => oddling.id === id);
  if (at < 0) return [];
  const limit = Math.min(count, ROSTER.length - 1);
  return Array.from({ length: limit }, (_, step) => ROSTER[(at + 1 + step) % ROSTER.length]);
}

/** Every public path the gallery adds to the sitemap: the index, then each character. */
export function oddlingSitemapPaths() {
  return [ODDLINGS_PATH, ...ROSTER.map((oddling) => oddling.path)];
}

/**
 * Metadata for one character page. The portrait is the share image. The page
 * spreads OPEN_GRAPH_BASE underneath openGraph (site name, type) because Next
 * merges nested metadata shallowly; twitter is replaced whole, so it is complete.
 */
export function oddlingMetadata(oddling, { t = ENGLISH, alternates } = {}) {
  const local = localizeOddling(oddling, t);
  const title = t('oddlings.detail.title', { name: oddling.name });
  const description = t('oddlings.detail.description', { hook: local.hook });
  const canonical = alternates?.canonical || oddling.path;
  const image = { url: oddling.portrait.src, width: oddling.portrait.width, height: oddling.portrait.height, alt: oddling.portrait.alt };
  const shareTitle = `${title} — Veyrnox.ai`;
  return {
    title,
    description,
    alternates: alternates || { canonical: oddling.path },
    openGraph: { title: shareTitle, description, url: canonical, images: [image] },
    twitter: { card: 'summary', title: shareTitle, description, images: [{ url: image.url, alt: image.alt }] },
  };
}

/** Metadata for the gallery page. `siteImage` is the site-wide share card. */
export function oddlingsIndexMetadata(siteImage, { t = ENGLISH, alternates } = {}) {
  const title = t('oddlings.meta.title');
  const description = t('oddlings.meta.description', { n: ROSTER.length });
  const shareTitle = t('oddlings.meta.ogTitle');
  const canonical = alternates?.canonical || ODDLINGS_PATH;
  return {
    title,
    description,
    alternates: alternates || { canonical: ODDLINGS_PATH },
    openGraph: { title: shareTitle, description, url: canonical, images: [siteImage] },
    twitter: { card: 'summary_large_image', title: shareTitle, description, images: [siteImage.url] },
  };
}
