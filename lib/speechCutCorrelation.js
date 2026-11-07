const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bytes = value => new TextEncoder().encode(value);
async function key(secret, usages) {
    if (typeof secret !== 'string' || secret.length < 32) throw new Error('speech_secret_unavailable');
    return crypto.subtle.importKey('raw', bytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usages);
}
export async function speechCorrelation(jobId, secret) {
    if (!UUID.test(jobId)) throw new Error('invalid_job');
    const result = await crypto.subtle.sign('HMAC', await key(secret, ['sign']), bytes(`speech-analysis:v1:${jobId}`));
    return Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function verifySpeechCorrelation(jobId, token, secret) {
    if (!UUID.test(jobId || '') || !/^[0-9a-f]{64}$/.test(token || '')) return false;
    try {
        return await crypto.subtle.verify('HMAC', await key(secret, ['verify']), Uint8Array.from(token.match(/../g), pair => parseInt(pair, 16)), bytes(`speech-analysis:v1:${jobId}`));
    } catch { return false; }
}
