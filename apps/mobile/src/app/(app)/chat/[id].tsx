import * as Crypto from 'expo-crypto';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, AppState, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../../auth/AuthProvider';
import { ChatComposerDeck } from '../../../components/chat/ChatComposerDeck';
import { DraftCards } from '../../../components/chat/DraftCards';
import { ChatSettings } from '../../../components/chat/ChatSettings';
import { ModelPicker } from '../../../components/chat/ModelPicker';
import { MakePanel } from '../../../components/chat/MakePanel';
import { LibraryImagePicker } from '../../../components/chat/LibraryImagePicker';
import { ApiError } from '../../../lib/api';
import { MIN_TARGET } from '../../../lib/a11y';
import { chatApi, cleanOptions, cleanTitle, imagesExtra, isModelSwitch, NO_OPTIONS, replyPrice, sendKeyFor, type ChatMessage, type ChatModel, type PendingSend, type ReplyOptions } from '../../../lib/chat';
import { attachmentRefs, MAX_ATTACHMENTS, roomFor, type ChatImage } from '../../../lib/chatAttach';
import { pickPhotos, uploadChatImages } from '../../../lib/chatPhotos';
import { fetchCatalog, type CatalogModel, type Kind } from '../../../lib/media';
import { parseStudioDrafts, SKILL_GROUPS, SKILLS, skillInstructions, withoutDrafts, type Skill } from '../../../lib/studioSkills';
import { isQuiet, makeSendKey, resolveResumedSend, resolveStoppedSend, RESUME_QUIET_MS, resumeNoticeKey, stopNoticeKey, type StopOutcome } from '../../../lib/chatStop';
import { plural, t } from '../../../lib/i18n';
import { ensureOnline, OFFLINE_PAID_MESSAGE, OfflineError } from '../../../lib/network';
import { colors, fonts, radius } from '../../../theme';

const ERROR_TEXT: Record<string, string> = {
    insufficient_credits: 'Not enough credits for this reply.',
    rate_limited: 'Too many messages. Wait a moment.',
    option_unavailable: 'That choice is not available for this model.',
    chat_not_open: 'Chat is not available right now.',
    consent_declined: 'You need to agree to AI sharing to chat.',
};

