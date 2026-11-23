import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { AccessibilityInfo, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { ASSET_PACK_CATEGORIES, ASSET_PACK_LIMITS, matchingPackAssets } from '../../../../../../app/veyrnox/_lib/editorAssetPacks.mjs';
import { Button, Checkbox, Chip, Text } from '../../ui';
import { plural, rawText, t } from '../../../lib/i18n';
import { colors, fonts as themeFonts } from '../../../theme';
import { touchTarget } from '../../../lib/a11y';
import { createNativeAssetPack, editorAssetPackCatalog, packFileProblem, parseNativeAssetPack, shareNativeAssetPack,
    type AssetPack, type PackAsset, type PickedPackFile } from '../../../lib/editorAssetPackCatalog';
import { KeyboardScreen } from '../../KeyboardScreen';
import { KeyboardFormScrollView } from '../../KeyboardFormScrollView';

type Progress = 'copying' | 'verifying' | 'placing' | 'creating' | null;
type Props = { visible: boolean; playhead: string; onClose(): void; onAdd(pack: AssetPack, asset: PackAsset, picked: PickedPackFile,
    progress: (stage: 'copying' | 'verifying' | 'placing') => void, live: () => boolean): Promise<'placed' | 'changed' | 'invalidFile' | 'cannotAdd' | 'projectFull' | 'tooLarge'> };
const CATEGORIES = ['All', ...ASSET_PACK_CATEGORIES] as const;
const emptyForm = { name: '', credit: '', usage: '', url: '', confirmed: false };
const erase = (uri: string) => { try { const file = new File(uri); if (file.exists) file.delete(); } catch { /* Picker cache is best effort. */ } };

export function AssetPackLibrarySheet({ visible, playhead, onClose, onAdd }: Props) {
    const [packs, setPacks] = useState<AssetPack[]>([]), [active, setActive] = useState<AssetPack | null>(null);
    const [selected, setSelected] = useState<PackAsset | null>(null), [acknowledged, setAcknowledged] = useState(false);
    const [query, setQuery] = useState(''), [category, setCategory] = useState<(typeof CATEGORIES)[number]>('All');
    const [busy, setBusy] = useState(false), [progress, setProgress] = useState<Progress>(null), [problem, setProblem] = useState<string | null>(null);
    const [createProgress, setCreateProgress] = useState({ done: 0, total: 0 });
    const [creating, setCreating] = useState(false), [createFiles, setCreateFiles] = useState<PickedPackFile[]>([]), [form, setForm] = useState(emptyForm);
    const generation = useRef(0), mounted = useRef(true), createFilesRef = useRef<PickedPackFile[]>([]);
    const live = (ticket: number) => mounted.current && ticket === generation.current;
    const invalidate = () => { generation.current += 1; };
    const cleanCreateFiles = () => { for (const item of createFilesRef.current) erase(item.uri); createFilesRef.current = []; setCreateFiles([]); };
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; invalidate(); for (const item of createFilesRef.current) erase(item.uri); }; }, []);
    useEffect(() => {
        if (!visible) return;
        const ticket = ++generation.current;
        void Promise.resolve().then(async () => {
            if (!live(ticket)) return; setProblem(null); setProgress(null); setSelected(null); setAcknowledged(false); setBusy(false); setCreating(false); setCreateFiles([]);
            const items = await editorAssetPackCatalog.list(); if (!live(ticket)) return;
            setPacks(items); setActive(current => items.find(item => item.id === current?.id) ?? items[0] ?? null);
        });
        return () => { invalidate(); for (const item of createFilesRef.current) erase(item.uri); createFilesRef.current = []; };
    }, [visible]);
    useEffect(() => { if (Platform.OS === 'ios' && visible && problem) AccessibilityInfo.announceForAccessibility(problem); }, [problem, visible]);
    useEffect(() => {
        if (Platform.OS !== 'ios' || !visible || !progress) return;
        if (progress === 'creating' && createProgress.done !== 0 && createProgress.done !== createProgress.total) return;
        AccessibilityInfo.announceForAccessibility(progress === 'creating'
            ? t('editorPack.progress.creating', { done: createProgress.done, total: createProgress.total }) : t(`editorPack.progress.${progress}`));
    }, [createProgress.done, createProgress.total, progress, visible]);
    const assets = useMemo(() => active ? matchingPackAssets(active, { query, category }) as PackAsset[] : [], [active, query, category]);
    const setPack = (pack: AssetPack) => { setActive(pack); setSelected(null); setAcknowledged(false); setQuery(''); setCategory('All'); setProblem(null); setCreating(false); };
    const close = () => { if (busy) return; onClose(); };
    const cancelBusy = () => { if (!busy) return; invalidate(); setBusy(false); setProgress(null); setProblem(null); };
    async function openManifest() {
        if (busy) return; setBusy(true); setProblem(null); const ticket = ++generation.current; let uri: string | undefined;
        try {
            const result = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/json', '*/*'], multiple: false, copyToCacheDirectory: true });
            const asset = result.canceled ? null : result.assets[0]; if (asset) uri = asset.uri;
            if (!live(ticket) || !asset) return;
            const file = new File(asset.uri), size = asset.size ?? file.size;
            if (!Number.isSafeInteger(size) || size < 1 || size > ASSET_PACK_LIMITS.manifestBytes) { setProblem(t('editorPack.manifestTooLarge')); return; }
            const parsed = parseNativeAssetPack(await file.text()); if (!live(ticket)) return;
            if ('problem' in parsed) { setProblem(t(`editorPack.${parsed.problem}`)); return; }
            const next = await editorAssetPackCatalog.upsert(parsed.pack); if (!live(ticket) || !next) { setProblem(t('editorPack.accountChanged')); return; }
            setPacks(next); setPack(parsed.pack); AccessibilityInfo.announceForAccessibility(t('editorPack.opened', { name: parsed.pack.name }));
        } catch { if (live(ticket)) setProblem(t('editorPack.invalidManifest')); }
        finally { if (uri) erase(uri); if (live(ticket)) setBusy(false); }
    }
    async function chooseCreateFiles() {
        if (busy) return; setProblem(null); const ticket = ++generation.current;
        try {
            const result = await DocumentPicker.getDocumentAsync({ type: ['video/*', 'audio/*', 'image/jpeg', 'image/png', 'image/webp'], multiple: true, copyToCacheDirectory: true });
            if (result.canceled) return;
            const items = result.assets.map(item => ({ uri: item.uri, name: item.name, size: item.size, mimeType: item.mimeType }));
            if (!live(ticket)) { items.forEach(item => erase(item.uri)); return; }
            cleanCreateFiles();
            const bytes = items.reduce((sum, item) => sum + (item.size ?? 0), 0);
            if (!items.length || items.length > ASSET_PACK_LIMITS.assets || !Number.isSafeInteger(bytes) || bytes > ASSET_PACK_LIMITS.totalBytes) {
                items.forEach(item => erase(item.uri)); setProblem(t('editorPack.filesLimit')); return;
            }
            createFilesRef.current = items; setCreateFiles(items);
        } catch { setProblem(t('editorPack.fileUnreadable')); }
    }
    async function createPack() {
        if (busy || !form.confirmed) return; setBusy(true); setProblem(null); setProgress('creating'); setCreateProgress({ done: 0, total: createFiles.length });
        const ticket = ++generation.current;
        try {
            const pack = await createNativeAssetPack(createFiles, form, () => live(ticket), (done, total) => {
                if (live(ticket)) setCreateProgress({ done, total });
            });
            if (!live(ticket)) return;
            if (!pack) { setProblem(t('editorPack.invalidCreate')); return; }
            const next = await editorAssetPackCatalog.upsert(pack); if (!live(ticket) || !next) { setProblem(t('editorPack.accountChanged')); return; }
            setPacks(next); setPack(pack); cleanCreateFiles(); setForm(emptyForm);
            const shared = await shareNativeAssetPack(pack, () => live(ticket)); if (live(ticket) && shared === 'unavailable') setProblem(t('editorPack.shareUnavailable'));
            else if (live(ticket)) AccessibilityInfo.announceForAccessibility(t('editorPack.created', { name: pack.name }));
        } catch { if (live(ticket)) setProblem(t('editorPack.invalidCreate')); }
        finally { if (live(ticket)) { setBusy(false); setProgress(null); } }
    }
    async function add() {
        if (!active || !selected || !acknowledged || busy) return;
        setBusy(true); setProblem(null); setProgress(null); const ticket = ++generation.current; let uri: string | undefined;
        try {
            const types = selected.kind === 'image' ? ['image/jpeg', 'image/png', 'image/webp'] : selected.kind === 'video' ? ['video/*'] : ['audio/*'];
            const result = await DocumentPicker.getDocumentAsync({ type: types, multiple: false, copyToCacheDirectory: true });
            const item = result.canceled ? null : result.assets[0]; if (item) uri = item.uri;
            if (!live(ticket) || !item) return;
            const picked = { uri: item.uri, name: item.name, size: item.size, mimeType: item.mimeType };
            const refusal = packFileProblem(active, selected.id, picked); if (refusal) { setProblem(t(`editorPack.${refusal}`, { name: selected.file })); return; }
            const resultState = await onAdd(active, selected, picked, stage => { if (live(ticket)) setProgress(stage); }, () => live(ticket));
            if (!live(ticket)) return;
            if (resultState !== 'placed') { setProblem(t(`editorPack.${resultState}`)); return; }
            AccessibilityInfo.announceForAccessibility(t('editorPack.added', { name: selected.name, time: playhead })); onClose();
        } catch { if (live(ticket)) setProblem(t('editorPack.invalidFile')); }
        finally { if (uri) erase(uri); if (live(ticket)) { setBusy(false); setProgress(null); } }
    }
    const update = (field: keyof typeof form, value: string | boolean) => setForm(current => ({ ...current, [field]: value }));
    const createValid = !!createFiles.length && !!form.name.trim() && !!form.credit.trim() && !!form.usage.trim() && form.confirmed;
    return <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={close} accessibilityViewIsModal>
        <SafeAreaView style={s.screen} edges={['top', 'right', 'bottom', 'left']}>
            <View style={s.header}><Pressable accessibilityRole="button" accessibilityLabel={rawText(selected ? t('editorPack.back') : t('editorPack.close'))}
                style={({ pressed }) => [s.headerAction, touchTarget, pressed && s.pressed]} disabled={busy} onPress={() => selected ? (setSelected(null), setAcknowledged(false), setProblem(null)) : close()}>
                <Text tone="accent">{selected ? t('editorPack.back') : t('editorPack.close')}</Text></Pressable>
                <Text accessibilityRole="header" variant="title3" style={s.title}>{t('editorPack.title')}</Text><View style={s.headerAction} /></View>
            <KeyboardScreen><KeyboardFormScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
                {selected && active ? <>
                    <Text variant="title2">{selected.name}</Text><Text tone="secondary">{active.name} · {t(`editorPack.category.${selected.category}`)}</Text>
                    <View style={s.card}><Text variant="bodyStrong">{t('editorPack.expectedFile')}</Text><Text>{selected.file}</Text>
                        <Text variant="bodyStrong">{t('editorPack.creator')}</Text><Text>{selected.attribution.credit}</Text>
                        <Text variant="bodyStrong">{t('editorPack.rights')}</Text><Text>{selected.attribution.usage}</Text>
                        {selected.tags.length ? <Text tone="secondary">{selected.tags.join(' · ')}</Text> : null}
                        {selected.attribution.url ? <Button label={t('editorPack.source')} variant="tertiary" size="md" onPress={() => void Linking.openURL(selected.attribution.url)} /> : null}</View>
                    <Checkbox checked={acknowledged} disabled={busy} onChange={setAcknowledged} accessibilityLabel={rawText(t('editorPack.confirm'))}>
                        <Text>{t('editorPack.confirm')}</Text></Checkbox>
                    <Button label={t('editorPack.addAt', { time: playhead })} disabled={!acknowledged || busy} loading={busy} onPress={() => void add()} />
                    <Text tone="secondary">{t('editorPack.localOnly')}</Text>
                </> : creating ? <>
                    <Text variant="title2">{t('editorPack.createTitle')}</Text><Text tone="secondary">{t('editorPack.createHelp')}</Text>
                    <PackField label={t('editorPack.packName')} value={form.name} maxLength={40} onChangeText={value => update('name', value)} />
                    <PackField label={t('editorPack.creator')} value={form.credit} maxLength={120} onChangeText={value => update('credit', value)} />
                    <PackField label={t('editorPack.rights')} value={form.usage} maxLength={240} onChangeText={value => update('usage', value)} />
                    <PackField label={t('editorPack.licence')} value={form.url} maxLength={1000} autoCapitalize="none" keyboardType="url" onChangeText={value => update('url', value)} />
                    <Button label={t('editorPack.chooseFiles')} variant="secondary" disabled={busy} onPress={() => void chooseCreateFiles()} />
                    <Text tone="secondary">{t('editorPack.selectedCount', { count: createFiles.length })}</Text>
                    <Checkbox checked={form.confirmed} disabled={busy} onChange={value => update('confirmed', value)} accessibilityLabel={rawText(t('editorPack.createConfirm'))}>
                        <Text>{t('editorPack.createConfirm')}</Text></Checkbox>
                    <Button label={t('editorPack.createAndShare')} disabled={!createValid || busy} loading={busy} onPress={() => void createPack()} />
                    <Button label={t('editorPack.cancel')} variant="tertiary" disabled={busy} onPress={() => { cleanCreateFiles(); setCreating(false); setForm(emptyForm); }} />
                </> : <>
                    <Text tone="secondary">{t('editorPack.help')}</Text><View style={s.actions}><Button label={t('editorPack.open')} onPress={() => void openManifest()} disabled={busy} />
                        <Button label={t('editorPack.create')} variant="secondary" onPress={() => { setCreating(true); setProblem(null); }} disabled={busy} /></View>
                    {packs.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>{packs.map(pack => <Chip key={pack.id} label={pack.name}
                        selected={pack.id === active?.id} onPress={() => setPack(pack)} />)}</ScrollView> : <View style={s.empty}><Text variant="title3">{t('editorPack.emptyTitle')}</Text><Text tone="secondary">{t('editorPack.emptyBody')}</Text></View>}
                    {active ? <><TextInput accessibilityLabel={rawText(t('editorPack.search'))} placeholder={rawText(t('editorPack.search'))} placeholderTextColor={colors.muted}
                        value={query} onChangeText={setQuery} style={s.input} /><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>{CATEGORIES.map(item => <Chip
                            key={item} label={t(`editorPack.category.${item}`)} selected={category === item} onPress={() => setCategory(item)} />)}</ScrollView>
                        <Text accessibilityRole="text" tone="secondary">{plural('editorPack.results', assets.length)}</Text>
                        {assets.map(asset => <Pressable key={asset.id} accessibilityRole="button" accessibilityLabel={rawText(t('editorPack.review', { name: asset.name }))}
                            accessibilityHint={rawText(`${t(`editorPack.category.${asset.category}`)}. ${asset.attribution.credit}. ${asset.attribution.usage}`)}
                            style={({ pressed }) => [s.card, pressed && s.pressed]} onPress={() => { setSelected(asset); setAcknowledged(false); setProblem(null); }}>
                            <Text variant="bodyStrong">{asset.name}</Text><Text tone="secondary">{t(`editorPack.category.${asset.category}`)} · {asset.attribution.credit}</Text>
                            <Text numberOfLines={2}>{asset.attribution.usage}</Text><Text tone="accent">{t('editorPack.reviewAction')}</Text></Pressable>)}
                        {!assets.length ? <View style={s.empty}><Text variant="title3">{t('editorPack.noResults')}</Text><Button label={t('editorPack.clearFilters')} variant="tertiary"
                            onPress={() => { setQuery(''); setCategory('All'); }} /></View> : null}</> : null}
                </>}
                {progress ? <Text accessibilityLiveRegion="polite" style={s.status}>{progress === 'creating'
                    ? t('editorPack.progress.creating', { done: createProgress.done, total: createProgress.total }) : t(`editorPack.progress.${progress}`)}</Text> : null}
                {problem ? <Text accessibilityRole="alert" style={s.error}>{problem}</Text> : null}
                {busy ? <Button label={t('editorPack.cancelOperation')} variant="secondary" onPress={cancelBusy} /> : null}
            </KeyboardFormScrollView></KeyboardScreen>
        </SafeAreaView>
    </Modal>;
}

function PackField({ label, ...props }: { label: string } & ComponentProps<typeof TextInput>) {
    return <View style={s.field}><Text variant="bodyStrong">{label}</Text><TextInput {...props} accessibilityLabel={rawText(label)} placeholderTextColor={colors.muted} style={s.input} /></View>;
}

const s = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background }, header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border, paddingHorizontal: 8 }, headerAction: { minWidth: 88, minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
    title: { flex: 1, flexShrink: 1, textAlign: 'center', fontFamily: themeFonts.display }, content: { padding: 16, paddingBottom: 48, gap: 14 }, actions: { gap: 10 },
    chips: { gap: 8, paddingVertical: 2 }, card: { gap: 7, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    empty: { gap: 8, padding: 18, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.borderStrong }, field: { gap: 6 },
    input: { minHeight: 48, color: colors.text, fontSize: 16, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.borderStrong,
        backgroundColor: colors.surface }, status: { color: colors.accent, fontSize: 15, fontWeight: '700' }, error: { color: colors.danger, fontSize: 15, lineHeight: 21, fontWeight: '700' },
    pressed: { opacity: .62 },
});
