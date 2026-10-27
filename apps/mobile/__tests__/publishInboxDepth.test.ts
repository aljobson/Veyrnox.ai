import { act, createElement } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import InboxThread from '../src/app/(app)/publish/inbox-thread';
import { ApiError, type ApiClient } from '../src/lib/api';
import { addNote, cleanNote, decideSuggestion, fetchSuggestions, parseSuggestions, replyOutcome } from '../src/lib/publishInbox';
import { fetchInboxAnalytics, inboxAnalyticsErrorKey, parseInboxAnalytics } from '../src/lib/publishInboxAnalytics';
import { brandStore } from '../src/lib/publishBrand';
import { t } from '../src/lib/i18n';
import { ID, OTHER, buttons, deferred, field, input, press, textOf } from './publishDepthTestHelpers';
declare const __dirname: string;
const fs = require('fs'), path = require('path');
const mockRequest = jest.fn(), mockApi = { request: mockRequest } as unknown as ApiClient;
let mockKey = 0, mockUser = 'owner';
var mockListeners = new Set<() => void>();
jest.mock('../src/lib/usePublishApi', () => ({ usePublishApi: () => mockApi }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useLocalSearchParams: () => ({ id: '11111111-1111-4111-8111-111111111111' }) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => `reply-idempotency-${++mockKey}` }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => mockUser, subscribeCacheUser: (fn: () => void) => { (mockListeners ??= new Set()).add(fn); return () => mockListeners.delete(fn); } }));
void [RN.Pressable, RN.TextInput, RN.Text, RN.View, RN.ScrollView, RN.StyleSheet, RN.ActivityIndicator, RN.Keyboard];
let root: Root, alert: jest.SpyInstance;
let role = 'editor', canReply = true, suggestionFailure = false, roleFailure = false;
let replyResults: unknown[] = [], messages: unknown[] = [];
const suggestion = { id: OTHER, status: 'pending', workflow_name: 'Welcome', keyword: 'hello', suggested_reply: 'Template reply' };
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    brandStore.set(null); mockUser = 'owner'; mockKey = 0; jest.clearAllMocks(); root = createRoot();
    role = 'editor'; canReply = true; suggestionFailure = false; roleFailure = false; replyResults = []; messages = [];
    alert = jest.spyOn(RN.Alert, 'alert').mockImplementation(() => {});
    mockRequest.mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/accounts')) { if (roleFailure) throw new ApiError(503, 'offline'); return { brandRole: role }; }
        if (url.endsWith('/suggestions')) { if (suggestionFailure) throw new ApiError(503, 'off'); return init?.method === 'PATCH' ? { suggestedReply: 'Template reply' } : { suggestions: [suggestion] }; }
        if (url.endsWith('/reply')) { const result = replyResults.shift(); if (result instanceof Error) throw result; return result; }
        return { thread: { id: ID, network: 'facebook', can_reply: canReply }, messages, notes: [] };
    });
});
afterEach(async () => { await act(async () => root.unmount()); alert.mockRestore(); brandStore.set(null); });
const render = async () => { await act(async () => root.render(createElement(InboxThread))); };
const sends = () => mockRequest.mock.calls.filter(([url]) => url.endsWith('/reply')).map(([, init]) => JSON.parse(init.body));
const locked = () => expect(field(root, t('publish.reply')).props.editable).toBe(false);
const confirm = async () => { const action = alert.mock.calls.at(-1)?.[2].find((b: { onPress?: () => void }) => b.onPress); expect(action).toBeDefined(); await act(async () => { action.onPress(); }); return action; };

