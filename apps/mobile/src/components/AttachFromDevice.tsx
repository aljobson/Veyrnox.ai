import { rawText } from '../lib/i18n/translate';
import { plural, t } from '../lib/i18n';
import { Text, Button, themedStyles, useThemedStyles } from './ui';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import type { ApiClient } from '../lib/api';
import { planAttachments } from '../lib/attachModel';
import { stageCreativeSourceHandoff } from '../lib/creativeSourceHandoff';
import { fetchCatalog, type CatalogModel } from '../lib/media';
import { checkPicked, kindOfMime, pickedProblem, type PickedFile, type SlotKind, type SlotName } from '../lib/sources';
import { uploadMessage, uploadSource } from '../lib/uploads';
import { ds } from '../theme';

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
    const styles = useThemedStyles(sheets);
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
                setError(t('attachFromDevice.couldnotopenyourfilesCheckthe'));
                return;
            }
            if (!files.length) return;
            const picked: Picked[] = [];
            const problems: string[] = [];
            for (const file of files) {
                const kind = kindOfMime(file.mimeType);
                const checked = kind ? checkPicked(kind, file) : null;
                if (kind && checked?.ok) picked.push({ kind, file, contentType: checked.contentType });
                else problems.push(kind && checked && !checked.ok ? pickedProblem(checked.error, kind) : t('attachFromDevice.useJPEGPNGorWebPpicturesMP4'));
            }
            const plan = planAttachments(await fetchCatalog(), current, picked);
            if (!plan) { setError(problems[0] ?? t('attachFromDevice.nomodeltakesthosefilesrightnow')); return; }
            const uploaded: Partial<Record<SlotName, string[]>> = {};
            const abort = new AbortController();
            let done = 0;
            for (const { slot, item } of plan.assignments) {
                setProgress(t('attachFromDevice.uploadingof', { value1: done + 1, value2: plan.assignments.length }));
                (uploaded[slot] ??= []).push(await uploadSource(api, item.file, item.contentType, () => {}, abort.signal));
                done++;
            }
            const skipped = plan.unused.length + problems.length;
            const handoff = stageCreativeSourceHandoff({ recipe: 'attach', modelId: plan.model.id, uploaded, fromLibrary: {} });
            router.replace({ pathname: '/create/[modelId]', params: { modelId: plan.model.id, recipe: 'attach', sourceHandoff: handoff } });
            if (skipped) setError(plural('attachFromDevice.skippedFiles', skipped));
        } catch (err) {
            setError(uploadMessage(err));
        } finally {
            setBusy(null);
            setProgress(null);
        }
    }

    return (
        <View style={styles.box}>
            <Text variant="bodyStrong" tone="primary" style={styles.label}>{t('attachFromDevice.attachfromdevice')}</Text>
            <Text variant="footnote" tone="tertiary" style={styles.hint}>{t('attachFromDevice.pickseveralpicturesvideosoraudiofiles')}</Text>
            <View style={styles.row}>
                {(['photos', 'files'] as const).map((source) => (
                    <Button variant="secondary" containerStyle={styles.grow} key={source} accessibilityRole="button" accessibilityLabel={rawText(source === 'photos' ? t('attachFromDevice.attachpicturesandvideosfromPhotos') : t('attachFromDevice.attachfilesfromFiles'))} accessibilityState={{ disabled: busy !== null }} disabled={busy !== null} onPress={() => void attach(source)} label={source === 'photos' ? t('attachFromDevice.photosvideos') : t('attachFromDevice.files')} loading={busy === source} />
                ))}
            </View>
            {progress ? <Text variant="footnote" tone="tertiary" accessibilityLiveRegion="polite" style={styles.hint}>{progress}</Text> : null}
            {error ? <Text variant="body" tone="danger" accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
        </View>
    );
}

const sheets = themedStyles((p) => ({

    grow: { flex: 1 },
    box: { gap: ds.space.sm },
    label: { color: p.textPrimary, },
    hint: { color: p.textTertiary, },
    row: { flexDirection: 'row', gap: ds.space.sm },
    error: { color: p.danger },
}));
