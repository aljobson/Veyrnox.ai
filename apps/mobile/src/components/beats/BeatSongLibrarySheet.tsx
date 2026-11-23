import { useCallback, useMemo, useRef, useState } from 'react';
import { AppState, FlatList, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '../../auth/AuthProvider';
import { Button, Text, TextField, themedStyles, useThemedStyles } from '../ui';
import { EmptyState } from '../EmptyState';
import { VeyLoader } from '../VeyLoader';
import { t } from '../../lib/i18n';
import { useAnnouncement } from '../../lib/useAnnouncement';
import { ds } from '../../theme';
import type { BeatEditorLayout } from '../../lib/beatNative/editorLayout';
import type { AudioAsset } from '../../lib/beatNative/labs';
import { position } from '../../lib/beatNative/regionActions';
import {
    BeatSongLibraryError,
    classifyBeatSongLibraryError,
    type BeatLibrarySong,
    type BeatSongLibraryErrorCode,
    type BeatSongLibrarySession,
} from '../../lib/beatNative/songLibrary';
import { createNativeBeatSongLibrarySession } from '../../lib/beatNative/songLibraryNative';
import { BeatModal } from './BeatModal';

export type BeatSongPlacement = { start: number; trackId: string | null };
export type BeatSongLibrarySheetProps = {
    layout: BeatEditorLayout;
    disabled: boolean;
    placement(): BeatSongPlacement;
    onCommit(asset: AudioAsset, intent: BeatSongPlacement): boolean;
    onClose(): void;
    onDismiss?(): void;
};

type LoadState =
    | { kind: 'loading' }
    | { kind: 'refreshing' }
    | { kind: 'ready' }
    | { kind: 'error'; error: BeatSongLibraryError };
type PreviewState = { id: string | null; kind: 'idle' | 'preparing' | 'playing' | 'error'; error?: BeatSongLibraryError };
type AddState = { id: string | null; kind: 'idle' | 'adding' | 'refused' | 'error'; position?: string; error?: BeatSongLibraryError };

const idlePreview: PreviewState = { id: null, kind: 'idle' };
const idleAdd: AddState = { id: null, kind: 'idle' };

function errorKey(code: BeatSongLibraryErrorCode) {
    switch (code) {
        case 'offline': return 'beat.library.error.offline';
        case 'expired': return 'beat.library.error.expired';
        case 'accountChanged': return 'beat.library.error.accountChanged';
        case 'featureUnavailable': return 'beat.library.error.featureUnavailable';
        case 'held': return 'beat.library.error.held';
        case 'unavailable': return 'beat.library.error.unavailable';
        case 'invalidMedia': return 'beat.library.error.invalidMedia';
        case 'rateLimited': return 'beat.library.error.rateLimited';
        case 'service': return 'beat.library.error.service';
        case 'aborted': case 'unknown': return 'beat.library.error.unknown';
    }
}

export function BeatSongLibrarySheet({ layout, disabled, placement, onCommit, onClose, onDismiss }: BeatSongLibrarySheetProps) {
    const s = useThemedStyles(sheets);
    const auth = useAuth();
    const [query, setQuery] = useState('');
    const [items, setItems] = useState<readonly BeatLibrarySong[]>([]);
    const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' });
    const [preview, setPreview] = useState<PreviewState>(idlePreview);
    const [adding, setAdding] = useState<AddState>(idleAdd);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const session = useRef<BeatSongLibrarySession | null>(null);
    const listAbort = useRef<AbortController | null>(null);
    const actionAbort = useRef<AbortController | null>(null);
    const listTicket = useRef(0);
    const actionTicket = useRef(0);
    const itemsRef = useRef(items);
    itemsRef.current = items;

    const dispose = useCallback(() => {
        ++listTicket.current; ++actionTicket.current;
        listAbort.current?.abort(); actionAbort.current?.abort();
        listAbort.current = null; actionAbort.current = null;
        session.current?.dispose(); session.current = null;
    }, []);

    const load = useCallback(async (refresh: boolean) => {
        const current = session.current;
        if (!current) return;
        const ticket = ++listTicket.current;
        listAbort.current?.abort();
        const controller = new AbortController(); listAbort.current = controller;
        setLoadState(refresh && itemsRef.current.length ? { kind: 'refreshing' } : { kind: 'loading' });
        try {
            const rows = await current.list(controller.signal);
            if (ticket !== listTicket.current || controller.signal.aborted) return;
            setItems(rows); setSelectedId(value => rows.some(item => item.id === value) ? value : rows[0]?.id ?? null);
            setLoadState({ kind: 'ready' });
        } catch (reason) {
            if (ticket !== listTicket.current || controller.signal.aborted) return;
            const error = classifyBeatSongLibraryError(reason);
            if (error.code === 'aborted') return;
            if (!error.retainRows) { setItems([]); setSelectedId(null); }
            setLoadState({ kind: 'error', error });
        }
    }, []);

    useFocusEffect(useCallback(() => {
        let focused = true;
        const start = () => {
            if (!focused || AppState.currentState !== 'active' || session.current) return;
            session.current = createNativeBeatSongLibrarySession({ api: auth.api, beginSessionTask: auth.beginSessionTask });
            setItems([]); setSelectedId(null); setPreview(idlePreview); setAdding(idleAdd); setLoadState({ kind: 'loading' });
            void load(false);
        };
        start();
        const appState = AppState.addEventListener('change', value => {
            if (!focused) return;
            if (value !== 'active') { dispose(); setPreview(idlePreview); setAdding(idleAdd); }
            else start();
        });
        return () => { focused = false; appState.remove(); dispose(); };
    }, [auth.api, auth.beginSessionTask, auth.generation, dispose, load]));

    const close = useCallback(() => { dispose(); onClose(); }, [dispose, onClose]);
    const term = query.trim().toLocaleLowerCase();
    const shown = useMemo(() => !term ? items : items.filter(item => item.name.toLocaleLowerCase().includes(term)), [items, term]);
    const selected = items.find(item => item.id === selectedId) ?? null;
    const destination = position(placement().start);

    const audition = useCallback(async (item: BeatLibrarySong) => {
        const current = session.current;
        if (!current || preview.kind === 'preparing') return;
        if (preview.id === item.id && preview.kind === 'playing') {
            ++actionTicket.current; actionAbort.current?.abort(); actionAbort.current = null;
            current.stopPreview(); setPreview(idlePreview); return;
        }
        const ticket = ++actionTicket.current;
        actionAbort.current?.abort(); const controller = new AbortController(); actionAbort.current = controller;
        setSelectedId(item.id); setAdding(idleAdd); setPreview({ id: item.id, kind: 'preparing' });
        let callbackSettled = false;
        try {
            const result = await current.togglePreview(item, controller.signal, () => {
                if (ticket !== actionTicket.current || controller.signal.aborted) return;
                callbackSettled = true; setPreview(idlePreview);
            }, error => {
                if (ticket !== actionTicket.current || controller.signal.aborted) return;
                callbackSettled = true; setPreview({ id: item.id, kind: 'error', error });
            });
            if (ticket !== actionTicket.current || controller.signal.aborted) return;
            if (!callbackSettled) setPreview(result === 'playing' ? { id: item.id, kind: 'playing' } : idlePreview);
        } catch (reason) {
            if (ticket !== actionTicket.current || controller.signal.aborted) return;
            const error = classifyBeatSongLibraryError(reason, 'media');
            if (error.code !== 'aborted') setPreview({ id: item.id, kind: 'error', error });
        }
    }, [preview.id, preview.kind]);

    const add = useCallback(async (item: BeatLibrarySong) => {
        const current = session.current;
        if (!current || disabled || adding.kind === 'adding') return;
        const intent = placement();
        const at = position(intent.start);
        const ticket = ++actionTicket.current;
        actionAbort.current?.abort(); const controller = new AbortController(); actionAbort.current = controller;
        current.stopPreview(); setPreview(idlePreview); setSelectedId(item.id);
        setAdding({ id: item.id, kind: 'adding', position: at });
        try {
            const prepared = await current.prepare(item, controller.signal);
            if (ticket !== actionTicket.current || controller.signal.aborted) return;
            current.assertCurrent(controller.signal);
            if (!onCommit(prepared.asset, intent)) {
                setAdding({ id: item.id, kind: 'refused', position: at }); return;
            }
            close();
        } catch (reason) {
            if (ticket !== actionTicket.current || controller.signal.aborted) return;
            const error = classifyBeatSongLibraryError(reason, 'media');
            if (error.code !== 'aborted') setAdding({ id: item.id, kind: 'error', position: at, error });
        }
    }, [adding.kind, close, disabled, onCommit, placement]);

    const status = statusText(loadState, items.length, shown.length, preview, adding, items);
    useAnnouncement(status);
    const empty = loadState.kind !== 'loading' && items.length === 0;
    const list = <View testID="beat-song-library-list-pane" style={s.listPane}>
        <FlatList data={shown} keyExtractor={item => item.id} testID="beat-song-library-list"
            contentContainerStyle={s.listContent} keyboardShouldPersistTaps="handled"
            refreshing={loadState.kind === 'refreshing'} onRefresh={() => void load(true)}
            renderItem={({ item }) => <BeatSongLibraryRow item={item} destination={destination} selectionControl={layout === 'regular'}
                disabled={disabled} selected={item.id === selectedId} preview={preview} adding={adding}
                onSelect={() => setSelectedId(item.id)} onAudition={() => void audition(item)} onAdd={() => void add(item)} />}
            ListEmptyComponent={loadState.kind === 'loading' ? <VeyLoader label={t('beat.library.loading')} showLabel />
                : loadState.kind === 'error' ? undefined
                : empty && !term ? <EmptyState title={t('beat.library.empty.title')} body={t('beat.library.empty.body')} />
                : term ? <View style={s.empty}><Text variant="title3" accessibilityRole="header">{t('beat.library.searchEmpty', { query })}</Text>
                    <Button size="md" variant="secondary" label={t('beat.library.clear')} onPress={() => setQuery('')} /></View> : undefined} />
    </View>;

    return <BeatModal title={t('beat.library.title')} testID="beat-song-library-sheet" onClose={close} onDismiss={onDismiss} scrollable={false}>
        <Button testID="beat-song-library-close" size="md" variant="secondary" label={t('beat.library.close')} onPress={close} />
        <TextField testID="beat-song-library-search" label={t('beat.library.search')} value={query} onChangeText={setQuery}
            autoCorrect={false} returnKeyType="search" clearButtonMode="while-editing" />
        <View testID="beat-song-library-status" accessible accessibilityLabel={status} accessibilityLiveRegion="polite"
            accessibilityRole={loadState.kind === 'error' ? 'alert' : undefined}>
            <Text variant="footnote" tone={loadState.kind === 'error' ? 'danger' : 'secondary'}>{status}</Text>
        </View>
        {query ? <Button size="md" variant="tertiary" label={t('beat.library.clear')} onPress={() => setQuery('')} /> : null}
        {disabled ? <Text testID="beat-song-library-read-only" variant="callout" tone="secondary">{t('beat.library.readOnly')}</Text> : null}
        {loadState.kind === 'error' && loadState.error.retryable ? <Button size="md" variant="secondary" label={t('beat.library.retry')} onPress={() => void load(true)} /> : null}
        <View testID={`beat-song-library-layout-${layout}`} style={layout === 'regular' ? s.regular : s.column}>
            {list}
            {layout === 'regular' ? <BeatSongLibraryDetail item={selected} destination={destination} preview={preview} adding={adding} /> : null}
        </View>
    </BeatModal>;
}

function BeatSongLibraryRow({ item, destination, disabled, selected, selectionControl, preview, adding, onSelect, onAudition, onAdd }: {
    item: BeatLibrarySong; destination: string; disabled: boolean; selected: boolean; selectionControl: boolean;
    preview: PreviewState; adding: AddState; onSelect(): void; onAudition(): void; onAdd(): void;
}) {
    const s = useThemedStyles(sheets);
    const preparing = preview.id === item.id && preview.kind === 'preparing';
    const playing = preview.id === item.id && preview.kind === 'playing';
    const addingThis = adding.id === item.id && adding.kind === 'adding';
    const positionLabel = adding.id === item.id && adding.position ? adding.position : undefined;
    const cue = preparing ? t('beat.library.preparing', { name: item.name })
        : playing ? t('beat.library.playing', { name: item.name })
        : addingThis ? t('beat.library.adding', { name: item.name, position: positionLabel ?? '' })
        : adding.id === item.id && adding.kind === 'refused' ? t('beat.library.addRefused')
        : preview.id === item.id && preview.kind === 'error' && preview.error ? t(errorKey(preview.error.code))
        : adding.id === item.id && adding.kind === 'error' && adding.error ? t(errorKey(adding.error.code)) : null;
    return <View testID={`beat-song-library-row-${item.id}`} style={[s.row, selected && s.selected]}>
        {selectionControl ? <Button size="md" variant="tertiary" label={item.name} onPress={onSelect} accessibilityState={{ selected }}
            containerStyle={s.titleButton} style={s.titleControl} textStyle={s.title} />
            : <Text testID={`beat-song-library-title-${item.id}`} variant="title3" style={s.title}>{item.name}</Text>}
        {cue ? <Text variant="footnote" tone={preview.kind === 'error' || adding.kind === 'error' || adding.kind === 'refused' ? 'danger' : 'accent'}
            >{cue}</Text> : null}
        <View style={s.controls}>
            <Button size="md" variant="secondary" label={t(playing ? 'beat.library.stopNamed' : 'beat.library.auditionNamed', { name: item.name })}
                accessibilityState={{ selected: playing, busy: preparing }} disabled={preparing || addingThis} onPress={onAudition} containerStyle={s.control} />
            <Button size="md" label={t('beat.library.addNamed', { name: item.name, position: positionLabel ?? destination })}
                accessibilityState={{ busy: addingThis }} disabled={disabled || adding.kind === 'adding'} onPress={onAdd} containerStyle={s.control} />
        </View>
    </View>;
}

function BeatSongLibraryDetail({ item, destination, preview, adding }: { item: BeatLibrarySong | null; destination: string; preview: PreviewState; adding: AddState }) {
    const s = useThemedStyles(sheets);
    if (!item) return <View testID="beat-song-library-detail-pane" style={s.detailPane}><Text tone="secondary">{t('beat.library.select')}</Text></View>;
    const cue = preview.id === item.id && preview.kind === 'preparing' ? t('beat.library.preparing', { name: item.name })
        : preview.id === item.id && preview.kind === 'playing' ? t('beat.library.playing', { name: item.name })
        : adding.id === item.id && adding.kind === 'adding' ? t('beat.library.adding', { name: item.name, position: adding.position ?? '' }) : null;
    return <View testID="beat-song-library-detail-pane" style={s.detailPane}>
        <Text variant="title3" accessibilityRole="header">{item.name}</Text>
        <Text variant="bodyStrong" tone="accent">{t('beat.library.destination', { position: adding.position ?? destination })}</Text>
        <Text tone="secondary">{cue ?? t('beat.library.addNamed', { name: item.name, position: destination })}</Text>
    </View>;
}

function statusText(load: LoadState, count: number, shown: number, preview: PreviewState, adding: AddState, items: readonly BeatLibrarySong[]) {
    const previewItem = items.find(item => item.id === preview.id);
    const addItem = items.find(item => item.id === adding.id);
    if (adding.kind === 'adding' && addItem) return t('beat.library.adding', { name: addItem.name, position: adding.position ?? '' });
    if (adding.kind === 'refused') return t('beat.library.addRefused');
    if (adding.kind === 'error' && adding.error) return t(errorKey(adding.error.code));
    if (preview.kind === 'preparing' && previewItem) return t('beat.library.preparing', { name: previewItem.name });
    if (preview.kind === 'playing' && previewItem) return t('beat.library.playing', { name: previewItem.name });
    if (preview.kind === 'error' && preview.error) return t(errorKey(preview.error.code));
    if (load.kind === 'loading') return t('beat.library.loading');
    if (load.kind === 'refreshing') return t('beat.library.refreshing');
    if (load.kind === 'error') return t(errorKey(load.error.code));
    return t('beat.library.count', { count, shown });
}

const sheets = themedStyles(p => ({
    column: { flex: 1, minHeight: 0 },
    regular: { flex: 1, minHeight: 0, flexDirection: 'row', alignItems: 'stretch', gap: ds.space.lg },
    listPane: { flex: 1, minWidth: 0, minHeight: 0 },
    detailPane: { flex: 0.8, minWidth: 0, gap: ds.space.md, padding: ds.space.lg, borderRadius: ds.radius.lg, backgroundColor: p.surface },
    listContent: { gap: ds.space.sm, paddingBottom: ds.space.xl },
    row: { minWidth: 0, gap: ds.space.sm, padding: ds.space.md, borderRadius: ds.radius.md, borderWidth: 1, borderColor: p.borderSubtle, backgroundColor: p.bgElevated1 },
    selected: { borderWidth: 2, borderColor: p.accent },
    titleButton: { width: '100%' },
    titleControl: { width: '100%', justifyContent: 'flex-start' },
    title: { flexShrink: 1, textAlign: 'auto' },
    controls: { flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.sm },
    control: { flexGrow: 1, minWidth: 144 },
    empty: { gap: ds.space.md, alignItems: 'center', padding: ds.space.xl },
}));
