import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AppState, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../auth/AuthProvider';
import { Button, Text, themedStyles, useThemedStyles } from '../ui';
import { getCacheUser, subscribeCacheUser } from '../../lib/appCache';
import { claimAudioFocus, isAudioFocusOwner, releaseAudioFocus } from '../../lib/audioFocus';
import { config } from '../../lib/config';
import { mediaApi } from '../../lib/media';
import { getEntitlements } from '../../lib/music/client';
import {
    cleanPersistentAudioQueueEntry, persistentAudioQueueStore, sanitizePersistentAudioQueue, visiblePersistentAudioQueue,
    type AudioQueueEnvelope, type PersistentQueueCapability,
} from '../../lib/music/persistentAudioQueue';
import { ds } from '../../theme';
import { t } from '../../lib/i18n';
import { PersistentAudioQueueContext, type PersistentAudioQueueApi } from './PersistentAudioQueueContext';

export { usePersistentAudioQueue } from './PersistentAudioQueueContext';

type Capability = PersistentQueueCapability;
type NativeAudioPlayer = ReturnType<typeof import('expo-audio')['createAudioPlayer']>;
const empty = (owner: string): AudioQueueEnvelope => ({ version: 2, owner, queue: [], index: 0 });

export function PersistentAudioQueueProvider({ children }: { children: ReactNode }) {
    const { api } = useAuth();
    const owner = useSyncExternalStore(subscribeCacheUser, getCacheUser, getCacheUser) ?? '';
    const [envelope, setEnvelope] = useState<AudioQueueEnvelope>(() => empty(owner));
    const [capability, setCapability] = useState<Capability>('loading');
    const [playing, setPlaying] = useState(false);
    const loaded = useRef(false), epoch = useRef(0), ownerRef = useRef(owner); ownerRef.current = owner;
    const player = useRef<NativeAudioPlayer | null>(null);
    const listener = useRef<{ remove(): void } | null>(null);
    const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const playerKey = useRef(''), expiresAt = useRef(0), retry = useRef(0);
    const playbackEpoch = useRef(0);
    const retryStart = useRef<((fresh?: boolean) => Promise<void>) | null>(null);
    const position = useRef(0), autoNext = useRef(false);
    const focusId = useRef(Symbol('persistent-audio-queue')).current;

    const dispose = useCallback((preservePosition = false) => {
        playbackEpoch.current += 1;
        if (refreshTimer.current) clearTimeout(refreshTimer.current); refreshTimer.current = null;
        releaseAudioFocus(focusId); listener.current?.remove(); listener.current = null;
        const old = player.current; player.current = null; playerKey.current = ''; expiresAt.current = 0;
        if (old) { old.pause(); old.remove(); }
        if (!preservePosition) position.current = 0;
        setPlaying(false);
    }, [focusId]);

    useEffect(() => subscribeCacheUser(() => { epoch.current += 1; loaded.current = false; dispose(); setEnvelope(empty(getCacheUser() ?? '')); }), [dispose]);
    useEffect(() => {
        const state = AppState.addEventListener('change', value => { if (value !== 'active') dispose(true); });
        return () => state.remove();
    }, [dispose]);

    useEffect(() => {
        const ticket = ++epoch.current; loaded.current = false; dispose(); setEnvelope(empty(owner)); setCapability('loading');
        if (!owner) return undefined;
        void Promise.allSettled([persistentAudioQueueStore.load(owner), getEntitlements(api)]).then(async ([stored, entitlements]) => {
            if (ticket !== epoch.current || ownerRef.current !== owner) return;
            let next = stored.status === 'fulfilled' && stored.value ? stored.value : empty(owner);
            if (entitlements.status === 'fulfilled') {
                const enabled = entitlements.value.features.persistentQueue === true;
                setCapability(enabled ? 'on' : 'off');
                if (!enabled) next = await persistentAudioQueueStore.purgeOwned(owner, next);
            } else setCapability('unknown');
            if (ticket !== epoch.current || ownerRef.current !== owner) return;
            loaded.current = true; setEnvelope(next);
        });
        return () => { epoch.current += 1; };
    }, [api, owner, dispose]);

    useEffect(() => {
        if (!loaded.current || !owner || ownerRef.current !== owner) return;
        void persistentAudioQueueStore.save(owner, envelope);
    }, [owner, envelope]);

    const add = useCallback((raw: unknown) => {
        const entry = cleanPersistentAudioQueueEntry(raw); if (!entry) return;
        if (capability !== 'on') return;
        setEnvelope(current => {
            const key = entry.type === 'public_slug' ? `public:${entry.slug}` : `owned:${entry.jobId}`;
            if (current.queue.some(row => (row.type === 'public_slug' ? `public:${row.slug}` : `owned:${row.jobId}`) === key) || current.queue.length >= 30) return current;
            return sanitizePersistentAudioQueue({ ...current, queue: [...current.queue, entry] }, ownerRef.current);
        });
    }, [capability]);
    const apiValue = useMemo<PersistentAudioQueueApi>(() => ({ publicEnabled: capability === 'on', ownedEnabled: capability === 'on', capability,
        addPublic: entry => add({ type: 'public_slug', ...entry }), addOwned: entry => add({ type: 'owned_asset', ...entry }) }), [owner, capability, add]);

    const activeEnvelope = useMemo(() => envelope.owner === owner ? envelope : empty(owner), [envelope, owner]);
    const visible = useMemo(() => visiblePersistentAudioQueue(activeEnvelope, capability), [activeEnvelope, capability]);
    const index = Math.min(activeEnvelope.index, Math.max(0, visible.length - 1));
    const current = visible[index];
    const currentKey = current ? current.type === 'public_slug' ? `public:${current.slug}` : `owned:${current.jobId}` : '';

    const stop = useCallback(() => {
        playbackEpoch.current += 1;
        if (refreshTimer.current) clearTimeout(refreshTimer.current); refreshTimer.current = null;
        player.current?.pause(); releaseAudioFocus(focusId); setPlaying(false);
    }, [focusId]);
    const start = useCallback(async (fresh = false) => {
        if (!current || (current.type === 'owned_asset' && capability !== 'on') || AppState.currentState !== 'active') return;
        const key = current.type === 'public_slug' ? `public:${current.slug}` : `owned:${current.jobId}`;
        if (!fresh) retry.current = 0;
        claimAudioFocus(focusId, stop);
        try {
            if (fresh || !player.current || playerKey.current !== key || Date.now() >= expiresAt.current) {
                const at = position.current;
                dispose(true); claimAudioFocus(focusId, stop);
                const ticket = playbackEpoch.current;
                const { createAudioPlayer, setAudioModeAsync } = require('expo-audio') as typeof import('expo-audio');
                await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false });
                if (ticket !== playbackEpoch.current || ownerRef.current !== owner || !current || !isAudioFocusOwner(focusId)) return;
                const url = current.type === 'public_slug' ? `${config.apiBase}/api/music/public/${current.slug}/asset`
                    : (await mediaApi(api).getAsset(current.jobId)).url;
                if (ticket !== playbackEpoch.current || ownerRef.current !== owner || !isAudioFocusOwner(focusId)) return;
                const next = createAudioPlayer({ uri: url }, { updateInterval: 250, downloadFirst: false });
                player.current = next; playerKey.current = key; expiresAt.current = Date.now() + 12 * 60_000;
                listener.current = next.addListener('playbackStatusUpdate', status => {
                    if (typeof status.currentTime === 'number') position.current = status.currentTime;
                    if (status.didJustFinish) {
                        position.current = 0; setPlaying(false); releaseAudioFocus(focusId);
                        if (index < visible.length - 1) { autoNext.current = true; setEnvelope(value => ({ ...value, index: index + 1 })); }
                    }
                    if (status.error || status.playbackState === 'error' || status.playbackState === 'failed') {
                        if (retry.current < 1) { retry.current += 1; void retryStart.current?.(true); } else dispose();
                    }
                });
                if (at > 0) await next.seekTo(at);
                if (ticket !== playbackEpoch.current || !isAudioFocusOwner(focusId)) { dispose(true); return; }
                refreshTimer.current = setTimeout(() => {
                    if (ticket === playbackEpoch.current && isAudioFocusOwner(focusId)) void retryStart.current?.(true);
                }, 11 * 60_000);
            }
            if (playerKey.current !== key || !isAudioFocusOwner(focusId)) return;
            player.current?.play(); setPlaying(true);
        } catch { dispose(); }
    }, [api, capability, current, dispose, focusId, index, owner, stop, visible.length]);
    retryStart.current = start;
    useEffect(() => {
        dispose();
        if (autoNext.current) { autoNext.current = false; queueMicrotask(() => { void retryStart.current?.(); }); }
    }, [currentKey, dispose]);

    const move = (delta: number) => {
        const next = index + delta; if (next < 0 || next >= visible.length) return;
        dispose(); setEnvelope(value => ({ ...value, index: next }));
    };
    const clear = () => { dispose(); setEnvelope(value => capability === 'unknown'
        ? sanitizePersistentAudioQueue({ ...value, queue: value.queue.filter(row => row.type === 'owned_asset'), index: 0 }, ownerRef.current)
        : empty(ownerRef.current)); };
    return <PersistentAudioQueueContext.Provider value={apiValue}><View style={hostStyle}>
        {children}
        {current ? <PersistentAudioQueueBar title={current.title} position={index + 1} total={visible.length} playing={playing}
            canPrevious={index > 0} canNext={index < visible.length - 1} onPrevious={() => move(-1)} onNext={() => move(1)}
            onPlayPause={() => playing ? stop() : void start()} onClear={clear} /> : null}
    </View></PersistentAudioQueueContext.Provider>;
}

