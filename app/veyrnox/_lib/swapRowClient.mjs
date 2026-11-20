import { TEMPLATE_SWAP_ROW } from './templateSwapRow.js';

/**
 * The row's live cards, joined to their static name and poster, in the row's order. [] on any failure, a switch that is off or a
 * malformed answer, so the row simply does not render. `origin` is '' on the web and the API origin on the phone.
 * @param {typeof fetch} [fetcher]
 * @param {string} [origin]
 * @param {AbortSignal} [signal]
 * @returns {Promise<Array<{ id: string, name: string, poster: string, aspectRatio: string, credits: number }>>}
 */
export async function fetchSwapRow(fetcher = fetch, origin = '', signal) {
  try {
    const response = await fetcher(`${origin}/api/catalog?template_swap_row=1`, { signal });
    if (response.status !== 200) return [];
    const body = await response.json();
    const live = new Map((Array.isArray(body?.items) ? body.items : []).filter(i => typeof i?.id === 'string' && Number.isInteger(i.credits) && i.credits > 0).map(i => [i.id, i.credits]));
    return TEMPLATE_SWAP_ROW.filter(row => live.has(row.id)).map(row => ({ ...row, credits: live.get(row.id) }));
  } catch { return []; }
}

/** A CSS aspect-ratio from a clip ratio like "406 / 720"; anything else falls back to 9 / 16. */
export function swapRowRatio(value) {
  return typeof value === 'string' && /^\d{1,5}(\s*[/:]\s*\d{1,5})?$/.test(value.trim()) ? value.trim().replace(':', '/') : '9 / 16';
}
