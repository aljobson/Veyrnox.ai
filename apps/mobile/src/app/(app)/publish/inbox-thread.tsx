import { Text as StatusText } from '../../../components/ui/Text';
import * as Crypto from 'expo-crypto';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { touchTarget } from '../../../lib/a11y';
import { formatLocale, t } from '../../../lib/i18n';
import { addNote, assignThread, cleanNote, cleanReply, fetchMembers, fetchSuggestions, fetchThread, inboxErrorKey, inboxScope, noteErrorKey, parseThreadView, replyOutcome, replyToThread, setThreadStatus, type Member, type Suggestion } from '../../../lib/publishInbox';
import { usePublishApi } from '../../../lib/usePublishApi';
import { InboxTriage } from '../../../components/publish/InboxTriage';
import { NetworkLogo } from '../../../components/publish/NetworkLogo';
import { networkName } from '../../../lib/networkLogos';
import { markThreadRead, setThreadPriority, setThreadTags } from '../../../lib/publishInboxList';
import { InboxSuggestions } from '../../../components/publish/InboxSuggestions';
import { subscribeCacheUser } from '../../../lib/appCache';
import { brandStore, type BrandRole } from '../../../lib/publishBrand';
import { fetchAccounts } from '../../../lib/publish';
import { networkLabel } from '../../../lib/publishCompose';
import { colors, LIST_END_PADDING } from '../../../theme';

type Attempt = { threadId: string; body: string; key: string; mayBeSent: boolean };

