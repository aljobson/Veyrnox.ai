const META_GRAPH = 'https://graph.facebook.com/v23.0';
const INSTAGRAM_GRAPH = 'https://graph.instagram.com/v25.0';

function providerUrl(base, id, suffix) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_.:-]{1,256}$/.test(id)) throw new Error('invalid_provider_id');
    return `${base}/${encodeURIComponent(id)}/${suffix}`;
}

/** Reply to an existing provider comment. Message replies stay read-only until
 * their provider-specific policy windows and review permissions are enabled. */
export async function sendInboxReply({ network, kind, providerThreadId, body, accessToken }, fetcher = fetch) {
    if (kind !== 'comment' || !['instagram', 'facebook'].includes(network)) {
        const error = new Error('reply_unavailable'); error.code = 'REPLY_UNAVAILABLE'; throw error;
    }
    if (typeof body !== 'string' || body.trim().length < 1 || body.trim().length > 8000) throw new Error('invalid_reply');
    if (typeof accessToken !== 'string' || accessToken.length < 8) throw new Error('invalid_token');

    const url = providerUrl(network === 'instagram' ? INSTAGRAM_GRAPH : META_GRAPH, providerThreadId,
        network === 'instagram' ? 'replies' : 'comments');
    const form = new FormData();
    form.set('message', body.trim());
    const response = await fetcher(url, {
        method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, body: form,
        redirect: 'manual', signal: AbortSignal.timeout(15000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || typeof payload.id !== 'string') throw new Error(`provider_reply_failed_${response.status}`);
    return { providerMessageId: payload.id };
}

export function safeInboxFailureCode(error) {
    if (error?.code === 'REPLY_UNAVAILABLE') return 'reply_unavailable';
    const status = /^provider_reply_failed_([0-9]{3})$/.exec(error?.message || '')?.[1];
    if (status) return `provider_${status}`;
    if (['AbortError', 'TimeoutError'].includes(error?.name)) return 'provider_timeout';
    return 'provider_failed';
}
