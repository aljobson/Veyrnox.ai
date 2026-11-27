import { rawText } from '../../../lib/i18n/translate';
import { nextOddlingInstructions, parseOddlingInstructions, watchOddlingAction } from '../../../lib/oddlingsChat';
import { useChatLocal } from '../../../lib/useChatLocal';
import { captureChat, restoreDraft } from '../../../lib/chatLocal';
import { useChatFreeLeft } from '../../../lib/useChatFreeLeft';
import { freeLeftFor } from '../../../lib/freeAllowance';
import { useAskAbout } from '../../../lib/useAskAbout';
import { KeyboardScreen } from '../../../components/KeyboardScreen';
import { useChatAutoScroll } from '../../../lib/useChatAutoScroll';
import * as Crypto from 'expo-crypto';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, AppState, FlatList, Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../../auth/AuthProvider';
import { useChatThreadLoad } from '../../../lib/useChatThreadLoad';
import { ChatComposerDeck } from '../../../components/chat/ChatComposerDeck';
import { ChatMessageRow } from '../../../components/chat/ChatMessageRow';
import { useChatDeltas } from '../../../lib/useChatDeltas';
import { ConversationEmpty } from '../../../components/chat/ConversationEmpty';
import { ChatSettings } from '../../../components/chat/ChatSettings';
import { ModelPicker } from '../../../components/chat/ModelPicker';
import { MakePanel } from '../../../components/chat/MakePanel';
import { LibraryImagePicker } from '../../../components/chat/LibraryImagePicker';
import { ApiError } from '../../../lib/api';
import { chatApi, cleanOptions, cleanTitle, imagesExtra, retryRefusalIsUnsettled, isLongText, isModelSwitch, longTextState, NO_OPTIONS, replyPrice, sendKeyFor, type ChatMessage, type ChatModel, type PendingSend, type ReplyOptions } from '../../../lib/chat';
import { imagesBlocked, MAX_ATTACHMENTS, photoNoticeKey, refsForSend, roomFor, type AttachmentRef, type ChatImage, type SentRefs } from '../../../lib/chatAttach';
import { pickFiles, pickPhotos, pickVideoFrames, uploadChatImages } from '../../../lib/chatPhotos';
import { createVideoAttach } from '../../../lib/chatVideoAttempt';
import { fetchCatalog, type CatalogModel, type Kind } from '../../../lib/media';
import { skillsInstructions, fittingSkills, selectedSkillIds, skillById, MAX_SELECTED_SKILLS, SKILLS, type Skill } from '../../../lib/studioSkills';
import { useKeyboardOpen } from '../../../lib/useKeyboardOpen';
import { isQuiet, makeSendKey, resolveResumedSend, resolveStoppedSend, RESUME_QUIET_MS, resumeNoticeKey, stopNoticeKey, type StopOutcome } from '../../../lib/chatStop';
import { plural, t } from '../../../lib/i18n';
import { ERROR_TEXT } from '../../../lib/chatErrorText';
import { ensureOnline, OFFLINE_PAID_MESSAGE, OfflineError } from '../../../lib/network';
import { Text, TextField, Button, Icon, useThemedStyles } from '../../../components/ui';
import { latestServerMusicLyricProposal, musicLyricChatSeed, musicLyricProposalLimit, stageMusicLyricProposal } from '../../../lib/music/lyricAssistantHandoff';
import { conversationStyles } from '../../../components/chat/ConversationStyles';
export default function Conversation() {
    const styles = useThemedStyles(conversationStyles);
    const { id, starter, asset, prompt, lyricHandoff } = useLocalSearchParams<{ id: string; starter?: string; asset?: string; prompt?: string; lyricHandoff?: string }>();
    const { api, generation } = useAuth();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const typing = useKeyboardOpen();
    const [title, setTitle] = useState(t('chat.chat2'));
    const [pinned, setPinned] = useState(false);
    const [renaming, setRenaming] = useState<string | null>(null);
    const [messages, setMessages] = useState<ChatMessage[] | null>(null);
    const serverMessageIds = useRef<ReadonlySet<string>>(new Set());
    const setServerMessages = useCallback((next: ChatMessage[]) => {
        serverMessageIds.current = new Set(next.map(message => message.id)); setMessages(next);
    }, []);
    const deltas = useChatDeltas(setMessages);
    const [musicSeed] = useState(() => typeof lyricHandoff === 'string' ? musicLyricChatSeed(lyricHandoff, id) : undefined);
    const { draft, setDraft, flushDraft, stars, star, starredOnly, setStarredOnly, mounted } = useChatLocal(id, musicSeed ?? (typeof prompt === 'string' ? prompt : undefined));
    const [round, setRound] = useState(0);
    const { left, loadedFor } = useChatFreeLeft(api, round);
    const [sending, setSending] = useState(false);
    const [stopping, setStopping] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lowBalance, setLowBalance] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    // Kept only while a send is unsettled, so a retry of the same message with the same choices is charged once.
    const { messageList, ...follow } = useChatAutoScroll(messages?.length ?? 0, sending, typing);
    const pendingKey = useRef<PendingSend | null>(null);
    const pendingRefs = useRef<SentRefs | null>(null); // storage keys sent with pendingKey (refsForSend)
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
    const [savingSkills, setSavingSkills] = useState(false);
    const skillBusy = useRef(false);
    const oddLocked = !!parseOddlingInstructions(thread?.system_prompt);
    const instructionsLocked = oddLocked || !!musicSeed;
    const selectedIds = selectedSkillIds(thread?.system_prompt);
    useAskAbout(api, asset, model, maxImages, setImages, setNotice);
    const abort = useRef<AbortController | null>(null);
    const live = useRef<{ key: string; text: string; knownIds: ReadonlySet<string>; jobId: string | null; lastEventAt: number } | null>(null);
    const resumed = useRef<StopOutcome | null>(null);
    const busy = useRef(false); // synchronous: a second tap must not start a second turn
    const musicLimit = typeof lyricHandoff === 'string' ? musicLyricProposalLimit(lyricHandoff, id) : null;
    const musicProposal = musicLimit ? latestServerMusicLyricProposal(messages ?? [], sending, musicLimit, serverMessageIds.current) : null;

    function reviewLyricsInMusic() {
        if (typeof lyricHandoff !== 'string' || !musicProposal
            || !stageMusicLyricProposal(lyricHandoff, id, musicProposal.messageId,
                (messages ?? []).find(message => message.id === musicProposal.messageId)?.content ?? '')) {
            setNotice(t('music.lyricAssistant.expired'));
            return;
        }
        router.dismissTo({ pathname: '/music/create', params: { lyricHandoff } });
    }

    async function toggleSkill(skill: Skill) {
        if (musicSeed || skillBusy.current) return;
        const ids = selectedIds.includes(skill.id) ? selectedIds.filter(id => id !== skill.id) : [...selectedIds, skill.id];
        if (ids.length > MAX_SELECTED_SKILLS) return;
        skillBusy.current = true; setSavingSkills(true);
        const action = watchOddlingAction(mounted);
        try {
            const list = catalog ?? (await fetchCatalog().catch(() => []));
            if (!action.current()) return;
            const odd = nextOddlingInstructions(thread?.system_prompt, skill.id, list);
            if (odd && 'error' in odd) { setError(t(odd.error === 'locked' ? 'oddlingsStudio.chatSkillLocked' : 'chatDepth.skillsTooLong')); return; }
            const selected = ids.map(id => skillById(id)!).filter(Boolean);
            if (!odd && fittingSkills(selected, list).length !== selected.length) { setError(t('chatDepth.skillsTooLong')); return; }
            const updated = await chatApi(api).updateThread(id, { system_prompt: odd?.instructions ?? skillsInstructions(selected, list) });
            if (!action.current()) return;
            setThread(th => th ? { ...th, system_prompt: updated.system_prompt ?? null } : th);
        } catch { if (action.current()) setError(t('chat.skills.failed')); }
        finally { skillBusy.current = false; if (action.current()) setSavingSkills(false); action.close(); }
    }

    const threadLoad = useChatThreadLoad(api, id, generation, {
        started: () => setError((current) => (current === t('chat.couldnotloadthischat') ? null : current)),
        opened: (r) => { setTitle(r.thread.title || t('chat.chat2')); setPinned(r.thread.pinned); setServerMessages(r.messages); },
        listed: (r, listed) => {
            setModel(listed?.models.find((m) => m.id === r.thread.model_id) ?? null);
            setAllModels(listed?.models ?? []);
            setThread({ model_id: r.thread.model_id, system_prompt: r.thread.system_prompt ?? null });
            if (listed?.max_attachments) setMaxImages(Math.min(MAX_ATTACHMENTS, listed.max_attachments));
        },
        failed: () => setError(t('chat.couldnotloadthischat')),
        stop: () => abort.current?.abort(),
    });

    // Studio draft blocks in a reply become Open in Create cards, priced from the live catalog.
    const hasDrafts = (messages ?? []).some((m) => m.role === 'assistant' && m.content.includes('```studio'));
    useEffect(() => {
        if (hasDrafts && !catalog) fetchCatalog().then(setCatalog, () => undefined);
    }, [hasDrafts, catalog]);

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
            if (imagesBlocked(images.length, imagesExtra(model))) return; // ATT-04: never drop chosen images and send the text alone
            const sendCapture = captureChat(id);
            busy.current = true; setRound(r => r + 1);
            const chosen = cleanOptions(model, options);
            setError(null);
            setLowBalance(false);
            setNotice(null);
            try {
                await ensureOnline();
            } catch (err) {
                busy.current = false; setRound(r => r + 1);
                if (err instanceof OfflineError) return setError(OFFLINE_PAID_MESSAGE);
                throw err;
            }
            const attached = model && imagesExtra(model) !== null ? images : [];
            const pending = sendKeyFor(pendingKey.current, text, chosen, () => makeSendKey(Crypto.randomUUID()), attached.map((i) => i.id).join(','));
            const isRetry = pending === pendingKey.current; // the same key as a send whose outcome is not known yet
            pendingKey.current = pending;
            setSending(true);
            let refs: readonly AttachmentRef[] = [];
            try {
                pendingRefs.current = await refsForSend(pending.key, pendingRefs.current, attached, (files) => uploadChatImages(api, files, new AbortController().signal));
                refs = pendingRefs.current.refs;
            } catch {
                setError(t('chat.attach.uploadFailed'));
                pendingKey.current = null;
                setSending(false);
                busy.current = false; setRound(r => r + 1);
                return;
            }
            if (again === undefined) setDraft('');
            const knownIds = new Set(messages.map((m) => m.id));
            const stamp = Date.now();
            deltas.begin(`a${stamp}`);
            setStarredOnly(false);
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
                        else if (e.type === 'delta') deltas.add(e.text);
                        else if (e.type === 'error') { deltas.flush(); failed = e.error; }
                        else if (e.type === 'done') deltas.flush();
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
                else if (retryRefusalIsUnsettled(isRetry, err.status)) unanswered = true;
                else failed = err.code;
            }
            deltas.close();
            const giveBack = async () => {
                setMessages((m) => (m ?? []).filter((x) => x.id !== `a${stamp}` && x.id !== `u${stamp}`));
                if (again === undefined) {
                    if (mounted.current) setDraft(text); else await restoreDraft(id, text, sendCapture);
                }
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
                    if (r) setServerMessages(r.messages);
                    setImages([]);
                } else if (outcome === 'nothing') {
                    await giveBack();
                } else {
                    // Not settled: what arrived stays on screen; with nothing on screen the message goes back.
                    setMessages((m) => (m ?? []).filter((x) => x.id !== `a${stamp}` || x.content.length > 0));
                }
                // Only an unsettled send keeps its key, so retrying it cannot be charged twice. A closed key can never send again.
                if (outcome !== 'pending') pendingKey.current = null;
                setNotice(t(wasResumed ? resumeNoticeKey(outcome) : outcome === 'nothing' && !controller.signal.aborted ? 'chat.lost.nothing' : stopNoticeKey(outcome)));
                setStopping(false);
            } else if (failed) {
                setError(ERROR_TEXT[failed] ?? t('chat.thereplydidnotcompleteYouwere'));
                setLowBalance(failed === 'insufficient_balance' || failed === 'insufficient_credits');
                setMessages((m) => (m ?? []).filter((x) => x.id !== `a${stamp}` || x.content.length > 0));
                if (again === undefined) {
                    if (mounted.current) setDraft(text); else await restoreDraft(id, text, sendCapture);
                }
                pendingKey.current = null;
            } else {
                pendingKey.current = null;
                setImages([]);
                // The saved reply carries its real price.
                const r = await chatApi(api).getThread(id).catch(() => null);
                if (r) setServerMessages(r.messages);
            }
            live.current = null;
            setSending(false);
            busy.current = false; setRound(r => r + 1);
        },
        [api, draft, id, images, messages, model, options, deltas, setStarredOnly],
    );

    // Switching the model changes what the next reply costs; the choices the new model does not offer are dropped.
    async function saveSettings(patch: { model_id?: string; system_prompt?: string }) {
        if (instructionsLocked) { const { system_prompt: _ignored, ...rest } = patch; patch = rest; }
        if (!Object.keys(patch).length) return;
        const action = watchOddlingAction(mounted);
        try {
        const updated = await chatApi(api).updateThread(id, patch);
        if (!action.current()) return;
        const model_id = updated.model_id ?? patch.model_id ?? thread?.model_id ?? '';
        setThread({ model_id, system_prompt: updated.system_prompt ?? patch.system_prompt ?? thread?.system_prompt ?? null });
        const next = allModels.find((m) => m.id === model_id);
        if (next) {
            setModel(next);
            setOptions((o) => cleanOptions(next, o));
        }
        } finally { action.close(); }
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
        const rename = () => setRenaming(title === t('chat.chatFallback') ? '' : title);
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
    const price = model ? replyPrice(model, options, imageExtra !== null ? images.length : 0, draft.trim()) : null;
    async function addImages(pick: typeof pickPhotos) {
        const r = await pick(roomFor(images.length, maxImages)).catch(() => ({ images: [] as ChatImage[], problem: 'failed' as const }));
        if (r.images.length) setImages((cur) => [...cur, ...r.images]);
        const key = photoNoticeKey(r.problem); if (key) setNotice(t(key));
    }
    const videoAttempt = useRef(0);
    const [addVideo] = useState(() => createVideoAttach({
        videoAttempt, pick: (room, onReading) => pickVideoFrames(room, undefined, onReading),
        setNotice, isMounted: () => mounted.current, t,
        addImages: (frames, limit) => setImages(cur => [...cur, ...frames].slice(0, limit)),
    }));
    const isFree = !busy.current && loadedFor === round && !!model && freeLeftFor(left, model.id) > 0 && !options.thinking && !options.web && images.length === 0 && !isLongText(draft.trim());
    const blocked = imagesBlocked(images.length, imageExtra);
    const canSend = !sending && !!draft.trim() && price !== null && !blocked && !longTextState(model, draft.trim()).tooLong;
    const last = messages && messages.length >= 2 ? messages[messages.length - 1] : null;
    const lastUser = last?.role === 'assistant' && last.content ? messages![messages!.length - 2] : null;
    const againPrice = model && lastUser ? replyPrice(model, options, imageExtra !== null ? images.length : 0, lastUser.content) : price;

    return (
        <KeyboardScreen style={styles.screen}>
            <Stack.Screen options={{ title: t('chat.lLMChat') }} />
            {typing ? null : <View style={styles.conversationBar}>
                <Button accessibilityRole="button" accessibilityLabel={t('chat.openchats')} containerStyle={styles.headerControl} onPress={() => router.push('/chat/library')} variant="tertiary" size="md" label={t('chat.openchats')}>
                    <Text variant="footnote" style={styles.headerControlText}>{t('chat.chats')}</Text>
                </Button>
                <View style={styles.conversationTitle}>
                    <Text variant="callout" numberOfLines={1} style={styles.threadTitle}>{title}</Text>
                    {model ? <Text variant="caption" numberOfLines={1} style={styles.modelMeta}>{model.name}</Text> : null}
                    {model ? <Text variant="caption" tone="warning" numberOfLines={1}>{plural('chat.perReply', model.credits_per_reply)}</Text> : null}
                </View>
                <Button accessibilityRole="button" accessibilityLabel={t('chat.settings.open')} disabled={!thread || sending} containerStyle={styles.headerControl} onPress={() => setSettingsOpen(true)} variant="tertiary" size="md" label={t('chat.settings.open')}>
                    <Text variant="footnote" style={styles.headerControlText}>{t('chat.settings.open')}</Text>
                </Button>
                <Button accessibilityRole="button" accessibilityLabel={t('chat.workspace.manage')} containerStyle={styles.moreControl} onPress={showManage} variant="tertiary" size="md" label={t('chat.workspace.manage')}>
                    <Icon name="sliders" size={20} />
                </Button>
            </View>}
            {stars.length > 0 && !typing ? <View><Button variant="tertiary" containerStyle={styles.headerControl} label={t(starredOnly ? 'chatDepth.showAll' : 'chatDepth.showStarred')} accessibilityState={{ selected: starredOnly }} onPress={() => setStarredOnly(value => !value)} /></View> : null}
            {renaming !== null ? (
                <View style={styles.renameBar}>
                    <TextField containerStyle={styles.field} style={styles.renameInput} value={renaming} onChangeText={setRenaming} placeholder={t('chat.renamePlaceholder')} accessibilityLabel={t('chat.rename')} maxLength={120} autoFocus />
                    <Button accessibilityRole="button" containerStyle={styles.headerControl} onPress={() => void saveRename()} variant="tertiary" size="md" label={(t('chat.renameSave'))}><Text variant="footnote" style={styles.headerControlText}>{t('chat.renameSave')}</Text></Button>
                    <Button accessibilityRole="button" containerStyle={styles.headerControl} onPress={() => setRenaming(null)} variant="tertiary" size="md" label={(t('chat.renameCancel'))}><Text variant="footnote" style={styles.headerControlText}>{t('chat.renameCancel')}</Text></Button>
                </View>
            ) : null}
            {messages === null && !error ? (
                <ActivityIndicator color={styles.accentInk.color} style={styles.center} />
            ) : (
                <FlatList
                    ref={messageList}
                    keyboardDismissMode="on-drag"
                    {...follow}
                    scrollEventThrottle={64}
                    style={styles.messageList}
                    data={starredOnly ? (messages ?? []).filter(message => message.role === 'assistant' && stars.includes(message.id)) : messages ?? []}
                    keyExtractor={(m) => m.id}
                    contentContainerStyle={[styles.list, (messages?.length ?? 0) === 0 && styles.emptyList]}
                    keyboardShouldPersistTaps="handled"
                    ListEmptyComponent={
                        messages === null ? undefined : starredOnly ?<Text>{t('chatDepth.noStars')}</Text> : <ConversationEmpty
                            lockedIds={musicSeed ? SKILLS.map(skill => skill.id) : oddLocked ? ['oddling-continuity'] : []}
                            selectedIds={selectedIds} saving={savingSkills} onToggle={toggleSkill} />
                    }
                    ListFooterComponent={
                        lastUser && !sending && model && againPrice !== null ? (
                            <Button accessibilityRole="button" accessibilityLabel={rawText(plural('chat.againLabel', againPrice ?? 0))} containerStyle={styles.again} onPress={() => void send(lastUser.content)} variant="tertiary" size="md" label={plural('chat.againLabel', againPrice ?? 0)}>
                                <Text variant="callout" tone="warning">{plural('chat.again', againPrice ?? 0)}</Text>
                            </Button>
                        ) : undefined
                    }
                    renderItem={({ item }) => (
                        <ChatMessageRow selected={stars.includes(item.id)} onStar={star} message={item} sending={sending && item.id === deltas.messageId} catalog={catalog} />
                    )}
                />
            )}
            {blocked ? <Text style={styles.notice} accessibilityRole="alert">{t('chat.attach.modelImages')}</Text> : null}
            {notice ? <Text style={styles.notice} accessibilityRole="alert">{notice}</Text> : null}
            {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
            {musicProposal ? <Button accessibilityRole="button" variant="secondary" label={t('music.lyricAssistant.reviewInMusic')}
                onPress={reviewLyricsInMusic} /> : null}
            {threadLoad.failed ? <Button label={t('chat.tryagain')} accessibilityLabel={t('chat.tryagain')} variant="secondary" onPress={threadLoad.retry} /> : null}
            {error && lowBalance ? <Button label={t('lowBalance.buy')} accessibilityLabel={t('lowBalance.buy')} variant="secondary" onPress={() => router.push('/credits')} /> : null}
            {thread && pickerModelsOpen ? <ModelPicker visible currentId={thread.model_id} models={allModels} onPick={(mid) => void pickModel(mid)} onClose={() => setPickerModelsOpen(false)} /> : null}
            {thread && settingsOpen ? <ChatSettings visible instructionsLocked={instructionsLocked} thread={thread} models={allModels} onSave={saveSettings} onClose={() => setSettingsOpen(false)} /> : null}
            <MakePanel visible={makeOpen} initialKind={makeKind} initialPrompt={draft.trim()} onClose={() => setMakeOpen(false)} />
            <LibraryImagePicker visible={pickerOpen} chosen={images} max={maxImages} onClose={() => setPickerOpen(false)} onPick={(img) => setImages((cur) => (cur.length < maxImages && !cur.some((c) => c.assetId === img.assetId) ? [...cur, img] : cur))} />
            {model && price !== null ? (
                <View style={[styles.composerDock, { paddingBottom: typing ? 8 : Math.max(insets.bottom, 8) }]}>
                    <ChatComposerDeck
                        free={isFree} onVideo={() => { flushDraft(); void addVideo(roomFor(images.length, maxImages), maxImages); }}
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
                        placeholder={skillById(selectedIds[0])?.starter || (typeof starter === 'string' && starter ? starter.slice(0, 200) : t('chat.composer.ask'))}
                        onDraft={setDraft}
                        onModel={() => setPickerModelsOpen(true)}
                        onOptions={setOptions}
                        onLibrary={() => { flushDraft(); setPickerOpen(true); }}
                        onPhotos={() => { flushDraft(); void addImages(pickPhotos); }}
                        onFiles={() => { flushDraft(); void addImages(pickFiles); }}
                        onRemoveImage={(rid) => setImages((cur) => cur.filter((x) => x.id !== rid))}
                        onMake={openMake}
                        onSend={() => void send()}
                        onStop={() => abort.current?.abort()}
                    />
                </View>
            ) : null}
        </KeyboardScreen>
    );
}
