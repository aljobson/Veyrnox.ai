// Effective USD per million consumed tokens for the verifier's fixed 720p,
// no-video-input jobs. These include pack deduction multipliers, not promotions.
// Source: docs.byteplus.com/en/docs/modelark/seedance-2-0-model-resource-pack-rules
const RATES = {
    'byteplus:seedance-2.0-fast': 5.60,
    'byteplus:seedance-2.0-mini': 3.50,
    'byteplus:seedance-2.0': 7.00,
    'byteplus:seedance-2.5': 10.70,
    'byteplus:seedance-1.0-pro-fast': 1.00,
};

export function assessBytePlusCost(endpoint, tokens, recordedCost) {
    const rate = RATES[endpoint];
    if (!rate || !Number.isFinite(tokens) || tokens <= 0
        || !Number.isFinite(recordedCost) || recordedCost <= 0) {
        return { costWithinTolerance: false, costEvidence: 'missing-or-invalid' };
    }
    const rawCost = tokens / 1_000_000 * rate;
    return {
        billedCost: Number(rawCost.toFixed(4)),
        effectiveUsdPerMToken: rate,
        costEvidence: 'token-estimate-not-invoice',
        costWithinTolerance: Math.abs(rawCost - recordedCost) <= recordedCost * 0.05,
    };
}
