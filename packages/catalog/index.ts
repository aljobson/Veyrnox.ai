/**
 * @veyrnox/catalog — normative pricing + model definitions.
 *
 * Source of truth: docs/pricing/platform_model.xlsx (external, sensitive —
 * not checked in). Values here are hand-transcribed from the "Model Catalog"
 * and "Assumptions" sheets. When those sheets update, this file updates in
 * the same commit, and the margin_floor CI job catches drift.
 *
 * Credits are the user-facing unit. Every plan grants credits per month;
 * every generation debits credits. The price of a model in credits is
 * fixed across plans — plans differ in how many credits per dollar the
 * user gets. Ultra ($99 / 3000 credits = $0.033/credit) sets the reference
 * conversion rate used for margin math below.
 */

// ─── Plans (Assumptions sheet) ────────────────────────────────────────────

export type PlanId = "free" | "starter" | "plus" | "ultra";

export interface Plan {
    id: PlanId;
    price_usd_per_month: number;
    credits_per_month: number;
    /** Dollars per credit for a subscriber on this plan. */
    dollars_per_credit: number;
}

export const PLANS: readonly Plan[] = Object.freeze([
    { id: "free",    price_usd_per_month:  0, credits_per_month:   50, dollars_per_credit: 0     },
    { id: "starter", price_usd_per_month: 15, credits_per_month:  200, dollars_per_credit: 0.075 },
    { id: "plus",    price_usd_per_month: 39, credits_per_month: 1000, dollars_per_credit: 0.039 },
    { id: "ultra",   price_usd_per_month: 99, credits_per_month: 3000, dollars_per_credit: 0.033 },
]);

/**
 * Reference conversion rate: Ultra's dollars-per-credit, which is the lowest
 * (cheapest for the buyer, tightest margin for us). Every catalog row's
 * credit_price × REFERENCE_DOLLARS_PER_CREDIT must clear its provider cost
 * plus MARGIN_FLOOR.
 */
export const REFERENCE_DOLLARS_PER_CREDIT = 0.033;

// ─── Margin floors (§5.10 gate) ───────────────────────────────────────────

export const MARGIN_FLOOR = 0.5; // 50% gross margin floor over provider cost.

// ─── Model catalog ────────────────────────────────────────────────────────

export type ModelStatus = "LAUNCH" | "GATE" | "PHASE_2" | "SKIP";
export type Modality = "text-to-video" | "text-to-image" | "text-to-audio";

export interface CatalogRow {
    /** Stable id used in URLs, ledger rows, jobs.model_id. */
    id: string;
    /** Human name (from Model Catalog sheet). */
    name: string;
    modality: Modality;
    /**
     * Provider preference order. The first one supporting the model handles
     * the request; failover walks the list.
     */
    providers: readonly ("fal" | "replicate")[];
    /** Provider unit cost in USD, per generation (5s video / one image / etc.). */
    provider_cost_usd: number;
    /** Retail price in USD (sell $/gen from the xlsx). Documented for audit. */
    retail_usd: number;
    /**
     * The number of credits a generation costs. Fixed across plans. Computed
     * once as ceil(retail_usd / REFERENCE_DOLLARS_PER_CREDIT).
     */
    credits: number;
    /** True when the model needs a paid plan (Plus/Ultra) to run. */
    gated: boolean;
    status: ModelStatus;
    notes?: string;
}

/**
 * Helper: convert a retail USD price to a credit price at the reference rate.
 * Ceil so the platform never sells credits below cost.
 */
export function usdToCredits(retailUsd: number): number {
    return Math.ceil(retailUsd / REFERENCE_DOLLARS_PER_CREDIT);
}