test('notes validate and POST exactly one field', async () => {
    expect(cleanNote('  note ')).toBe('note'); expect(cleanNote(' ')).toBeNull(); expect(cleanNote('a'.repeat(2001))).toBeNull();
    await addNote(mockApi, ID, ' note '); expect(JSON.parse(mockRequest.mock.calls[0][1].body)).toEqual({ note: 'note' });
    expect(mockRequest.mock.calls[0][1].method).toBe('POST'); await expect(addNote(mockApi, 'bad', 'note')).rejects.toBeInstanceOf(ApiError);
});
test('suggestions require pending UUID rows and bounded plain text; PATCH is exactly two fields', async () => {
    const parsed = parseSuggestions({ suggestions: [{ ...suggestion, workflow_name: 'x'.repeat(90), keyword: 'x'.repeat(90), suggested_reply: '\u0000' + 'a'.repeat(9000) }, { ...suggestion, id: 'bad' }, { ...suggestion, status: 'used' }] });
    expect(parsed).toHaveLength(1); expect(parsed[0].text).toHaveLength(8000); expect(parsed[0].workflowName).toHaveLength(80); expect(parsed[0].keyword).toHaveLength(80);
    await fetchSuggestions(mockApi, ID); expect(mockRequest).toHaveBeenCalledWith(`/api/v1/social/inbox/${ID}/suggestions`);
    await decideSuggestion(mockApi, ID, OTHER, 'use'); expect(JSON.parse(mockRequest.mock.calls.at(-1)[1].body)).toEqual({ suggestionId: OTHER, action: 'use' });
});
test.each(['owner', 'manager', 'editor', 'reviewer', 'viewer', 'analyst'])('role %s sees only authorized note/suggestion controls', async r => {
    role = r; await render();
    expect(buttons(root, t('publishDepth.note.add')).length).toBe(['owner', 'manager', 'editor', 'reviewer'].includes(r) ? 1 : 0);
    for (const key of ['use', 'dismiss']) expect(buttons(root, t(`publishDepth.suggestions.${key}`)).length).toBe(['owner', 'manager', 'editor'].includes(r) ? 1 : 0);
    expect(textOf(root.container)).toContain('Template reply');
});
test('Use needs network capability; role lookup failure defaults to viewer', async () => {
    canReply = false; await render(); expect(buttons(root, t('publishDepth.suggestions.use'))).toHaveLength(0); expect(buttons(root, t('publishDepth.suggestions.dismiss'))).toHaveLength(1);
    await act(async () => root.unmount()); root = createRoot(); roleFailure = true; await render(); expect(buttons(root, t('publishDepth.note.add'))).toHaveLength(0); expect(buttons(root, t('publishDepth.suggestions.dismiss'))).toHaveLength(0);
});
test('Use fills draft without sending; Dismiss removes card', async () => {
    await render(); await press(root, t('publishDepth.suggestions.use')); expect(field(root, t('publish.reply')).props.value).toBe('Template reply'); expect(sends()).toHaveLength(0);
    expect(textOf(root.container)).not.toContain('Welcome');
});
test('any suggestions load failure renders nothing', async () => { suggestionFailure = true; await render(); expect(textOf(root.container)).not.toContain(t('publishDepth.suggestions.title')); });
test('note error keeps text and reloads exactly once without repeating the write', async () => {
    await render(); const original = mockRequest.getMockImplementation()!;
    mockRequest.mockImplementation((url, init) => init?.method === 'POST' && !url.endsWith('/reply') ? Promise.reject(new ApiError(0, 'network')) : original(url, init));
    mockRequest.mockClear(); await input(root, t('publishDepth.note.add'), 'Private note'); await press(root, t('publishDepth.note.add'));
    expect(field(root, t('publishDepth.note.add')).props.value).toBe('Private note');
    expect(mockRequest.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(mockRequest.mock.calls.filter(([url, init]) => url.endsWith(ID) && !init)).toHaveLength(1);
});
const sent = { message_id: ID, delivery_status: 'sent' };
const table: [unknown, string, string][] = [
    [{ status: 201 }, 'sent', 'sent'], [{ status: 200, body: sent }, 'sent', 'sent'], [sent, 'sent', 'sent'],
    ...['sending', 'failed'].map(status => [{ status: 200, body: { message_id: ID, delivery_status: status, idempotent: true } }, 'held', 'held'] as [unknown, string, string]),
    ...[new ApiError(502, 'provider_failed'), new ApiError(502, 'internal'), new ApiError(0, 'network'), new ApiError(409, 'reply_unavailable')].map(err => [err, 'held', 'held'] as [unknown, string, string]),
    ...[400, 402, 403, 404, 429, 503].map(status => [new ApiError(status, 'refused'), 'refusedFirst', 'held'] as [unknown, string, string]),
    [{}, 'held', 'held'], [{ status: 200, body: { delivery_status: 'sent', message_id: 'bad' } }, 'held', 'held'],
];
test.each(table)('reply outcome %j on first send and retry', (result, first, retry) => { expect(replyOutcome(result, true)).toBe(first); expect(replyOutcome(result, false)).toBe(retry); });
test('lost response, 429 and 503 retries keep the original body/key; old identical messages never prove delivery', async () => {
    replyResults = [new ApiError(0, 'network'), new ApiError(429, 'rate'), new ApiError(503, 'off'), sent];
    messages = [{ id: OTHER, direction: 'outbound', body: 'Hello', delivery_status: 'sent' }];
    await render(); expect(sends()).toHaveLength(0); await input(root, t('publish.reply'), 'Hello');
    for (let i = 0; i < 3; i++) {
        await press(root, t('publish.sendreply')); locked(); expect(sends()).toHaveLength(i + 1);
        expect(buttons(root, t('publishDepth.suggestions.use'))[0].props.accessibilityState.disabled).toBe(true);
    }
    expect(new Set(sends().map(s => s.idempotencyKey)).size).toBe(1); expect(sends().every(s => s.body === 'Hello')).toBe(true);
    await press(root, t('publish.sendreply')); expect(field(root, t('publish.reply')).props.value).toBe(''); expect(field(root, t('publish.reply')).props.editable).toBe(true);
});
test.each(['failed', 'sending', 'provider_failure'])('%s holds and never allocates a new key automatically', async status => {
    replyResults = [status === 'provider_failure' ? new ApiError(502, 'delivery_failed') : { idempotent: true, message_id: ID, delivery_status: status }];
    await render(); await input(root, t('publish.reply'), 'Hello'); await press(root, t('publish.sendreply')); locked(); expect(sends()).toHaveLength(1); expect(mockKey).toBe(1);
});
test.each([400, 429, 503])('first refusal %s unlocks and next tap gets a new key', async status => {
    replyResults = [new ApiError(status, 'refused'), sent]; await render(); await input(root, t('publish.reply'), 'Hello'); await press(root, t('publish.sendreply'));
    expect(field(root, t('publish.reply')).props.editable).toBe(true); await input(root, t('publish.reply'), 'Changed'); await press(root, t('publish.sendreply'));
    expect(sends()[1].idempotencyKey).not.toBe(sends()[0].idempotencyKey); expect(sends()[1].body).toBe('Changed');
});
test('Send anyway and Discard require confirmation; confirmed new send happens exactly once', async () => {
    replyResults = [new ApiError(0, 'network'), new ApiError(0, 'network')]; await render(); await input(root, t('publish.reply'), 'Hello'); await press(root, t('publish.sendreply'));
    await press(root, t('publishDepth.reply.anyway')); expect(sends()).toHaveLength(1); locked(); const action = await confirm();
    expect(sends()).toHaveLength(2); expect(sends()[1].idempotencyKey).not.toBe(sends()[0].idempotencyKey); await act(async () => action.onPress()); expect(sends()).toHaveLength(2);
    await press(root, t('publishDepth.reply.discard')); locked(); await confirm(); expect(field(root, t('publish.reply')).props.editable).toBe(true); expect(field(root, t('publish.reply')).props.value).toBe('Hello'); expect(sends()).toHaveLength(2);
});
test('a reply beyond display bound resolves only from server sent answer', async () => {
    const body = 'a'.repeat(3000); messages = [{ id: OTHER, direction: 'outbound', body, delivery_status: 'sent' }]; replyResults = [new ApiError(0, 'network'), sent];
    await render(); await input(root, t('publish.reply'), body); await press(root, t('publish.sendreply')); locked(); expect(sends()[0].body).toHaveLength(3000);
    await press(root, t('publish.sendreply')); expect(field(root, t('publish.reply')).props.value).toBe('');
});
test('in-flight reply and stale confirms are ignored after a brand change', async () => {
    const pending = deferred<unknown>(); replyResults = [pending.promise]; await render(); await input(root, t('publish.reply'), 'Old brand'); await press(root, t('publish.sendreply'));
    await act(async () => brandStore.set(OTHER)); await input(root, t('publish.reply'), 'New brand'); await act(async () => pending.resolve(sent));
    expect(field(root, t('publish.reply')).props.value).toBe('New brand');
});
test('late thread, role and suggestions responses cannot leak through A -> B -> A', async () => {
    const pending = deferred<unknown>(); const original = mockRequest.getMockImplementation()!;
    mockRequest.mockImplementation(() => pending.promise); await render();
    mockRequest.mockImplementation(original); await act(async () => { brandStore.set(OTHER); brandStore.set(null); });
    await act(async () => pending.resolve({ thread: { id: ID, participant_name: 'Old private name' }, brandRole: 'owner', suggestions: [{ ...suggestion, suggested_reply: 'Old private template' }] }));
    expect(textOf(root.container)).not.toContain('Old private');
});
test('analytics sanitizes numbers, passes days, and maps gated errors', async () => {
    const parsed = parseInboxAnalytics({ summary: { conversations: -1, received: NaN, sent: 4, failed: Infinity, read_actions: 2, median_response_seconds: -1 }, platforms: [{ network: 'facebook', received: 2, sent: -4, failed: Infinity }], trend: ['ignored'] });
    expect(parsed.summary).toEqual({ conversations: 0, received: 0, sent: 4, failed: 0, read_actions: 2, median_response_seconds: null });
    expect(parsed.platforms).toEqual([{ network: 'facebook', received: 2, sent: 0, failed: 0 }]);
    for (const days of [7, 30, 90] as const) { await fetchInboxAnalytics(mockApi, days); expect(mockRequest).toHaveBeenLastCalledWith(`/api/v1/social/inbox/analytics?days=${days}`); }
    expect(inboxAnalyticsErrorKey(new ApiError(402, 'plan'))).toBe('inbox.err.plan');
    for (const code of [403, 404, 503]) expect(inboxAnalyticsErrorKey(new ApiError(code, 'off'))).toBe('publishDepth.analytics.unavailable');
    expect(inboxAnalyticsErrorKey(new ApiError(429, 'rate'))).toBe('inbox.err.rate');
});
test('reply route still records before provider delivery and returns the pinned bodies', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../../app/api/v1/social/inbox/[threadId]/reply/route.js'), 'utf8');
    expect(source.indexOf("rpc('create_social_inbox_reply'")).toBeLessThan(source.indexOf('await sendInboxReply('));
    expect(source).toContain("delivery_status: 'sent' }, { status: 201"); expect(source).toContain('delivery_status: created.delivery_status, idempotent: true');
    expect(source).toContain("{ error: 'internal' }, { status: 502");
});

describe('inbox error messages', () => {
    const { ApiError } = jest.requireActual('../src/lib/api');
    const { inboxErrorKey, noteErrorKey } = jest.requireActual('../src/lib/publishInbox');
    test('only the note route turns a 400 into the note-length message', () => {
        const bad = new ApiError(400, 'invalid_body');
        expect(noteErrorKey(bad)).toBe('publishDepth.note.invalid');
        expect(inboxErrorKey(bad)).not.toBe('publishDepth.note.invalid');
        expect(noteErrorKey(new ApiError(429, 'rate_limited'))).toBe(inboxErrorKey(new ApiError(429, 'rate_limited')));
    });
});
