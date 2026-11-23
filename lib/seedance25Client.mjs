// Shared web/phone confirmation and retry state. No client duration participates in a price.
export function seedance25Models(models) {
    return (models || []).filter(m => ['seedance-2.5-edit', 'seedance-2.5-extend'].includes(m.id)
        && !m.gated && (m.media || m.capabilities?.media)?.video?.required === true
        && (m.media || m.capabilities?.media)?.video?.maxFiles === 1);
}
export function createSeedance25Session({ request, makeKey, reference, current = () => true }) {
    let prepared = null, attempted = false, busy = false, resolvedReference = null;
    const check = () => { if (!current()) throw new Error('account_changed'); };
    return {
        get attempted() { return attempted; },
        async quote(model, prompt) {
            if (busy || attempted) throw new Error('submission_in_progress');
            busy = true; prepared = null;
            try {
                check();
                resolvedReference ||= await reference();
                check();
                const body = { model_id: model.id, inputs: { prompt }, references: [resolvedReference], consent: true };
                const quote = await request('/generations/quote', body);
                check();
                if (!Number.isSafeInteger(quote.credits) || quote.credits <= 0 || ![1, 2].includes(quote.units)
                    || quote.model_id !== model.id || quote.credits !== model.credits * quote.units) throw new Error('quote_invalid');
                prepared = { ...body, confirmed_credits: quote.credits, idempotency_key: makeKey() };
                return quote;
            } finally { busy = false; }
        },
        async submit() {
            if (!prepared || busy) throw new Error('quote_required');
            busy = true;
            try {
                check(); attempted = true;
                // Retain this exact body and key after a lost response. No automatic repeat charge.
                const result = await request('/generations', prepared);
                check();
                if (typeof result.job_id !== 'string' || !result.job_id) throw new Error('admission_unknown');
                return result;
            } catch (error) {
                if (['credit_confirmation_mismatch', 'confirmed_credits_required', 'price_changed'].includes(error.code)) { attempted = false; prepared = null; }
                throw error;
            } finally { busy = false; }
        },
    };
}
