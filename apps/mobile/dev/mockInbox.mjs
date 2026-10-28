export function mockInbox(req, res, path, body, respond) {
    const send = (...args) => { respond(...args); return true; };
    // Publish inbox: one conversation you can reply to, resolve and assign. State is kept while the mock runs.
    const INBOX = (globalThis.__MOCK_INBOX ??= { status: 'open', unread: 1, priority: 'normal', tags: [], assigned: null, messages: [
        { id: 'm1', direction: 'inbound', body: 'Hi! Do you ship the poster set to Canada?', sent_at: '2026-10-20T09:00:00Z' },
        { id: 'm2', direction: 'outbound', body: 'Hello Maya, yes we do. Usually 5 to 7 days.', sent_at: '2026-10-20T09:10:00Z', delivery_status: 'sent' },
        { id: 'm3', direction: 'inbound', body: 'Great, can I pay with a gift card?', sent_at: '2026-10-21T08:30:00Z' },
    ] });
    const INBOX_ID = '33333333-3333-4333-8333-333333333333';
    const MEMBERS = [{ user_id: '44444444-4444-4444-8444-444444444444', email: 'sam@veyrnox.ai' }, { user_id: '55555555-5555-4555-8555-555555555555', email: 'priya@veyrnox.ai' }];
    const inboxThread = () => ({ id: INBOX_ID, network: 'instagram', account_name: 'Veyrnox Studio', kind: 'message', participant_name: 'Maya', subject: '', status: INBOX.status, unread_count: INBOX.unread, latest_message_at: INBOX.messages.at(-1).sent_at, priority: INBOX.priority, assigned_email: INBOX.assigned, tags: INBOX.tags, can_reply: true });
    if (path === '/api/v1/social/inbox' && req.method === 'GET') {
        const query = new URL(req.url, 'http://localhost').searchParams;
        const matches = (!query.get('priority') || query.get('priority') === INBOX.priority)
            && (!query.get('tag') || INBOX.tags.includes(query.get('tag')));
        send(res, 200, { counts: { all: 1, unread: INBOX.unread > 0 ? 1 : 0, unresolved: INBOX.status === 'resolved' ? 0 : 1, resolved: INBOX.status === 'resolved' ? 1 : 0 }, members: MEMBERS, tags: INBOX.tags, threads: matches ? [inboxThread()] : [] });
        return true;
    }
    const m = path.match(/^\/api\/v1\/social\/inbox\/([^/]+)(\/reply)?$/);
    if (m && m[1] === INBOX_ID) {
        if (!m[2] && req.method === 'GET') return send(res, 200, { thread: inboxThread(), messages: INBOX.messages, notes: [] });
        if (!m[2] && req.method === 'PATCH') {
            if (body.action === 'read') INBOX.unread = 0;
            else if (body.action === 'priority' && ['normal', 'high', 'urgent'].includes(body.priority)) INBOX.priority = body.priority;
            else if (body.action === 'tags' && Array.isArray(body.tags) && body.tags.length <= 10 && body.tags.every(tag => typeof tag === 'string' && tag.trim().length > 0 && tag.trim().length <= 32)) INBOX.tags = [...new Set(body.tags.map(tag => tag.trim().toLowerCase()))];
            else if (body.action === 'resolve') INBOX.status = 'resolved'; else if (body.action === 'reopen') INBOX.status = 'open';
            else if (body.action === 'assign') INBOX.assigned = (MEMBERS.find((x) => x.user_id === body.userId) || {}).email ?? null; else if (body.action === 'unassign') INBOX.assigned = null;
            return send(res, 200, { ok: true });
        }
        if (m[2] && req.method === 'POST') {
            if (typeof body.body !== 'string' || !body.body.trim()) return send(res, 400, { error: 'invalid_reply' });
            INBOX.messages.push({ id: `m${INBOX.messages.length + 1}`, direction: 'outbound', body: body.body.trim(), sent_at: new Date().toISOString(), delivery_status: 'sent' });
            return send(res, 200, { ok: true });
        }
    }
    return false;
}
