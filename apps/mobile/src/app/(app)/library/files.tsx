import { rawText } from '../../../lib/i18n/translate';
import { t } from '../../../lib/i18n';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { touchTarget } from '../../../lib/a11y';
import { expiryLabel, fetchFileLink, fetchMasters, fetchRenders, fileErrorMessage, lengthLabel, resolutionLabel, sizeLabel, type FileKind, type LibraryFile } from '../../../lib/libraryFiles';
import { saveOutput, shareOutput } from '../../../lib/output';
import { colors } from '../../../theme';

const TABS: { kind: FileKind; label: string }[] = [
    { kind: 'masters', label: t('files.filmmasters') },
    { kind: 'renders', label: t('files.editorrenders') },
];

export default function LibraryFiles() {
    const { api } = useAuth();
    const router = useRouter();
    const [kind, setKind] = useState<FileKind>('masters');
    const [state, setState] = useState<{ enabled: boolean; files: LibraryFile[] } | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const [acting, setActing] = useState<string | null>(null);
    const [note, setNote] = useState<string | null>(null);

    const load = useCallback(async () => {
        setState(null);
        setProblem(null);
        try {
            setState(await (kind === 'masters' ? fetchMasters(api) : fetchRenders(api)));
        } catch (err) {
            setProblem(fileErrorMessage(err));
        }
    }, [api, kind]);

    useEffect(() => {
        void load();
    }, [load]);

    // The download link lasts about 15 minutes, so it is fetched when the person acts and never kept.
    async function act(file: LibraryFile, what: 'share' | 'save') {
        if (acting) return;
        setActing(`${what}:${file.id}`);
        setNote(null);
        try {
            const link = await fetchFileLink(api, kind, file.id);
            if (!link) return setNote(t('files.thatfilecouldnotbeopened'));
            if (what === 'share') {
                await shareOutput(link.url, file.id, link.mimeType);
            } else if (await saveOutput(link.url, file.id, link.mimeType)) {
                setNote(t('files.savedtoyourPhotos'));
            } else {
                Alert.alert(t('files.photosaccessisoff'), t('files.allowaddingtoPhotosforVeyrnoxin'));
            }
        } catch (err) {
            setNote(fileErrorMessage(err));
        } finally {
            setActing(null);
        }
    }

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: t('files.videofiles') }} />
            <View style={styles.tabs}>
                {TABS.map((t) => (
                    <Pressable key={t.kind} accessibilityRole="button" accessibilityState={{ selected: kind === t.kind }} style={[styles.tab, kind === t.kind && styles.tabOn]} onPress={() => setKind(t.kind)}>
                        <Text style={[styles.tabText, kind === t.kind && styles.tabTextOn]}>{t.label}</Text>
                    </Pressable>
                ))}
            </View>
            {kind === 'masters' ? (
                <Pressable accessibilityRole="button" style={touchTarget} onPress={() => router.push('/film')}>
                    <Text style={styles.link}>{t('files.openyourfilminFilmStudio')}</Text>
                </Pressable>
            ) : null}
            {note ? <Text style={styles.note}>{note}</Text> : null}
            {problem ? (
                <Pressable accessibilityRole="button" style={touchTarget} onPress={load}>
                    <Text style={styles.error}>{t('files.taptoretry', { value1: problem })}</Text>
                </Pressable>
            ) : !state ? (
                <ActivityIndicator color={colors.accent} />
            ) : !state.enabled ? (
                <Text style={styles.muted}>{t('files.thisisnotavailableyet')}</Text>
            ) : (
                <FlatList
                    data={state.files}
                    keyExtractor={(f) => f.id}
                    ListEmptyComponent={<Text style={styles.muted}>{kind === 'masters' ? t('files.nofilmmastersyetTheyaremade') : t('files.nosavededitorrendersyetExportone')}</Text>}
                    renderItem={({ item }) => {
                        const facts = [lengthLabel(item.seconds), resolutionLabel(item.width, item.height), sizeLabel(item.sizeBytes)].filter(Boolean).join(' · ');
                        const expiry = expiryLabel(item.expiresAt);
                        const gone = !!item.expiresAt && Date.parse(item.expiresAt) <= Date.now();
                        return (
                            <View style={styles.row}>
                                <Text style={styles.name}>{item.label}</Text>
                                {facts ? <Text style={styles.muted}>{facts}</Text> : null}
                                {expiry ? <Text style={[styles.muted, gone && styles.warn]}>{expiry}</Text> : null}
                                {!gone ? (
                                    <View style={styles.actions}>
                                        <Pressable accessibilityRole="button" accessibilityLabel={rawText(t('files.share', { value1: item.label }))} disabled={!!acting} style={[styles.action, !!acting && styles.off]} onPress={() => act(item, 'share')}>
                                            <Text style={styles.actionText}>{acting === `share:${item.id}` ? t('files.preparing') : t('files.share2')}</Text>
                                        </Pressable>
                                        <Pressable accessibilityRole="button" accessibilityLabel={rawText(t('files.savetoPhotos', { value1: item.label }))} disabled={!!acting} style={[styles.action, !!acting && styles.off]} onPress={() => act(item, 'save')}>
                                            <Text style={styles.actionText}>{acting === `save:${item.id}` ? t('files.saving') : t('files.savetoPhotos2')}</Text>
                                        </Pressable>
                                    </View>
                                ) : null}
                            </View>
                        );
                    }}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, padding: 16, gap: 12 },
    tabs: { flexDirection: 'row', gap: 8 },
    tab: { flex: 1, minHeight: 44, justifyContent: 'center', borderRadius: 10, alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    tabOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    tabText: { color: colors.body, fontWeight: '600' },
    tabTextOn: { color: colors.accentInk },
    row: { paddingVertical: 14, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth, gap: 3 },
    name: { color: colors.text, fontSize: 16 },
    muted: { color: colors.muted, fontSize: 13 },
    warn: { color: colors.money },
    actions: { flexDirection: 'row', gap: 8, marginTop: 6 },
    action: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 10, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    off: { opacity: 0.4 },
    actionText: { color: colors.accent, fontWeight: '600' },
    note: { color: colors.body },
    error: { color: colors.danger },
    link: { color: colors.accent, fontWeight: '600' },
});
