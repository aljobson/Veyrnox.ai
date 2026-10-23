import { randomUUID } from 'expo-crypto';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { LibraryChooser } from '../../../components/LibraryChooser';
import { touchTarget } from '../../../lib/a11y';
import { ApiError, type ApiClient } from '../../../lib/api';
import { getCacheUser, subscribeCacheUser } from '../../../lib/appCache';
import { MEDIA_ID } from '../../../lib/editorBridge';
import { EDITOR_ENABLED } from '../../../lib/editorFlag';
import { createProject, defaultWorkspace, editorErrorKey } from '../../../lib/editorProjects';
import { t } from '../../../lib/i18n';
import { MENU_ICONS, type MenuIcon } from '../../../lib/menuIcons';
import { ensureOnline, observe, OfflineError } from '../../../lib/network';
import { colors, fonts, isDark } from '../../../theme';

export default function NewEditorRoute() {
    if (!EDITOR_ENABLED) return <View style={styles.screen}><Stack.Screen options={{ title: t('editor.new') }} /><Text style={styles.error}>{t('editor.unavailable')}</Text></View>;
    return <NewEditor />;
}

function Choice({ icon, title, body, disabled, onPress }: { readonly icon: MenuIcon; readonly title: string; readonly body: string; readonly disabled: boolean; readonly onPress: () => void }) {
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled }} disabled={disabled} style={({ pressed }) => [styles.choice, touchTarget, disabled && styles.disabled, pressed && styles.pressed]} onPress={onPress}>
            <View style={styles.iconBox}>
                <Image source={MENU_ICONS[icon]} style={styles.icon} tintColor={colors.accent} contentFit="contain" alt="" accessibilityElementsHidden />
            </View>
            <View style={styles.choiceCopy}>
                <Text style={styles.choiceTitle}>{title}</Text>
                <Text style={styles.choiceBody}>{body}</Text>
            </View>
            <Image source={MENU_ICONS.caretRight} style={styles.caret} tintColor={colors.muted} contentFit="contain" alt="" accessibilityElementsHidden />
        </Pressable>
    );
}

function NewEditor() {
    const { api } = useAuth();
    const router = useRouter();
    const { jobId, blank } = useLocalSearchParams<{ jobId?: string; blank?: string }>();
    const key = useRef<string | null>(null);
    key.current ??= randomUUID();
    const owner = useRef(getCacheUser());
    const alive = useRef(true);
    const busy = useRef(false);
    const attempt = useRef<{ jobId?: string; name: string; workspaceId?: string } | null>(null);
    const [choosing, setChoosing] = useState(false);
    const [pending, setPending] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);
    const observedApi = useMemo(() => ({ ...api, request: <T,>(path: string, init?: RequestInit) => observe(api.request<T>(path, init)) }) as ApiClient, [api]);
    const current = () => alive.current && owner.current === getCacheUser();
    async function create(id?: string, label?: string) {
        if (busy.current || !current()) return;
        if (id && !MEDIA_ID.test(`j-${id}`)) { setProblem('editor.unavailable'); return; }
        busy.current = true; setPending(true); setProblem(null);
        try {
            await ensureOnline();
            if (!current()) return;
            // Freeze the POST body for this visit, including after an ambiguous network failure.
            attempt.current ??= { jobId: id, name: (label?.trim() || t('editor.untitled')).slice(0, 120) };
            const run = attempt.current;
            if (!run.workspaceId) run.workspaceId = (await defaultWorkspace(api))?.id;
            if (!run.workspaceId) throw new ApiError(404, 'unavailable');
            if (!current()) return;
            const project = await createProject(api, run.workspaceId, run.name, key.current!);
            if (current()) router.replace({ pathname: '/editor/[projectId]', params: { projectId: project.id, ...(run.jobId ? { jobId: run.jobId } : {}) } });
        } catch (err) {
            if (current()) setProblem(err instanceof OfflineError || (err as ApiError).status === 0 ? 'editor.createOffline' : editorErrorKey((err as ApiError).status));
        } finally { busy.current = false; if (current()) setPending(false); }
    }
    useEffect(() => {
        if (jobId || blank === '1') void create(jobId);
        const unsub = subscribeCacheUser(() => { if (owner.current !== getCacheUser()) { alive.current = false; setChoosing(false); router.back(); } });
        return () => { alive.current = false; unsub(); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const automatic = Boolean(jobId || blank === '1');
    return <View style={styles.screen}>
        <Stack.Screen options={{ title: t('editor.new') }} />
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <View style={styles.content}>
            <Text style={styles.eyebrow}>{t('editor.home.eyebrow')}</Text>
            <Text style={styles.heading} accessibilityRole="header">{automatic ? t('editor.openingTitle') : t('editor.new')}</Text>
            <Text style={styles.intro}>{automatic ? t('editor.openingBody') : t('editor.newIntro')}</Text>
            {pending ? <View style={styles.progress} accessibilityLiveRegion="polite"><ActivityIndicator color={colors.accent} /><Text style={styles.progressText}>{t('editor.opening')}</Text></View> : null}
            {problem ? <Text style={styles.error} accessibilityLiveRegion="polite">{t(problem)}</Text> : null}
            {!pending && (attempt.current || jobId) ? (
                <Pressable style={[styles.retry, touchTarget]} accessibilityRole="button" accessibilityLabel={t('editor.retryNow')} onPress={() => { void create(jobId); }}><Text style={styles.retryText}>{t('editor.retryNow')}</Text></Pressable>
            ) : !automatic ? <View style={styles.choices}>
                <Choice icon="image" title={t('editor.creation')} body={t('editor.creationBody')} disabled={pending} onPress={() => setChoosing(true)} />
                <Choice icon="slate" title={t('editor.empty')} body={t('editor.emptyBody')} disabled={pending} onPress={() => { void create(); }} />
            </View> : null}
        </View>
        {choosing && <LibraryChooser api={observedApi} kind="video" onClose={() => setChoosing(false)} onPick={item => { setChoosing(false); void create(item.jobId, item.name); }} />}
    </View>;
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { flex: 1, padding: 20, paddingTop: 28, gap: 10 },
    eyebrow: { color: colors.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1.6 },
    heading: { color: colors.text, fontFamily: fonts.displayHeavy, fontSize: 36, lineHeight: 40, letterSpacing: -1 },
    intro: { color: colors.body, fontSize: 16, lineHeight: 24, marginBottom: 10 },
    choices: { gap: 12 },
    choice: { minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    choiceCopy: { flex: 1, gap: 3 },
    choiceTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
    choiceBody: { color: colors.muted, fontSize: 13, lineHeight: 18 },
    iconBox: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    icon: { width: 23, height: 23 },
    caret: { width: 16, height: 16 },
    progress: { minHeight: 74, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 16, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    progressText: { color: colors.text, fontSize: 15, fontWeight: '700' },
    error: { color: colors.danger, fontSize: 14, lineHeight: 20, padding: 16 },
    retry: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, borderRadius: 13, backgroundColor: colors.accent },
    retryText: { color: colors.accentInk, fontSize: 16, fontWeight: '800' },
    disabled: { opacity: 0.4 },
    pressed: { opacity: 0.76, transform: [{ scale: 0.992 }] },
});