export default function Conversation() {
    const { id, starter } = useLocalSearchParams<{ id: string; starter?: string }>();
    const { api } = useAuth();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const [title, setTitle] = useState('Chat');
    const [pinned, setPinned] = useState(false);
    const [renaming, setRenaming] = useState<string | null>(null);
    const [messages, setMessages] = useState<ChatMessage[] | null>(null);
    const [draft, setDraft] = useState('');
    const [sending, setSending] = useState(false);
    const [stopping, setStopping] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    // Kept only while a send is unsettled, so a retry of the same message with the same choices is charged once.
    const pendingKey = useRef<PendingSend | null>(null);
    const [model, setModel] = useState<ChatModel | null>(null);
    const [options, setOptions] = useState<ReplyOptions>(NO_OPTIONS);
    const [images, setImages] = useState<ChatImage[]>([]);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [pickerModelsOpen, setPickerModelsOpen] = useState(false);
    const [allModels, setAllModels] = useState<ChatModel[]>([]);
    const [thread, setThread] = useState<{ model_id: string; system_prompt: string | null } | null>(null);
    const [makeOpen, setMakeOpen] = useState(false);
    const [makeKind, setMakeKind] = useState<Kind>('image');
    const [maxImages, setMaxImages] = useState(MAX_ATTACHMENTS);
    const [catalog, setCatalog] = useState<CatalogModel[] | null>(null);
    const [skillNote, setSkillNote] = useState<string | null>(null);
    const abort = useRef<AbortController | null>(null);
    // The send in flight, for the return from the background (ADR-0181): when the app comes back and the reply has gone quiet,
    // the turn is looked for by its job, because the server finishes it either way.
    const live = useRef<{ key: string; text: string; knownIds: ReadonlySet<string>; jobId: string | null; lastEventAt: number } | null>(null);
    const resumed = useRef<StopOutcome | null>(null);
    const busy = useRef(false); // synchronous: a second tap must not start a second turn

    // A starter card is only instructions copied onto this chat; it costs nothing until a reply is sent.
    async function applyStarter(skill: Skill) {
        try {
            const list = catalog ?? (await fetchCatalog().catch(() => []));
            await chatApi(api).updateThread(id, { system_prompt: skillInstructions(skill, list) });
            setThread((th) => (th ? { ...th, system_prompt: skillInstructions(skill, list) } : th));
            setSkillNote(skill.name);
            setDraft((d) => d || '');
        } catch {
            setError(t('chat.skills.failed'));
        }
    }

    useEffect(() => {
        chatApi(api)
            .getThread(id)
            .then(async (r) => {
                setTitle(r.thread.title || 'Chat');
                setPinned(r.thread.pinned);
                setMessages(r.messages);
                // The price is shown before sending, so the model list is read; if it fails the chat still opens and
                // sending is held back until the price is known.
                const listed = await chatApi(api).listModelsWithLimits().catch(() => null);
                setModel(listed?.models.find((m) => m.id === r.thread.model_id) ?? null);
                setAllModels(listed?.models ?? []);
                setThread({ model_id: r.thread.model_id, system_prompt: r.thread.system_prompt ?? null });
                if (listed?.max_attachments) setMaxImages(Math.min(MAX_ATTACHMENTS, listed.max_attachments));
            })
            .catch(() => setError('Could not load this chat.'));
        return () => abort.current?.abort();
    }, [api, id]);

    // Studio draft blocks in a reply become Open in Create cards, priced from the live catalog.
    const hasDrafts = (messages ?? []).some((m) => m.role === 'assistant' && m.content.includes('```studio'));
    useEffect(() => {
        if (hasDrafts && !catalog) fetchCatalog().then(setCatalog, () => undefined);
    }, [hasDrafts, catalog]);
    const draftsOf = useMemo(() => (content: string) => (catalog ? parseStudioDrafts(content, catalog) : []), [catalog]);

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const sub = AppState.addEventListener('change', (state) => {
            if (state !== 'active' || !busy.current || !live.current) return;
            clearTimeout(timer);
            timer = setTimeout(async () => {
                const l = live.current;
                if (!l || !busy.current || !isQuiet(l.lastEventAt, Date.now())) return;
                const outcome = await resolveResumedSend(
                    { closeSend: chatApi(api).closeSend, getThread: () => chatApi(api).getThread(id), getJob: chatApi(api).getJob },
                    { key: l.key, jobId: l.jobId, text: l.text, knownIds: l.knownIds },
                );
                // Still running: the stream stays the authority. Settled: let go of the stream and show what the server kept.
                if (outcome === 'pending' || live.current !== l) return;
                resumed.current = outcome;
                abort.current?.abort();
            }, RESUME_QUIET_MS);
        });
        return () => {
            clearTimeout(timer);
            sub.remove();
        };
    }, [api, id]);

    const send = useCallback(
        async (again?: string) => {
            const text = (again ?? draft).trim();
            if (!text || busy.current || !messages || !model) return;
            const chosen = cleanOptions(model, options);
            setError(null);
            setNotice(null);
            try {
                await ensureOnline();
            } catch (err) {
                if (err instanceof OfflineError) return setError(OFFLINE_PAID_MESSAGE);
                throw err;
            }
            const attached = model && imagesExtra(model) !== null ? images : [];
            const pending = sendKeyFor(pendingKey.current, text, chosen, () => makeSendKey(Crypto.randomUUID()), attached.map((i) => i.id).join(','));
            pendingKey.current = pending;
            busy.current = true;
            setSending(true);
            // Images from the phone go to storage first: a failed upload costs nothing and sends nothing.
            let refs: ReturnType<typeof attachmentRefs> = [];
            try {
                const keys = await uploadChatImages(api, attached.filter((i) => i.uri), new AbortController().signal);
                refs = attachmentRefs(keys, attached.filter((i) => i.assetId).map((i) => i.assetId as string));
            } catch {
                setError(t('chat.attach.uploadFailed'));
                pendingKey.current = null;
                setSending(false);
                busy.current = false;
                return;
            }
            if (again === undefined) setDraft('');
            const knownIds = new Set(messages.map((m) => m.id));
            const stamp = Date.now();
            setMessages((m) => [...(m ?? []), { id: `u${stamp}`, role: 'user', content: text }, { id: `a${stamp}`, role: 'assistant', content: '' }]);
            const controller = new AbortController();
            abort.current = controller;
            resumed.current = null;
            live.current = { key: pending.key, text, knownIds, jobId: null, lastEventAt: Date.now() };
            let failed: string | null = null;
            let unanswered = false;
            let jobId: string | null = null;
            try {
                const result = await chatApi(api).sendMessage(
                    id,
                    text,
                    pending.key,
                    (e) => {
                        if (live.current) live.current.lastEventAt = Date.now();
                        if (e.type === 'start') {
                            jobId = e.jobId;
                            if (live.current) live.current.jobId = e.jobId;
                        }
                        else if (e.type === 'delta') setMessages((m) => (m ?? []).map((x) => (x.id === `a${stamp}` ? { ...x, content: x.content + e.text } : x)));
                        else if (e.type === 'error') failed = e.error;
                    },
                    controller.signal,
                    chosen,
                    refs,
                );
                // A replay says a job exists for this key, not how it ended: it is looked for like a cut-off send.
                if (result.replay) {
                    unanswered = true;
                    jobId = result.job;
                }
            } catch (err) {
                // A refusal from the server made no reply. Anything else (Stop, a dropped connection, no answer) may have
                // reached the server, which charges what it produced, so the send is looked for before it is called free.
                if (controller.signal.aborted || !(err instanceof ApiError && err.status > 0)) unanswered = true;
                else failed = err.code;
            }
            const giveBack = () => {
                setMessages((m) => (m ?? []).filter((x) => x.id !== `a${stamp}` && x.id !== `u${stamp}`));
                if (again === undefined) setDraft(text);
            };
            if (unanswered) {
                setStopping(true);
                const wasResumed = resumed.current !== null;
                const outcome =
                    resumed.current ??
                    (await resolveStoppedSend(
                        { closeSend: chatApi(api).closeSend, getThread: () => chatApi(api).getThread(id), getJob: chatApi(api).getJob },
                        { key: pending.key, jobId, text, knownIds },
                    ));
                resumed.current = null;
                if (outcome === 'saved' || outcome === 'unsaved') {
                    const r = await chatApi(api).getThread(id).catch(() => null);
                    if (r) setMessages(r.messages);
                    setImages([]);
                } else if (outcome === 'nothing') {
                    giveBack();
                } else {
                    // Not settled: what arrived stays on screen; with nothing on screen the message goes back.
                    setMessages((m) => (m ?? []).filter((x) => x.id !== `a${stamp}` || x.content.length > 0));
                }
                // Only an unsettled send keeps its key, so retrying it cannot be charged twice. A closed key can never send again.
                if (outcome !== 'pending') pendingKey.current = null;
                setNotice(t(wasResumed ? resumeNoticeKey(outcome) : outcome === 'nothing' && !controller.signal.aborted ? 'chat.lost.nothing' : stopNoticeKey(outcome)));
                setStopping(false);
            } else if (failed) {
                setError(ERROR_TEXT[failed] ?? 'The reply did not complete. You were not charged for a failed reply.');
                setMessages((m) => (m ?? []).filter((x) => x.id !== `a${stamp}` || x.content.length > 0));
                if (again === undefined) setDraft(text);
                pendingKey.current = null;
            } else {
                pendingKey.current = null;
                setImages([]);
                // The saved reply carries its real price.
                const r = await chatApi(api).getThread(id).catch(() => null);
                if (r) setMessages(r.messages);
            }
            live.current = null;
            setSending(false);
            busy.current = false;
        },
        [api, draft, id, images, messages, model, options],
    );

    // Switching the model changes what the next reply costs; the choices the new model does not offer are dropped.
    async function saveSettings(patch: { model_id?: string; system_prompt?: string }) {
        const updated = await chatApi(api).updateThread(id, patch);
        const model_id = updated.model_id ?? patch.model_id ?? thread?.model_id ?? '';
        setThread({ model_id, system_prompt: updated.system_prompt ?? patch.system_prompt ?? thread?.system_prompt ?? null });
        const next = allModels.find((m) => m.id === model_id);
        if (next) {
            setModel(next);
            setOptions((o) => cleanOptions(next, o));
        }
    }

    // Two taps from the chat: the model name, then a model. A same-model tap just closes; a failed save keeps the old model.
    async function pickModel(modelId: string) {
        setPickerModelsOpen(false);
        if (!thread || !isModelSwitch(thread.model_id, modelId, allModels)) return;
        try {
            await saveSettings({ model_id: modelId });
            setError(null);
        } catch {
            setError(t('chat.model.failed'));
        }
    }

    async function togglePin() {
        const next = !pinned;
        setPinned(next);
        try {
            await chatApi(api).updateThread(id, { pinned: next });
        } catch {
            setPinned(!next);
            setError(t('chat.updateFailed'));
        }
    }

    async function saveRename() {
        const name = cleanTitle(renaming ?? '');
        if (!name) return setError(t('chat.renameInvalid'));
        try {
            const thread = await chatApi(api).updateThread(id, { title: name });
            setTitle(thread.title || name);
            setRenaming(null);
            setError(null);
        } catch {
            setError(t('chat.updateFailed'));
        }
    }

    function openMake(kind: Kind) {
        setMakeKind(kind);
        setMakeOpen(true);
    }

    // The web keeps thread management in the chat rail. On a phone the rail is the previous screen, so these less-frequent
    // actions live behind one compact menu instead of taking a full row above every conversation.
    function showManage() {
        const rename = () => setRenaming(title === 'Chat' ? '' : title);
        const move = () => router.push({ pathname: '/chat/move', params: { threadId: String(id) } });
        if (Platform.OS === 'ios') {
            ActionSheetIOS.showActionSheetWithOptions(
                { options: [pinned ? t('chat.unpin') : t('chat.pin'), t('chat.rename'), t('chat.workspace.folder'), t('chat.renameCancel')], cancelButtonIndex: 3 },
                (index) => {
                    if (index === 0) void togglePin();
                    else if (index === 1) rename();
                    else if (index === 2) move();
                },
            );
            return;
        }
        Alert.alert(t('chat.workspace.manage'), undefined, [
            { text: pinned ? t('chat.unpin') : t('chat.pin'), onPress: () => void togglePin() },
            { text: t('chat.rename'), onPress: rename },
            { text: t('chat.workspace.folder'), onPress: move },
            { text: t('chat.renameCancel'), style: 'cancel' },
        ]);
    }

    const imageExtra = model ? imagesExtra(model) : null;
    const price = model ? replyPrice(model, options, imageExtra !== null ? images.length : 0) : null;
    async function addPhotos() {
        const r = await pickPhotos(roomFor(images.length, maxImages)).catch(() => ({ images: [] as ChatImage[], problem: 'failed' as const }));
        if (r.images.length) setImages((cur) => [...cur, ...r.images]);
        if (r.problem === 'resize_unavailable') setNotice(t('chat.attach.needsUpdate'));
    }
    const canSend = !sending && !!draft.trim() && price !== null;
    const last = messages && messages.length >= 2 ? messages[messages.length - 1] : null;
    const lastUser = last?.role === 'assistant' && last.content ? messages![messages!.length - 2] : null;

    return (
        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={88}>
            <Stack.Screen options={{ title: 'LLM Chat' }} />
            <View style={styles.conversationBar}>
                <Pressable accessibilityRole="button" accessibilityLabel="Open chats" style={styles.headerControl} onPress={() => router.push('/chat/library')}>
                    <Text style={styles.headerControlText}>Chats</Text>
                </Pressable>
                <View style={styles.conversationTitle}>
                    <Text numberOfLines={1} style={styles.threadTitle}>{title}</Text>
                    {model ? <Text numberOfLines={1} style={styles.modelMeta}>{model.name} · {plural('chat.perReply', model.credits_per_reply)}</Text> : null}
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel={t('chat.settings.open')} disabled={!thread || sending} style={styles.headerControl} onPress={() => setSettingsOpen(true)}>
                    <Text style={styles.headerControlText}>{t('chat.settings.open')}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={t('chat.workspace.manage')} style={styles.moreControl} onPress={showManage}>
                    <Text style={styles.moreText}>•••</Text>
                </Pressable>
            </View>
            {renaming !== null ? (
                <View style={styles.renameBar}>
                    <TextInput style={styles.renameInput} value={renaming} onChangeText={setRenaming} placeholder={t('chat.renamePlaceholder')} accessibilityLabel={t('chat.rename')} placeholderTextColor={colors.muted} maxLength={120} autoFocus />
                    <Pressable accessibilityRole="button" style={styles.headerControl} onPress={() => void saveRename()}><Text style={styles.headerControlText}>{t('chat.renameSave')}</Text></Pressable>
                    <Pressable accessibilityRole="button" style={styles.headerControl} onPress={() => setRenaming(null)}><Text style={styles.headerControlText}>{t('chat.renameCancel')}</Text></Pressable>
                </View>
            ) : null}
            {messages === null && !error ? (
                <ActivityIndicator color={colors.accent} style={styles.center} />
            ) : (
                <FlatList
                    style={styles.messageList}
                    data={messages ?? []}
                    keyExtractor={(m) => m.id}
                    contentContainerStyle={[styles.list, (messages?.length ?? 0) === 0 && styles.emptyList]}
                    keyboardShouldPersistTaps="handled"
                    ListEmptyComponent={
                        <View style={styles.empty}>
                            <Text style={styles.hero}>{t('chat.workspace.title')}</Text>
                            <Text style={styles.heroHelp}>{t('chat.workspace.priceHelp')}</Text>
                            <View style={styles.skillsBlock}>
                                <Text style={styles.eyebrow}>{t('chat.workspace.skillsEyebrow')}</Text>
                                <Text style={styles.skillsHelp}>{t('chat.workspace.skillsHelp')}</Text>
                                {SKILL_GROUPS.filter((group) => group !== 'Film').map((group) => (
                                    <View key={group} style={styles.skillGroup}>
                                        <Text style={styles.skillGroupLabel}>{group}</Text>
                                        <View style={styles.skillGrid}>
                                            {SKILLS.filter((skill) => skill.group === group).map((skill) => {
                                                const selected = skillNote === skill.name;
                                                return (
                                                    <Pressable
                                                        key={skill.id}
                                                        accessibilityRole="button"
                                                        accessibilityLabel={`${skill.name}. ${skill.blurb}`}
                                                        accessibilityState={{ selected }}
                                                        style={[styles.starter, selected && styles.starterOn]}
                                                        onPress={() => void applyStarter(skill)}
                                                    >
                                                        <Text style={styles.starterName}>{skill.name}</Text>
                                                        <Text style={styles.starterBlurb}>{skill.blurb}</Text>
                                                    </Pressable>
                                                );
                                            })}
                                        </View>
                                    </View>
                                ))}
                                <Pressable accessibilityRole="button" style={styles.filmLink} onPress={() => router.push('/film')}>
                                    <Text style={styles.filmLinkText}>Open Film Studio →</Text>
                                </Pressable>
                            </View>
                        </View>
                    }
                    ListFooterComponent={
                        lastUser && !sending && model && price !== null ? (
                            <Pressable accessibilityRole="button" accessibilityLabel={plural('chat.againLabel', price)} style={styles.again} onPress={() => void send(lastUser.content)}>
                                <Text style={styles.toolText}>{plural('chat.again', price)}</Text>
                            </Pressable>
                        ) : undefined
                    }
                    renderItem={({ item }) => (
                        <View accessible accessibilityLabel={`${item.role === 'user' ? 'You' : 'Vey'}: ${item.content || (sending ? 'writing' : '')}`} style={[styles.bubble, item.role === 'user' ? styles.user : styles.assistant]}>
                            {(() => {
                                const drafts = item.role === 'assistant' ? draftsOf(item.content) : [];
                                const shown = drafts.length ? withoutDrafts(item.content) : item.content;
                                return (
                                    <>
                                        <Text style={[styles.text, item.role === 'user' && styles.userText]}>{shown || (sending && !item.content ? '…' : '')}</Text>
                                        {drafts.length ? <DraftCards drafts={drafts} /> : null}
                                    </>
                                );
                            })()}
                            {item.role === 'assistant' && item.credits ? <Text style={styles.cost}>{plural('chat.replyCost', item.credits)}</Text> : null}
                        </View>
                    )}
                />
            )}
            {notice ? <Text style={styles.notice} accessibilityRole="alert">{notice}</Text> : null}
            {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
            {thread && pickerModelsOpen ? <ModelPicker visible currentId={thread.model_id} models={allModels} onPick={(mid) => void pickModel(mid)} onClose={() => setPickerModelsOpen(false)} /> : null}
            {thread && settingsOpen ? <ChatSettings visible thread={thread} models={allModels} onSave={saveSettings} onClose={() => setSettingsOpen(false)} /> : null}
            <MakePanel visible={makeOpen} initialKind={makeKind} initialPrompt={draft.trim().slice(0, 2000)} onClose={() => setMakeOpen(false)} />
            <LibraryImagePicker visible={pickerOpen} chosen={images} max={maxImages} onClose={() => setPickerOpen(false)} onPick={(img) => setImages((cur) => (cur.length < maxImages && !cur.some((c) => c.assetId === img.assetId) ? [...cur, img] : cur))} />
            {model && price !== null ? (
                <View style={[styles.composerDock, { paddingBottom: Math.max(insets.bottom, 8) }]}>
                    <ChatComposerDeck
                        model={model}
                        options={cleanOptions(model, options)}
                        draft={draft}
                        price={price}
                        canSend={canSend}
                        sending={sending}
                        stopping={stopping}
                        images={images}
                        imageExtra={imageExtra}
                        maxImages={maxImages}
                        placeholder={typeof starter === 'string' && starter ? starter.slice(0, 200) : t('chat.composer.ask')}
                        onDraft={setDraft}
                        onModel={() => setPickerModelsOpen(true)}
                        onOptions={setOptions}
                        onLibrary={() => setPickerOpen(true)}
                        onPhotos={() => void addPhotos()}
                        onRemoveImage={(rid) => setImages((cur) => cur.filter((x) => x.id !== rid))}
                        onMake={openMake}
                        onSend={() => void send()}
                        onStop={() => abort.current?.abort()}
                    />
                </View>
            ) : null}
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    center: { flex: 1 },
    messageList: { flex: 1 },
    conversationBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.background },
    conversationTitle: { flex: 1, minWidth: 0 },
    threadTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
    modelMeta: { color: colors.money, fontSize: 11, lineHeight: 16, fontWeight: '600' },
    headerControl: { minHeight: MIN_TARGET, justifyContent: 'center', paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    headerControlText: { color: colors.text, fontSize: 13, fontWeight: '600' },
    moreControl: { width: MIN_TARGET, height: MIN_TARGET, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    moreText: { color: colors.text, fontSize: 17, fontWeight: '700', letterSpacing: 1 },
    renameBar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
    renameInput: { flex: 1, minHeight: MIN_TARGET, color: colors.text, fontSize: 15, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    list: { flexGrow: 1, paddingHorizontal: 16, paddingVertical: 18, gap: 20 },
    emptyList: { justifyContent: 'flex-start' },
    empty: { paddingTop: 24, paddingBottom: 20 },
    hero: { color: colors.text, fontFamily: fonts.displayHeavy, fontSize: 32, lineHeight: 35, letterSpacing: -1.1, textAlign: 'center' },
    heroHelp: { color: colors.muted, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 10, paddingHorizontal: 18 },
    skillsBlock: { marginTop: 28 },
    eyebrow: { color: colors.accent, fontSize: 11, lineHeight: 16, fontWeight: '800', letterSpacing: 1.3 },
    skillsHelp: { color: colors.body, fontSize: 14, lineHeight: 20, marginTop: 4, marginBottom: 18 },
    skillGroup: { marginBottom: 18 },
    skillGroupLabel: { color: colors.text, fontSize: 13, fontWeight: '700', marginBottom: 8 },
    skillGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    bubble: { maxWidth: '88%', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 12 },
    user: { alignSelf: 'flex-end', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    assistant: { alignSelf: 'stretch', maxWidth: '100%', paddingHorizontal: 2 },
    text: { color: colors.text, fontSize: 16, lineHeight: 24 },
    userText: { color: colors.text },
    cost: { color: colors.money, fontSize: 12, marginTop: 6, fontWeight: '600' },
    error: { color: colors.danger, paddingHorizontal: 16, paddingBottom: 4 },
    notice: { color: colors.body, paddingHorizontal: 16, paddingBottom: 4 },
    toolText: { color: colors.text, fontSize: 14, fontWeight: '600' },
    again: { alignSelf: 'flex-start', minHeight: MIN_TARGET, justifyContent: 'center', paddingHorizontal: 4 },
    starter: { width: '48.7%', minHeight: 108, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 13, gap: 5 },
    starterOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
    starterName: { color: colors.text, fontSize: 15, lineHeight: 19, fontWeight: '700' },
    starterBlurb: { color: colors.muted, fontSize: 12, lineHeight: 17 },
    filmLink: { minHeight: MIN_TARGET, alignSelf: 'flex-start', justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: colors.borderStrong, paddingHorizontal: 15 },
    filmLinkText: { color: colors.text, fontSize: 13, fontWeight: '700' },
    composerDock: { paddingHorizontal: 12, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.background },
});
