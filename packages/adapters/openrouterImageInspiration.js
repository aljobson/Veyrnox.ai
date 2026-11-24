import { readBoundedBody } from '../../lib/boundedBody.js';
import { parseMusicInspirationResult } from '../../lib/musicInspiration.js';
import { InspirationProviderError } from './inspirationProviderError.js';

export const IMAGE_INSPIRATION_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const IMAGE_INSPIRATION_RESPONSE_MAX_BYTES = 32 * 1024;
export const IMAGE_INSPIRATION_TIMEOUT_MS = 45_000;
const MODEL_RE = /^[a-z0-9][a-z0-9._:/-]{0,100}$/i;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export class ImageInspirationProviderError extends InspirationProviderError {}

const codeFor = status => status === 401 || status === 403 ? 'provider_auth_failed'
    : status === 402 ? 'provider_payment_required'
        : status === 408 || status === 504 ? 'provider_timeout'
            : status === 429 ? 'provider_rate_limited'
                : status === 400 || status === 422 ? 'provider_request_rejected' : 'provider_unavailable';

function base64(bytes) {
    let output = '';
    const chunk = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunk) {
        output += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunk)));
    }
    return btoa(output);
}

export async function analyzeImageInspiration({ apiKey, model, bytes, mediaType, signal, fetchImpl = fetch }) {
    if (typeof apiKey !== 'string' || !apiKey) throw new ImageInspirationProviderError('provider_not_configured');
    if (typeof model !== 'string' || !MODEL_RE.test(model)) throw new ImageInspirationProviderError('provider_model_unmapped');
    if (!(bytes instanceof Uint8Array) || !IMAGE_TYPES.has(mediaType)) throw new ImageInspirationProviderError('provider_request_invalid');
    const timeout = AbortSignal.timeout(IMAGE_INSPIRATION_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response;
    try {
        response = await fetchImpl(IMAGE_INSPIRATION_URL, {
            method: 'POST', redirect: 'manual', signal: combined,
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model, max_tokens: 512, temperature: 0, stream: false,
                provider: { data_collection: 'deny', zdr: true, require_parameters: true },
                response_format: { type: 'json_object' },
                messages: [{ role: 'user', content: [
                    { type: 'text', text: 'Turn the visual mood, colour, texture and composition of this image into an original music-creation brief. Do not identify people or artists and do not imitate a named creator. Return only JSON with exactly safe:boolean, brief:string, tags:string[]. Mark safe false for sexual content involving minors or non-consensual sexual content.' },
                    { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64(bytes)}` } },
                ] }],
            }),
        });
    } catch (error) {
        if (signal?.aborted) throw error;
        if (timeout.aborted) throw new ImageInspirationProviderError('provider_timeout');
        throw new ImageInspirationProviderError('provider_unavailable');
    }
    if (!response.ok || !response.body) throw new ImageInspirationProviderError(codeFor(response.status));
    let envelope;
    try {
        const raw = await readBoundedBody(response.body, IMAGE_INSPIRATION_RESPONSE_MAX_BYTES, combined);
        envelope = JSON.parse(new TextDecoder().decode(raw));
    } catch (error) {
        if (signal?.aborted) throw error;
        if (timeout.aborted) throw new ImageInspirationProviderError('provider_timeout');
        throw new ImageInspirationProviderError('provider_response_invalid');
    }
    if (envelope?.error) throw new ImageInspirationProviderError('provider_error');
    const content = envelope?.choices?.[0]?.message?.content;
    let value;
    try { value = JSON.parse(content); } catch { throw new ImageInspirationProviderError('provider_response_invalid'); }
    const parsed = parseMusicInspirationResult(value);
    if (!parsed.ok) throw new ImageInspirationProviderError(parsed.error);
    return parsed;
}
