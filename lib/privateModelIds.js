/**
 * Server-only catalog rows that customers never see (ADR-0351 amendment 21).
 *
 * `kling-o1-swap-crun` serves validated template swaps. Clients keep sending and receiving the offer they already
 * know, `kling-o1-reference`, so every response that carries a job's model id passes through `clientModelId`.
 * Not imported by client code: the private id must not enter a browser or app bundle.
 */
export const TEMPLATE_SWAP_CRUN_MODEL = 'kling-o1-swap-crun';
export const TEMPLATE_SWAP_CRUN_ENDPOINT = 'crun:kling/o1-r2v';
// The same swap at 1080p (amendment 22). Dispatched only while the `templateSwapCrun1080` runtime key is on.
export const TEMPLATE_SWAP_CRUN_1080_MODEL = 'kling-o1-swap-crun-1080';
export const TEMPLATE_SWAP_CRUN_1080_ENDPOINT = 'crun:kling/o1-r2v-1080';

const CLIENT_MODEL = Object.freeze({ [TEMPLATE_SWAP_CRUN_MODEL]: 'kling-o1-reference', [TEMPLATE_SWAP_CRUN_1080_MODEL]: 'kling-o1-reference' });

export const isPrivateModelId = id => typeof id === 'string' && Object.hasOwn(CLIENT_MODEL, id);
export const clientModelId = id => (isPrivateModelId(id) ? CLIENT_MODEL[id] : id);

/** The same rows with a private `model_id` replaced. Rows without one are returned as they are. */
export function withClientModelIds(rows) {
    return Array.isArray(rows)
        ? rows.map(row => (row && typeof row === 'object' && isPrivateModelId(row.model_id) ? { ...row, model_id: clientModelId(row.model_id) } : row))
        : rows;
}
