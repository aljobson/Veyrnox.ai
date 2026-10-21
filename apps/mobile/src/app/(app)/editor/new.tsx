import { randomUUID } from 'expo-crypto';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { LibraryChooser } from '../../../components/LibraryChooser';
import { touchTarget } from '../../../lib/a11y';
import { ApiError, type ApiClient } from '../../../lib/api';
import { getCacheUser, subscribeCacheUser } from '../../../lib/appCache';
import { MEDIA_ID } from '../../../lib/editorBridge';
import { EDITOR_ENABLED } from '../../../lib/editorFlag';
import { createProject, defaultWorkspace, editorErrorKey } from '../../../lib/editorProjects';
import { t } from '../../../lib/i18n';
import { ensureOnline, observe, OfflineError } from '../../../lib/network';

export default function NewEditorRoute() {
    if (!EDITOR_ENABLED) return <View><Stack.Screen options={{ title: t('editor.new') }} /><Text>{t('editor.unavailable')}</Text></View>;
    return <NewEditor />;
}
function NewEditor() {
    const { api } = useAuth();
    const router = useRouter();
    const { jobId } = useLocalSearchParams<{ jobId?: string }>();
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
        if (jobId) void create(jobId);
        const unsub = subscribeCacheUser(() => { if (owner.current !== getCacheUser()) { alive.current = false; setChoosing(false); router.back(); } });
        return () => { alive.current = false; unsub(); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    function button(label: string, onPress: () => void) {
        return <Pressable style={touchTarget} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: pending }} disabled={pending} onPress={onPress}><Text>{label}</Text></Pressable>;
    }
    return <View style={{ flex: 1, padding: 16 }}>
        <Stack.Screen options={{ title: t('editor.new') }} /><Text accessibilityRole="header">{t('editor.new')}</Text>
        {problem && <Text accessibilityLiveRegion="polite">{t(problem)}</Text>}
        {attempt.current || jobId ? button(t('editor.retryNow'), () => { void create(jobId); }) : <>
            {button(t('editor.creation'), () => setChoosing(true))}
            {button(t('editor.empty'), () => { void create(); })}
        </>}
        {choosing && <LibraryChooser api={observedApi} kind="video" onClose={() => setChoosing(false)} onPick={item => { setChoosing(false); void create(item.jobId, item.name); }} />}
    </View>;
}