export default function InboxThread() {
    const api = usePublishApi();
    const { id } = useLocalSearchParams<{ id?: string }>();
    const [view, setView] = useState<ReturnType<typeof parseThreadView> | null>(null);
    const [error, setError] = useState<string | null>(null);

    const [keyboard, setKeyboard] = useState(0);
    const [draft, setDraft] = useState('');
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<string | null>(null);
    const [members, setMembers] = useState<Member[] | null>(null);
    const [picking, setPicking] = useState(false);
    const [attempt, setAttempt] = useState<Attempt | null>(null);
    const attemptRef = useRef<Attempt | null>(null), running = useRef(false);
    const [role, setRole] = useState<BrandRole | null>(null);
    const triage = role !== null && ['owner', 'manager', 'editor', 'reviewer'].includes(role);
    const reply = role !== null && ['owner', 'manager', 'editor'].includes(role);
    const readOnce = useRef<string | null>(null);
    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
    const [noteDraft, setNoteDraft] = useState('');
    const [scopeVersion, setScopeVersion] = useState(0);
    const generation = useRef(0), currentApi = useRef(api);
    currentApi.current = api;
    function guard() {
        const scope = inboxScope(), version = generation.current;
        return () => currentApi.current === api && scope === inboxScope() && version === generation.current;
    }
    const updateAttempt = (next: Attempt | null) => { attemptRef.current = next; setAttempt(next); };
    useEffect(() => {
        const reset = () => {
            generation.current++; running.current = false; updateAttempt(null);
            setView(null); setRole(null); setSuggestions([]); setDraft(''); setNoteDraft(''); setNote(null); setError(null); setBusy(false); setMembers(null); setPicking(false);
            setScopeVersion(v => v + 1);
        };
        const userOff = subscribeCacheUser(reset), brandOff = brandStore.subscribe(reset);
        return () => { generation.current++; userOff(); brandOff(); };
    }, []);

    // The reply box rides above the keyboard (the screen sits under a navigation header, so the built-in avoiding is unreliable).
    useEffect(() => {
        const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) => setKeyboard(e.endCoordinates.height));
        const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboard(0));
        return () => { show.remove(); hide.remove(); };
    }, []);

    const load = useCallback(async () => {
        const token = inboxScope(), version = generation.current;
        const next = await fetchThread(api, String(id ?? ''));
        if (currentApi.current === api && token === inboxScope() && version === generation.current) setView(next);
    }, [api, id]);

    useEffect(() => {
        const version = ++generation.current, token = inboxScope();
        const valid = () => version === generation.current && token === inboxScope() && currentApi.current === api;
        setView(null); setError(null); setRole(null); setSuggestions([]); setMembers(null); setPicking(false);
        setDraft(''); setNoteDraft(''); setNote(null); updateAttempt(null); running.current = false; setBusy(false);
        fetchThread(api, String(id ?? '')).then(v => { if (valid()) setView(v); }).catch(err => { if (valid()) setError(t(inboxErrorKey(err))); });
        fetchAccounts(api).then(a => { if (valid()) setRole(a.brandRole); }).catch(() => { if (valid()) setRole('viewer'); });
        fetchSuggestions(api, String(id ?? '')).then(rows => { if (valid()) setSuggestions(rows); }).catch(() => { if (valid()) setSuggestions([]); });
        return () => { generation.current++; };
    }, [api, id, scopeVersion]);

    useEffect(() => {
        const key = JSON.stringify([id, inboxScope(), generation.current]);
        if (triage && view?.thread && view.thread.unread > 0 && readOnce.current !== key) {
            readOnce.current = key;
            void markThreadRead(api, view.thread.id).catch(() => {});
        }
    }, [api, id, triage, view]);

    async function act(run: () => Promise<unknown>) {
        if (running.current || !triage) return;
        const valid = guard();
        running.current = true; setBusy(true); setNote(null);
        try { await run(); if (valid()) await load(); }
        catch (err) { if (valid()) setNote(t(inboxErrorKey(err))); }
        finally { if (valid()) { running.current = false; setBusy(false); } }
    }

    async function send(newKey = false) {
        if (running.current || !reply || !view?.canReply) return;
        const previous = attemptRef.current;
        const body = previous?.body ?? cleanReply(draft);
        if (!body) return setNote(t('publish.writeareplyofupto8000'));
        const next: Attempt = previous && !newKey ? previous : { threadId: String(id), body, key: Crypto.randomUUID(), mayBeSent: false };
        const valid = guard();
        updateAttempt(next); running.current = true; setBusy(true); setNote(null);
        let result: unknown;
        try { result = await replyToThread(api, next.threadId, next.body, next.key); }
        catch (err) { result = err; }
        if (!valid()) return;
        const outcome = replyOutcome(result, !next.mayBeSent);
        if (outcome === 'sent') { updateAttempt(null); setDraft(''); }
        else if (outcome === 'refusedFirst' && !next.mayBeSent) { updateAttempt(null); setNote(t(inboxErrorKey(result))); }
        else { updateAttempt({ ...next, mayBeSent: true }); setNote(t(inboxErrorKey(result))); }
        // Reload for display only. Neither old text nor delivery rows resolve an attempt.
        try { if (valid()) await load(); } catch { /* The attempt result above stays authoritative. */ }
        if (valid()) { running.current = false; setBusy(false); }
    }

    function confirmHeld(action: 'anyway' | 'discard') {
        if (running.current || !reply || !attemptRef.current?.mayBeSent) return;
        const valid = guard(), captured = attemptRef.current;
        let used = false;
        Alert.alert(t(`publishDepth.reply.${action}Title`), t(`publishDepth.reply.${action}Body`), [
            { text: t('publish.cancel'), style: 'cancel' },
            { text: t(`publishDepth.reply.${action}`), style: 'destructive', onPress: () => {
                if (used || !valid() || running.current || attemptRef.current !== captured) return;
                used = true;
                if (action === 'anyway') void send(true);
                else { updateAttempt(null); setNote(null); }
            } },
        ]);
    }

    async function saveNote() {
        if (running.current || !triage) return;
        const value = cleanNote(noteDraft);
        if (!value) return setNote(t('publishDepth.note.invalid'));
        const valid = guard();
        running.current = true; setBusy(true); setNote(null);
        try { await addNote(api, String(id), value); if (valid()) setNoteDraft(''); }
        catch (err) { if (valid()) setNote(t(noteErrorKey(err))); }
        // Once on both success and error: no retry of a non-idempotent write.
        try { if (valid()) await load(); } catch (err) { if (valid()) setNote(t(inboxErrorKey(err))); }
        if (valid()) { running.current = false; setBusy(false); }
    }

    async function openAssign() {
        if (!triage) return;
        setPicking(on => !on);
        if (members) return;
        const valid = guard();
        try { const next = await fetchMembers(api); if (valid()) setMembers(next); }
        catch (err) { if (valid()) setNote(t(inboxErrorKey(err))); }
    }

    if (error) return <View style={styles.pad}><Stack.Screen options={{ title: t('inbox.title') }} /><StatusText variant="inherit" style={styles.error} accessibilityRole="alert">{error}</StatusText></View>;
    if (!view) return <View style={styles.pad}><ActivityIndicator color={colors.accent} /></View>;
    const th = view.thread;

    const resolved = th?.status === 'resolved';

    return (
        <View style={styles.screen} accessibilityState={{ busy }}>
        <ScrollView style={styles.screen} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Stack.Screen options={{ title: th?.name || t('inbox.title') }} />
            {th ? <View style={styles.actions}><NetworkLogo network={th.network} size={20} /><Text style={styles.muted}>{t('publishOps.inbox.meta', { network: networkName(th.network), account: th.accountName, kind: t(`inbox.kind.${th.kind}`) })}</Text><Text style={styles.muted}>{t(`publishOps.priority.${th.priority}`)}</Text></View> : null}
            {th && triage ? (
                <View style={styles.actions}>
                    <Pressable accessibilityRole="button" disabled={busy} style={touchTarget} onPress={() => act(() => setThreadStatus(api, String(id), resolved ? 'reopen' : 'resolve'))}>
                        <Text style={styles.action}>{resolved ? t('publish.reopen') : t('publish.resolve')}</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" disabled={busy} style={touchTarget} onPress={openAssign}>
                        <Text style={styles.action}>{th.assignedEmail ? t('publish.assigned', { value1: th.assignedEmail }) : t('publish.assign')}</Text>
                    </Pressable>
                </View>
            ) : null}
            {triage && picking ? (
                <View style={styles.picker}>
                    {members === null ? <ActivityIndicator color={colors.accent} /> : null}
                    {members?.map((m) => (
                        <Pressable key={m.userId} accessibilityRole="button" disabled={busy} style={[styles.member, touchTarget]} onPress={() => { setPicking(false); void act(() => assignThread(api, String(id), m.userId)); }}>
                            <Text style={styles.text}>{m.email}</Text>
                        </Pressable>
                    ))}
                    {th?.assignedEmail ? (
                        <Pressable accessibilityRole="button" disabled={busy} style={[styles.member, touchTarget]} onPress={() => { setPicking(false); void act(() => assignThread(api, String(id), null)); }}>
                            <Text style={styles.muted}>{t('publish.unassign')}</Text>
                        </Pressable>
                    ) : null}
                </View>
            ) : null}
            {note ? <StatusText variant="inherit" style={styles.error} accessibilityRole="alert">{note}</StatusText> : null}
            {th && triage ? <InboxTriage key={`${id}:${scopeVersion}`} priority={th.priority} tags={th.tags} busy={busy} onPriority={p => void act(() => setThreadPriority(api, String(id), p))} onTags={tags => void act(() => setThreadTags(api, String(id), tags))} /> : null}
            {th?.tags.length ? <Text style={styles.tags}>{th.tags.join(', ')}</Text> : null}
            {view.messages.length === 0 ? <Text style={styles.muted}>{t('inbox.noMessages')}</Text> : null}
            {view.messages.map((m) => (
                <View key={m.id} style={[styles.bubble, m.outgoing ? styles.out : styles.in]} accessible accessibilityLabel={`${m.outgoing ? t('inbox.you') : th?.name ?? ''}: ${m.body}`}>
                    <Text style={styles.text}>{m.body || (m.hasMedia ? t('inbox.attachment') : '')}</Text>
                    {m.body && m.hasMedia ? <Text style={styles.muted}>{t('inbox.attachment')}</Text> : null}
                    <Text style={styles.meta}>{m.sentAt ? new Date(m.sentAt).toLocaleString(formatLocale()) : ''}{m.deliveryStatus && m.outgoing ? ` · ${m.deliveryStatus}` : ''}</Text>
                </View>
            ))}
            <InboxSuggestions api={api} threadId={String(id)} rows={suggestions} role={role ?? 'viewer'} canReply={view.canReply} pendingReply={busy || !!attempt?.mayBeSent}
                onUse={value => { if (!running.current && !attemptRef.current?.mayBeSent) setDraft(value); }} onRemove={suggestionId => setSuggestions(rows => rows.filter(row => row.id !== suggestionId))} />
            <Text style={styles.heading} accessibilityRole="header">{t('inbox.notes')}</Text>
            {triage ? <View>
                <Text style={styles.text}>{t('publishDepth.note.add')}</Text>
                <TextInput style={[styles.input, touchTarget]} accessibilityLabel={t('publishDepth.note.add')} multiline maxLength={2000} value={noteDraft} onChangeText={setNoteDraft} editable={!busy} />
                <Pressable style={touchTarget} accessibilityRole="button" disabled={busy || !noteDraft.trim()} accessibilityState={{ busy, disabled: busy || !noteDraft.trim() }} onPress={saveNote}><Text style={styles.action}>{t('publishDepth.note.add')}</Text></Pressable>
            </View> : null}
            {view.notes.map((n) => (
                <View key={n.id} style={styles.note}>
                    <Text style={styles.text}>{n.body}</Text>
                    <Text style={styles.meta}>{n.author}{n.createdAt ? ` · ${new Date(n.createdAt).toLocaleString(formatLocale())}` : ''}</Text>
                </View>
            ))}
            {role !== null && !(reply && view.canReply) ? <Text style={styles.muted}>{t(reply ? 'publishOps.inbox.readOnlyConnection' : triage ? 'publishOps.inbox.triageRole' : 'publishOps.inbox.readOnlyRole')}</Text> : null}
        </ScrollView>
        {reply && attempt?.mayBeSent ? <View style={styles.held}>
            <StatusText variant="inherit" style={styles.muted} accessibilityLiveRegion="polite">{t('publishDepth.reply.pending', { network: networkLabel(th?.network ?? '') })}</StatusText>
            <View style={styles.actions}>{(['anyway', 'discard'] as const).map(action => <Pressable key={action} style={touchTarget} accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} onPress={() => confirmHeld(action)}><Text style={styles.action}>{t(`publishDepth.reply.${action}`)}</Text></Pressable>)}</View>
        </View> : null}
        {reply && view.canReply ? (
            <View style={[styles.composer, keyboard > 0 && { marginBottom: keyboard, paddingBottom: 12 }]}>
                <View style={{ flex: 1 }}><TextInput style={styles.input} value={draft} onChangeText={setDraft} placeholder={t('publish.reply')} accessibilityLabel={t('publish.reply')} placeholderTextColor={colors.muted} multiline maxLength={8000} editable={!busy && !attempt?.mayBeSent} /><Text style={styles.meta}>{t('compose.networkTextCount', { count: draft.length, limit: 8000 })}</Text></View>
                <Pressable accessibilityRole="button" accessibilityLabel={t('publish.sendreply')} disabled={busy || !draft.trim()} style={[styles.send, (busy || !draft.trim()) && styles.off]} accessibilityState={{ busy, disabled: busy || !draft.trim() }} onPress={() => send()}>
                    <Text style={styles.sendText}>{busy ? '…' : t('publish.send')}</Text>
                </Pressable>
            </View>
        ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    held: { paddingHorizontal: 12, gap: 6 },
    screen: { flex: 1, backgroundColor: colors.background },
    pad: { flex: 1, backgroundColor: colors.background, padding: 16 },
    body: { padding: 16, paddingBottom: LIST_END_PADDING, gap: 8 },
    heading: { color: colors.muted, fontSize: 13, textTransform: 'uppercase', marginTop: 12 },
    bubble: { borderRadius: 12, padding: 12, gap: 4, maxWidth: '88%' },
    in: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, alignSelf: 'flex-start' },
    out: { backgroundColor: colors.surface, borderColor: colors.accent, borderWidth: 1, alignSelf: 'flex-end' },
    note: { backgroundColor: colors.surface, borderRadius: 12, padding: 12, gap: 4, borderColor: colors.border, borderWidth: 1 },
    text: { color: colors.text, fontSize: 15 },
    muted: { color: colors.muted, fontSize: 13 },
    meta: { color: colors.muted, fontSize: 12 },
    tags: { color: colors.accent, fontSize: 13 },
    error: { color: colors.danger },
    actions: { flexDirection: 'row', gap: 20, flexWrap: 'wrap' },
    action: { color: colors.accent, fontSize: 16 },
    picker: { backgroundColor: colors.surface, borderRadius: 12, borderColor: colors.border, borderWidth: 1, paddingHorizontal: 12 },
    member: { justifyContent: 'center' },
    composer: { flexDirection: 'row', gap: 8, padding: 12, paddingBottom: LIST_END_PADDING / 2, borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
    input: { flex: 1, color: colors.text, backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, maxHeight: 120 },
    send: { backgroundColor: colors.accent, borderRadius: 12, paddingHorizontal: 16, minHeight: 44, justifyContent: 'center' },
    sendText: { color: colors.accentInk, fontWeight: '600' },
    off: { opacity: 0.4 },
});
