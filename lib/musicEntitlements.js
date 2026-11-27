import { musicDurationBounds, musicDurationControls } from './musicLongSongs.js';
import {
    CRUN_MUSIC_OFFER_NAMES, CRUN_SUNO_LIMITS, MUSIC_CRUN_CONTRACT, MUSIC_FAL_CONTRACT, crunEntitlement,
} from './musicCrunContract.js';

const MODEL_IDS = Object.freeze(['ace-step', 'ace-step-1.5']);
const PREMIUM = 'ace-step-1.5';
const PROMPT_MAX = 500;
const TITLE_MAX = 80;
const LYRICS_MAX = 3000;
const STYLES_MAX = 500;
const EXCLUDE_MAX = 500;

/** Authenticated create-screen projection from a freshly read catalog. */
export function musicEntitlementProjection({ models, credits, generationEnabled, subscription, now = Date.now(), longSongs = false, crunAvailability = null }) {
    const paidPeriodEnd = Date.parse(subscription?.current_period_end || '');
    const paidPlan = subscription?.status === 'active'
        && Number.isFinite(paidPeriodEnd) && paidPeriodEnd > now;
    const verified = (Array.isArray(models) ? models : [])
        .filter((model) => MODEL_IDS.includes(model?.id)
            && model?.modality === 'text-to-audio' && model?.gated === false
            && Number.isFinite(Number(model?.credits)) && Number(model.credits) > 0)
        .sort((left, right) => MODEL_IDS.indexOf(left.id) - MODEL_IDS.indexOf(right.id))
        .map((model) => ({
            ...(() => {
                if (model.provider_contract === MUSIC_CRUN_CONTRACT) return crunEntitlement(model, crunAvailability);
                const inputs = model?.capabilities?.inputs || {};
                return {
                    ...(model.provider_contract ? { provider_contract: MUSIC_FAL_CONTRACT } : {}),
                    generation_modes: model.id === PREMIUM ? ['simple', 'custom'] : ['simple'],
                    controls: {
                        description: Boolean(inputs.prompt) || model.id === 'ace-step',
                        seed: Boolean(inputs.seed), variety: model.id === PREMIUM,
                        style_influence: model.id === PREMIUM, exclude_styles: model.id === PREMIUM,
                        tempo_key_meter: model.id === PREMIUM,
                        ...musicDurationControls(model.id, { longSongs }),
                        lyrics: model.id === PREMIUM || Boolean(inputs.lyrics),
                        styles: model.id === PREMIUM || Boolean(inputs.styles),
                        instrumental: model.id === PREMIUM ? 'optional' : 'required',
                    },
                    ...(model.provider_contract ? { limits: {
                        prompt: PROMPT_MAX, title: TITLE_MAX, lyrics: LYRICS_MAX,
                        styles: STYLES_MAX, exclude_styles: EXCLUDE_MAX,
                        duration_seconds: musicDurationBounds(model.id, { longSongs }),
                    }, counters: {
                        prompt: { max: PROMPT_MAX }, title: { max: TITLE_MAX }, lyrics: { max: LYRICS_MAX },
                        styles: { max: STYLES_MAX }, exclude_styles: { max: EXCLUDE_MAX },
                    } } : {}),
                };
            })(),
            id: model.id,
            name: model.provider_contract === MUSIC_CRUN_CONTRACT
                ? CRUN_MUSIC_OFFER_NAMES[model.id]
                : String(model.name || 'ACE-Step'),
            credits_per_candidate: Number(model.credits), total_credits: Number(model.credits),
            instrumental_only: model.id !== PREMIUM,
            requires_paid_plan: model.id === PREMIUM,
            available: (model.id !== PREMIUM || paidPlan) && (model.provider_contract !== MUSIC_CRUN_CONTRACT
                || (crunAvailability?.admission_open !== false && crunAvailability?.endpoint_open !== false
                    && (model.id !== 'ace-step' || crunAvailability?.suno_models?.v6 !== false)
                    && (model.id !== PREMIUM || crunEntitlement(model, crunAvailability).controls.suno_model.length > 0))),
        }));
    const premiumContract = verified.find((model) => model.id === PREMIUM)?.provider_contract;
    return {
        available: generationEnabled === true && verified.some((model) => model.available),
        mode: 'simple', output_count: 1, concurrency_limit: 4,
        balance: Number(credits?.balance) || 0,
        free_credits: Number(credits?.free_credits) || 0,
        free_expires_at: credits?.free_expires_at || null,
        models: verified,
        custom_drafts: {
            available: true, autosave: true,
            generation_supported: verified.some((model) => model.available && model.generation_modes.includes('custom')),
            ...(premiumContract ? { provider_contract: premiumContract } : {}),
            lyrics_max: premiumContract === MUSIC_CRUN_CONTRACT ? CRUN_SUNO_LIMITS.lyrics : LYRICS_MAX,
            styles_max: premiumContract === MUSIC_CRUN_CONTRACT ? CRUN_SUNO_LIMITS.styles : STYLES_MAX,
            title_max: TITLE_MAX,
        },
        policy: { version: 'music-prompt-v1', pre_debit: true },
    };
}
