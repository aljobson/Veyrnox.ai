import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ApiClient } from '../lib/api';
import { planAttachments } from '../lib/attachModel';
import { stageCreativeSourceHandoff } from '../lib/creativeSourceHandoff';
import { fetchCatalog, type CatalogModel } from '../lib/media';
import { checkPicked, kindOfMime, pickedProblem, type PickedFile, type SlotKind, type SlotName } from '../lib/sources';
import { uploadMessage, uploadSource } from '../lib/uploads';
import { colors } from '../theme';

type Source = 'photos' | 'files';
interface Picked {
    readonly kind: SlotKind;
    readonly file: PickedFile;
    readonly contentType: string;
}

const FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/wave'];

// Several files at once, from Photos (pictures and videos) or Files (anything the server takes).
async function chooseMany(source: Source): Promise<PickedFile[]> {
    if (source === 'files') {
        const res = await DocumentPicker.getDocumentAsync({ type: FILE_TYPES, multiple: true, copyToCacheDirectory: true });
        return res.canceled ? [] : res.assets.map((a) => ({ uri: a.uri, mimeType: a.mimeType, size: a.size }));
    }
    const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsMultipleSelection: true,
        quality: 1,
        // Hands back JPEG and H.264 MP4 rather than HEIC or QuickTime, which the server does not accept.
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    return res.canceled ? [] : res.assets.map((a) => ({ uri: a.uri, mimeType: a.mimeType, size: a.fileSize, durationSeconds: typeof a.duration === 'number' ? a.duration / 1000 : undefined }));
}

interface Props {
    readonly api: ApiClient;
    readonly current: CatalogModel | null;
}

// Always shown: pick several pictures, videos and audio files, and the app moves to the model that
// takes the most of them (staying on this one when it can), with every file already uploaded.
export function AttachFromDevice({ api, current }: Props) {
    const router = useRouter();
    const [busy, setBusy] = useState<Source | null>(null);
    const [progress, setProgress] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    async function attach(source: Source) {
        setError(null);
        setBusy(source);
        try {
            let files: PickedFile[];
            try {
                files = await chooseMany(source);
            } catch {
                setError('Could not open your files. Check the permission in Settings.');
                return;
            }
            if (!files.length) return;
            const picked: Picked[] = [];
            const problems: string[] = [];
            for (const file of files) {
                const kind = kindOfMime(file.mimeType);
                const checked = kind ? checkPicked(kind, file) : null;
                if (kind && checked?.ok) picked.push({ kind, file, contentType: checked.contentType });
                else problems.push(kind && checked && !checked.ok ? pickedProblem(checked.error, kind) : 'Use JPEG, PNG or WebP pictures, MP4 video, or MP3 or WAV audio.');
            }
            const plan = planAttachments(await fetchCatalog(), current, picked);
            if (!plan) { setError(problems[0] ?? 'No model takes those files right now.'); return; }
            const uploaded: Partial<Record<SlotName, string>> = {};
            const abort = new AbortController();
            let done = 0;
            for (const { slot, item } of plan.assignments) {
                setProgress(`Uploading ${done + 1} of ${plan.assignments.length}…`);
                uploaded[slot] = await uploadSource(api, item.file, item.contentType, () => {}, abort.signal);
                done++;
            }
            const skipped = plan.unused.length + problems.length;
            const handoff = stageCreativeSourceHandoff({ recipe: 'attach', modelId: plan.model.id, uploaded, fromLibrary: {} });
            router.replace({ pathname: '/create/[modelId]', params: { modelId: plan.model.id, recipe: 'attach', sourceHandoff: handoff } });
            if (skipped) setError(`${skipped} file${skipped === 1 ? '' : 's'} did not fit this model and ${skipped === 1 ? 'was' : 'were'} left out.`);
        } catch (err) {
            setError(uploadMessage(err));
        } finally {
            setBusy(null);
            setProgress(null);
        }
    }

    return (
        <View style={styles.box}>
            <Text style={styles.label}>Attach from device</Text>
            <Text style={styles.hint}>Pick several pictures, videos or audio files at once. If this model cannot use them, we move you to one that can.</Text>
            <View style={styles.row}>
                {(['photos', 'files'] as const).map((source) => (
                    <Pressable key={source} accessibilityRole="button" accessibilityLabel={source === 'photos' ? 'Attach pictures and videos from Photos' : 'Attach files from Files'} accessibilityState={{ disabled: busy !== null }}
                        disabled={busy !== null} style={styles.pick} onPress={() => void attach(source)}>
                        {busy === source ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.pickText}>{source === 'photos' ? 'Photos & videos' : 'Files'}</Text>}
                    </Pressable>
                ))}
            </View>
            {progress ? <Text accessibilityLiveRegion="polite" style={styles.hint}>{progress}</Text> : null}
            {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
        </View>
    );
}

const styles = StyleSheet.create({
    box: { gap: 8 },
    label: { color: colors.text, fontWeight: '600' },
    hint: { color: colors.muted, fontSize: 13 },
    row: { flexDirection: 'row', gap: 8 },
    pick: { flex: 1, minHeight: 48, borderColor: colors.border, borderWidth: 1, borderStyle: 'dashed', borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
    pickText: { color: colors.accent, fontWeight: '600' },
    error: { color: colors.danger },
});
