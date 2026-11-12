/**
 * Output resolution tiers for Create (images and videos).
 *
 * A capability record may declare `tiers: { base, options }`:
 *   base     the tier the model's catalog price (`credits_5s`) is costed at
 *   options  our tier id -> provider fields sent for that tier (applied after `fixed`)
 * A model offers only the tiers its provider really supports; there is no upscaling.
 *
 * The price is the catalog price times the ratio of the chosen tier's weight to
 * the base tier's weight, rounded up. Weights live here, on the server, and the
 * public catalog exposes the resulting multipliers so the page quotes the same
 * figure the gateway debits.
 */

export const TIER_IDS = Object.freeze(['720p', '1080p', '1440p', '4k']);

/** Relative cost weight of each tier. 720p is 1; the others are measured against it. */
export const TIER_WEIGHT = Object.freeze({ '720p': 1, '1080p': 1.5, '1440p': 2.25, '4k': 3.5 });

export const isTierId = value => typeof value === 'string' && Object.hasOwn(TIER_WEIGHT, value);

/** Tier ids a record offers, in ascending order, or [] when it has no tiers. */
export function tiersFor(record) {
    const options = record?.tiers?.options;
    if (!options) return [];
    return TIER_IDS.filter(id => id === record.tiers.base || Object.hasOwn(options, id));
}

/** Multiplier of `tier` over the record's base price (1 for the base tier). */
export function tierMultiplier(record, tier) {
    const base = record?.tiers?.base;
    if (!base || !tier || !tiersFor(record).includes(tier)) return 1;
    return TIER_WEIGHT[tier] / TIER_WEIGHT[base];
}

/** Credits owed for a base price at a tier; never below the base price. */
export function tieredCredits(baseCredits, record, tier) {
    return Math.max(baseCredits, Math.ceil(baseCredits * tierMultiplier(record, tier) - 1e-9));
}

/** Provider fields for a chosen non-base tier, or {}. */
export function tierFields(record, tier) {
    const options = record?.tiers?.options;
    return options && tier && Object.hasOwn(options, tier) ? options[tier] : {};
}
