'use client';
import { useEffect, useState } from 'react';

// Template data from /api/templates (lib/clientTemplates.js). The catalog behind it is about 2 MB; none of it is imported here, so a
// page that shows templates downloads a card list of a few dozen KB (cached) instead of the catalog in its bundle.
//
// A card is what a gallery tile shows: id, name, category, model, credits, durationSeconds, isNew, bg, previewAspect, clipKey, clip,
// promptPreview (the first words of the prompt) and taste (the Vibe Check words in the prompt, for ranking). A card is not a whole
// template: fetchTemplate(id) returns that, prompt included.

let cardsPromise = null;

/** The gallery's cards and category list, fetched once per page load. Resolves to null when the read fails (and tries again next time). */
export function loadTemplateCards() {
  cardsPromise ??= fetch('/api/templates')
    .then((response) => (response.ok ? response.json() : null))
    .then((body) => (body && Array.isArray(body.templates) && Array.isArray(body.categories)
      ? { templates: body.templates, categories: body.categories }
      : null))
    .catch(() => null)
    .then((result) => {
      if (!result) cardsPromise = null;
      return result;
    });
  return cardsPromise;
}

/** The cards once loaded: { templates: [], categories: ['ALL', 'NEW'], ready: false } until then. */
export function useTemplateCards() {
  const [state, setState] = useState({ templates: [], categories: ['ALL', 'NEW'], ready: false });
  useEffect(() => {
    let live = true;
    loadTemplateCards().then((result) => { if (live && result) setState({ ...result, ready: true }); });
    return () => { live = false; };
  }, []);
  return state;
}

const TEMPLATE_ID_RE = /^[a-z0-9-]{1,40}$/;

/** One whole template by id, or null when there is no such template or the read fails. */
export async function fetchTemplate(id) {
  if (typeof id !== 'string' || !TEMPLATE_ID_RE.test(id)) return null;
  try {
    const response = await fetch(`/api/templates/${encodeURIComponent(id)}`);
    if (!response.ok) return null;
    const body = await response.json();
    // The route resolves an id a template was published under before (app/veyrnox/_lib/templates.js templateById), so the
    // answer's id can differ from the one asked for; it is still a template id.
    return body && body.template && TEMPLATE_ID_RE.test(body.template.id) ? body.template : null;
  } catch {
    return null;
  }
}

/** Cards in a gallery category: ALL is every card, NEW is the new ones, anything else is that category. */
export function cardsIn(cards, category) {
  if (category === 'ALL') return cards;
  if (category === 'NEW') return cards.filter((card) => card.isNew);
  return cards.filter((card) => card.category === category);
}

const words = (query) => String(query || '').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);

// What a card can answer on its own. The server answers for the rest of each prompt, and its answer is a superset of this.
function cardMatches(card, terms) {
  const haystack = [card.name, card.id.replaceAll('-', ' '), card.model, card.category, card.promptPreview].filter(Boolean).join(' ').toLocaleLowerCase();
  return terms.every((term) => haystack.includes(term));
}

/**
 * Cards matching every word of `query`. A card's own text answers at once; the whole prompts are searched on the server and join in
 * when it answers, so nothing is lost and nothing waits. With no query, every card.
 */
export function useTemplateSearch(cards, query) {
  const trimmed = String(query || '').trim();
  const [answer, setAnswer] = useState({ query: '', ids: null });
  useEffect(() => {
    if (!trimmed) return undefined;
    let live = true;
    const timer = setTimeout(() => {
      fetch(`/api/templates?q=${encodeURIComponent(trimmed)}`)
        .then((response) => (response.ok ? response.json() : null))
        .then((body) => { if (live && body && Array.isArray(body.ids)) setAnswer({ query: trimmed, ids: new Set(body.ids) }); })
        .catch(() => {});
    }, 200);
    return () => { live = false; clearTimeout(timer); };
  }, [trimmed]);
  if (!trimmed) return cards;
  const terms = words(trimmed);
  const remote = answer.query === trimmed ? answer.ids : null;
  return cards.filter((card) => cardMatches(card, terms) || (remote && remote.has(card.id)));
}
