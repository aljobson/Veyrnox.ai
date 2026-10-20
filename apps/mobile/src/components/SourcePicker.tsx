import * as DocumentPicker from 'expo-document-picker';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ApiClient } from '../lib/api';
import { LibraryChooser } from './LibraryChooser';
import { t } from '../lib/i18n';
import type { LibraryChoice } from '../lib/librarySource';
import { checkPicked, pickedProblem, type PickedFile, type Slot } from '../lib/sources';
import { uploadMessage, uploadSource } from '../lib/uploads';
import { colors } from '../theme';

interface SourcePickerProps {
    readonly slot: Slot;
    readonly api: ApiClient;
    // The storage key once the file is uploaded, or undefined when it is removed or fails.
    readonly onChange: (key: string | undefined) => void;
    // A Library creation chosen instead of an upload (its job id), or undefined when removed. Without it the choice is not offered.
    readonly onLibrary?: (jobId: string | undefined) => void;
    // True while a file is being sent, so the form does not run without a file still on its way.
    readonly onBusy: (busy: boolean) => void;
}

type Status = { readonly step: 'empty' } | { readonly step: 'uploading'; readonly fraction: number } | { readonly step: 'ready' };

const NOUN = { image: 'image', video: 'video', audio: 'audio file' } as const;

async function choose(kind: Slot['kind']): Promise<PickedFile | null> {
    if (kind === 'audio') {
        const res = await DocumentPicker.getDocumentAsync({ type: ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/wave'], copyToCacheDirectory: true });
        const a = res.canceled ? null : res.assets[0];
        return a ? { uri: a.uri, mimeType: a.mimeType, size: a.size } : null;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: kind === 'image' ? ['images'] : ['videos'],
        quality: 1,
        // Hands back JPEG and H.264 MP4 rather than HEIC or QuickTime, which the server does not accept.
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    const a = res.canceled ? null : res.assets[0];
    if (!a) return null;
    return { uri: a.uri, mimeType: a.mimeType, size: a.fileSize, durationSeconds: typeof a.duration === 'number' ? a.duration / 1000 : undefined };
}

export function SourcePicker({ slot, api, onChange, onLibrary, onBusy }: SourcePickerProps) {
    const [status, setStatus] = useState<Status>({ step: 'empty' });
    const [preview, setPreview] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [choosing, setChoosing] = useState(false);
    const [libraryName, setLibraryName] = useState<string | null>(null);
    const controller = useRef<AbortController | null>(null);

    useEffect(
        () => () => {
            controller.current?.abort();
            onBusy(false);
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps -- cleanup on unmount only
        [],
    );

    async function pick() {
        setError(null);
        let file: PickedFile | null;
        try {
            file = await choose(slot.kind);
        } catch {
            setError('Could not open your files. Check the permission in Settings.');
            return;
        }
        if (!file) return;
        const checked = checkPicked(slot.kind, file, slot.maxSeconds);
        if (!checked.ok) {
            setError(pickedProblem(checked.error, slot.kind));
            return;
        }
        controller.current?.abort();
        const current = new AbortController();
        controller.current = current;
        setPreview(slot.kind === 'image' ? file.uri : null);
        // An upload replaces a Library file chosen earlier for this slot.
        setLibraryName(null);
        onLibrary?.(undefined);
        setStatus({ step: 'uploading', fraction: 0 });
        onChange(undefined);
        onBusy(true);
        try {
            const key = await uploadSource(api, file, checked.contentType, (fraction) => setStatus({ step: 'uploading', fraction }), current.signal);
            setStatus({ step: 'ready' });
            onChange(key);
            onBusy(false);
        } catch (err) {
            if (current.signal.aborted) return;
            onBusy(false);
            setStatus({ step: 'empty' });
            setPreview(null);
            setError(uploadMessage(err));
        }
    }

    function chooseFromLibrary(choice: LibraryChoice) {
        controller.current?.abort();
        onBusy(false);
        setError(null);
        setPreview(null);
        setLibraryName(choice.name);
        setStatus({ step: 'ready' });
        onChange(undefined);
        onLibrary?.(choice.jobId);
    }

    function remove() {
        controller.current?.abort();
        setLibraryName(null);
        onLibrary?.(undefined);
        onBusy(false);
        setStatus({ step: 'empty' });
        setPreview(null);
        setError(null);
        onChange(undefined);
    }

    return (
        <View style={styles.box}>
            <Text style={styles.label}>
                {slot.label}
                {slot.required ? '' : ' (optional)'}
            </Text>
            {status.step === 'empty' ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`Choose ${NOUN[slot.kind]} for ${slot.label}`} style={styles.pick} onPress={pick}>
                    <Text style={styles.pickText}>Choose {NOUN[slot.kind]}</Text>
                </Pressable>
            ) : (
                <View style={styles.row}>
                    {preview ? <Image source={{ uri: preview }} style={styles.thumb} contentFit="cover" /> : <View style={[styles.thumb, styles.thumbPlain]} />}
                    <View style={styles.grow}>
                        {status.step === 'uploading' ? (
                            <View style={styles.status}>
                                <ActivityIndicator color={colors.accent} />
                                <Text style={styles.body}>Uploading {Math.round(status.fraction * 100)}%</Text>
                            </View>
                        ) : (
                            <Text style={styles.body}>{libraryName ? t('libsrc.ready', { name: libraryName }) : 'Ready'}</Text>
                        )}
                    </View>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${slot.label}`} onPress={remove} hitSlop={12}>
                        <Text style={styles.remove}>{status.step === 'uploading' ? 'Cancel' : 'Remove'}</Text>
                    </Pressable>
                </View>
            )}
            {status.step === 'empty' && onLibrary ? (
                <Pressable accessibilityRole="button" accessibilityLabel={t('libsrc.chooseLabel', { kind: NOUN[slot.kind], slot: slot.label })} style={styles.library} onPress={() => setChoosing(true)}>
                    <Text style={styles.pickText}>{t('libsrc.choose')}</Text>
                </Pressable>
            ) : null}
            {choosing ? <LibraryChooser api={api} kind={slot.kind} onPick={chooseFromLibrary} onClose={() => setChoosing(false)} /> : null}
            {slot.maxSeconds ? <Text style={styles.hint}>Up to {slot.maxSeconds} seconds.</Text> : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
    );
}

const styles = StyleSheet.create({
    box: { gap: 8 },
    label: { color: colors.text, fontWeight: '600' },
    pick: { borderColor: colors.border, borderWidth: 1, borderStyle: 'dashed', borderRadius: 12, paddingVertical: 22, alignItems: 'center', backgroundColor: colors.surface },
    pickText: { color: colors.accent, fontWeight: '600' },
    library: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    thumb: { width: 64, height: 64, borderRadius: 10, backgroundColor: colors.surface },
    thumbPlain: { borderColor: colors.border, borderWidth: 1 },
    grow: { flex: 1 },
    status: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    body: { color: colors.body },
    remove: { color: colors.muted },
    hint: { color: colors.muted, fontSize: 12 },
    error: { color: colors.danger },
});
