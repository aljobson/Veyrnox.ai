const timestamp = (value) => {
    const ms = typeof value === 'number' ? value * 1000 : Date.parse(value);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : new Date().toISOString();
};
const text = (value, limit) => typeof value === 'string' && value ? value.slice(0, limit) : null;

/** Normalize only documented inbox event shapes. Unknown changes are ignored,
 * so adding a Meta subscription cannot accidentally create misleading rows. */
export function parseMetaInboxEvents(payload) {
    if (!payload || !['instagram', 'page'].includes(payload.object) || !Array.isArray(payload.entry)) return [];
    const network = payload.object === 'instagram' ? 'instagram' : 'facebook';
    const events = [];
    for (const entry of payload.entry) {
        const externalAccountId = text(entry?.id, 128);
        if (!externalAccountId) continue;
        for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
            const value = change?.value;
            if (!value || typeof value !== 'object') continue;
            if (network === 'instagram' && change.field === 'comments' && text(value.id, 256)) {
                events.push({ network, externalAccountId, providerThreadId: text(value.id, 256),
                    kind: 'comment', providerMessageId: text(value.id, 256), direction: 'inbound', body: text(value.text, 8000), media: [],
                    participantExternalId: text(value.from?.id, 256), participantName: text(value.from?.username, 200), participantAvatarUrl: null,
                    subject: 'Instagram comment', providerUrl: null, canReply: true, sentAt: timestamp(entry.time) });
            }
            if (network === 'facebook' && change.field === 'feed' && value.item === 'comment' && text(value.comment_id, 256)) {
                events.push({ network, externalAccountId, providerThreadId: text(value.comment_id, 256),
                    kind: 'comment', providerMessageId: text(value.comment_id, 256), direction: value.from?.id === externalAccountId ? 'outbound' : 'inbound',
                    body: text(value.message, 8000), media: [], participantExternalId: text(value.from?.id, 256),
                    participantName: text(value.from?.name, 200), participantAvatarUrl: null, subject: 'Facebook comment',
                    providerUrl: text(value.permalink_url, 2048), canReply: true, sentAt: timestamp(value.created_time || entry.time) });
            }
            if (network === 'facebook' && change.field === 'ratings' && text(value.review_text, 8000)) {
                const id = text(value.review_id, 256) || `${text(value.reviewer_id, 128) || 'review'}:${entry.time || Date.now()}`;
                events.push({ network, externalAccountId, providerThreadId: id, kind: 'review', providerMessageId: id,
                    direction: 'inbound', body: text(value.review_text, 8000), media: [], participantExternalId: text(value.reviewer_id, 256),
                    participantName: text(value.reviewer_name, 200), participantAvatarUrl: null, subject: value.rating ? `${value.rating}-star review` : 'Facebook review',
                    providerUrl: null, canReply: false, sentAt: timestamp(value.created_time || entry.time) });
            }
        }
        for (const messageEvent of Array.isArray(entry.messaging) ? entry.messaging : []) {
            const message = messageEvent?.message;
            const messageId = text(message?.mid, 256);
            const senderId = text(messageEvent?.sender?.id, 256);
            const recipientId = text(messageEvent?.recipient?.id, 256);
            if (!messageId || !senderId || !recipientId) continue;
            const outbound = message?.is_echo === true || senderId === externalAccountId;
            const participant = outbound ? recipientId : senderId;
            events.push({ network, externalAccountId, providerThreadId: participant, kind: 'message', providerMessageId: messageId,
                direction: outbound ? 'outbound' : 'inbound', body: text(message.text, 8000), media: Array.isArray(message.attachments) ? message.attachments.slice(0, 10) : [],
                participantExternalId: participant, participantName: null, participantAvatarUrl: null, subject: 'Direct message',
                providerUrl: null, canReply: false, sentAt: timestamp(messageEvent.timestamp ? messageEvent.timestamp / 1000 : entry.time) });
        }
    }
    return events.slice(0, 200);
}

export async function verifyMetaWebhookSignature(raw, signature, secret) {
    if (!(raw instanceof Uint8Array) || !/^sha256=[a-f0-9]{64}$/.test(signature || '') || typeof secret !== 'string' || secret.length < 8) return false;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const expected = Uint8Array.from(signature.slice(7).match(/../g), (pair) => parseInt(pair, 16));
    return crypto.subtle.verify('HMAC', key, expected, raw);
}
