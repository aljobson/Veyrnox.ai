import { ODDLING_ARCHETYPES } from './character.js';
import { ODDLING_PRESET_SOURCES, oddlingsForSource } from './oddlingStudio.js';

// Explore shows the whole cast by default. The themed collections stay as tabs;
// "Human" and "Other beings" are filters over whichever tab is open, so they no
// longer take a tab of their own.
export const ODDLING_EXPLORE_DEFAULT_SOURCE = 'all';
export const ODDLING_EXPLORE_TABS = ODDLING_PRESET_SOURCES.filter((source) => !source.kind);
export const ODDLING_KIND_FILTERS = [
  { id: 'human', label: 'Human' },
  { id: 'creature', label: 'Other beings' },
];

// First-party portraits that already ship in public/oddlings/portraits, picked
// to look different from each other (body, hair, fashion, a creature).
export const ODDLING_HERO_IDS = ['duchess-volume', 'disco-anvil', 'madame-scissors', 'tuesday-triangle', 'mossbyte'];

const DEEP_LINK_PARAM = 'oddling';
const DEEP_LINK_MAX = 80;

const validKind = (kind) => ODDLING_KIND_FILTERS.some(({ id }) => id === kind) ? kind : '';

/** The characters on show for a tab and an optional Human / Other beings filter. */
export function exploreCharacters(sourceId, kind = '') {
  const characters = oddlingsForSource(sourceId);
  const wanted = validKind(kind);
  return wanted ? characters.filter((item) => item.kind === wanted) : characters;
}

/** How many of each kind a tab holds, for the filter chips. */
export function exploreKindCounts(sourceId) {
  const characters = oddlingsForSource(sourceId);
  return Object.fromEntries(ODDLING_KIND_FILTERS.map(({ id }) => [id, characters.filter((item) => item.kind === id).length]));
}

/** Pressing the active chip clears the filter; any other id selects it. */
export function toggleKindFilter(current, id) {
  const wanted = validKind(id);
  return wanted && wanted !== current ? wanted : '';
}

/** A filter that would leave a newly opened tab empty is dropped. */
export function reconcileKindFilter(sourceId, kind) {
  const wanted = validKind(kind);
  return wanted && exploreKindCounts(sourceId)[wanted] > 0 ? wanted : '';
}

/**
 * A read-only deep link: /app/oddlings?oddling=<archetype id>. Only an id from
 * the built-in cast counts; anything else (another route's flag, a path, markup)
 * is ignored, and callers show the character's own name, never the parameter.
 */
export function parseOddlingDeepLink(search = '') {
  let value = null;
  try { value = new URLSearchParams(String(search)).get(DEEP_LINK_PARAM); } catch { return null; }
  if (typeof value !== 'string' || !value || value.length > DEEP_LINK_MAX) return null;
  return ODDLING_ARCHETYPES.find((item) => item.id === value) || null;
}

export function heroCharacters() {
  return ODDLING_HERO_IDS.map((id) => ODDLING_ARCHETYPES.find((item) => item.id === id)).filter(Boolean);
}