function PersistentAudioQueueBar({ title, position, total, playing, canPrevious, canNext, onPrevious, onNext, onPlayPause, onClear }: {
    title: string; position: number; total: number; playing: boolean; canPrevious: boolean; canNext: boolean;
    onPrevious(): void; onNext(): void; onPlayPause(): void; onClear(): void;
}) {
    const insets = useSafeAreaInsets();
    const styles = useThemedStyles(sheets);
    return <View accessibilityRole="summary" accessibilityLabel={t('music.queue.title')}
        style={[styles.bar, { paddingBottom: Math.max(ds.space.sm, insets.bottom) }]}>
        <View style={styles.copy}><Text variant="bodyStrong" numberOfLines={1}>{title}</Text>
            <Text variant="footnote" tone="secondary" accessibilityLiveRegion="polite">{t('music.queue.position', { position, total })}</Text></View>
        <View style={styles.controls}>
            <Button variant="secondary" label={t('musicPlaylists.previous')} disabled={!canPrevious} onPress={onPrevious} />
            <Button label={t(playing ? 'music.pause' : 'music.play')} onPress={onPlayPause} />
            <Button variant="secondary" label={t('musicPlaylists.next')} disabled={!canNext} onPress={onNext} />
            <Button variant="tertiary" label={t('music.create.suno.clear')} onPress={onClear} />
        </View>
    </View>;
}

const hostStyle = { flex: 1 } as const;

const sheets = themedStyles(p => ({
    bar: { padding: ds.space.sm, gap: ds.space.xs, backgroundColor: p.bgElevated1, borderTopWidth: 1, borderTopColor: p.borderStrong },
    copy: { flex: 1, minWidth: 0 },
    controls: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: ds.space.xs },
}));