export const CATALOG: readonly CatalogRow[] = Object.freeze([
    // ── Video (5s clip) ──
    {
        id: "wan-2.5",
        name: "Wan 2.5 / 2.6",
        modality: "text-to-video",
        providers: ["fal", "replicate"],
        provider_cost_usd: 0.25,
        retail_usd: 0.528,
        credits: usdToCredits(0.528),
        gated: false,
        status: "LAUNCH",
        notes: "workhorse; $0.05/s fal",
    },
    {
        id: "seedance-2.0-fast",
        name: "Seedance 2.0 (Fast)",
        modality: "text-to-video",
        providers: ["fal", "replicate"],
        provider_cost_usd: 0.45,
        retail_usd: 0.924,
        credits: usdToCredits(0.924),
        gated: false,
        status: "LAUNCH",
        notes: "$0.022/s fast tier",
    },
    {
        id: "kling-2.6-pro",
        name: "Kling 2.6 Pro",
        modality: "text-to-video",
        providers: ["fal", "replicate"],
        provider_cost_usd: 0.35,
        retail_usd: 0.726,
        credits: usdToCredits(0.726),
        gated: false,
        status: "LAUNCH",
    },
    {
        id: "kling-3.0-i2v",
        name: "Kling 3.0 (image-to-video)",
        modality: "image-to-video",
        providers: ["fal", "replicate"],
        provider_cost_usd: 0.50,
        retail_usd: 1.023,
        credits: usdToCredits(1.023),
        gated: false,
        status: "LAUNCH",
        notes: "$0.10/s 4K multi-shot",
    },
    {
        id: "minimax-h3",
        name: "MiniMax H3",
        modality: "text-to-video",
        providers: ["fal", "replicate"],
        provider_cost_usd: 0.30,
        retail_usd: 0.627,
        credits: usdToCredits(0.627),
        gated: false,
        status: "LAUNCH",
        notes: "fast short-form",
    },
    {
        id: "veo-3.1",
        name: "Veo 3.1",
        modality: "text-to-video",
        providers: ["fal", "replicate"],
        provider_cost_usd: 2.00,
        retail_usd: 4.026,
        credits: usdToCredits(4.026),
        gated: true,
        status: "GATE",
        notes: "premium — Plus/Ultra plans only; daily cap 1/user",
    },
    {
        id: "veo-3.1-fast",
        name: "Veo 3.1 Fast",
        modality: "text-to-video",
        providers: ["fal"],
        provider_cost_usd: 0.75,
        retail_usd: 1.518,
        credits: usdToCredits(1.518),
        gated: false,
        status: "LAUNCH",
        notes: "fal-ai/veo3.1/fast — 5s 1080p with audio $0.75",
    },

    // ── Image (per generation) ──
    {
        id: "flux-2-pro",
        name: "Flux.2 [pro]",
        modality: "text-to-image",
        providers: ["fal", "replicate"],
        provider_cost_usd: 0.03,
        retail_usd: 0.066,
        credits: usdToCredits(0.066),
        gated: false,
        status: "LAUNCH",
        notes: "$0.03/MP cinematic",
    },
    {
        id: "seedream-4",
        name: "Seedream v4",
        modality: "text-to-image",
        providers: ["fal", "replicate"],
        provider_cost_usd: 0.04,
        retail_usd: 0.099,
        credits: usdToCredits(0.099),
        gated: false,
        status: "LAUNCH",
        notes: "budget artistic",
    },
    {
        id: "nano-banana",
        name: "Nano Banana / Pro",
        modality: "text-to-image",
        providers: ["fal", "replicate"],
        provider_cost_usd: 0.06,
        retail_usd: 0.132,
        credits: usdToCredits(0.132),
        gated: false,
        status: "LAUNCH",
        notes: "NB2 $0.06; Pro $0.15",
    },

    // ── Audio (per generation) ──
    {
        id: "ace-step",
        name: "ACE-Step (music/SFX)",
        modality: "text-to-audio",
        providers: ["fal"],
        provider_cost_usd: 0.010,
        retail_usd: 0.033,
        credits: usdToCredits(0.033),
        gated: false,
        status: "LAUNCH",
        notes: "music / SFX",
    },
]);

/**
 * Skipped models per the pricing sheet — kept here so future contributors
 * don't re-add them without reading the reason.
 */
export const SKIPPED_MODELS: ReadonlyArray<{ name: string; reason: string }> = Object.freeze([
    { name: "Sora 2 / Pro", reason: "unavailable — removed after OpenAI MSA change" },
    { name: "Soul 2.0", reason: "unlicensable — Higgsfield in-house" },
]);

/** Find a catalog row by id. */
export function getCatalogRow(id: string): CatalogRow | undefined {
    return CATALOG.find((r) => r.id === id);
}
