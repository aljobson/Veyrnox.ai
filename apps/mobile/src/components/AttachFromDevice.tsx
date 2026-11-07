import { rawText } from '../lib/i18n/translate';
import { plural, t } from '../lib/i18n';
import { Text, Button, themedStyles, useThemedStyles } from './ui';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import type { ApiClient } from '../lib/api';
import { attachCapacity, planAttachments, planOpenForm } from '../lib/attachModel';
import { LibraryMultiPicker, type LibraryPick } from './LibraryMultiPicker';
import type { CreativeSourceHandoff } from '../lib/creativeSourceHandoff';
import { createHandoff, referenceKind, uniqueReferences, type FormSnapshot } from '../lib/createHandoff';
import { useHandoffScope } from '../lib/useHandoffScope';
import type { GenerationReference } from '../lib/sources';
import { fetchCatalog, type CatalogModel } from '../lib/media';
import { checkPicked, kindOfMime, pickedProblem, type PickedFile, type SlotKind, type SlotName } from '../lib/sources';
import { isConsentDeclined, uploadMessage, uploadSource } from '../lib/uploads';
import { ds } from '../theme';

type Source = 'photos' | 'files' | 'library';
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
    // What the open form already holds (prompt, length, shape, template). It rides along to the reopened form, so
    // attaching files never throws away a template's prompt or the words already typed.
    readonly settings?: FormSnapshot;
    readonly references?: readonly GenerationReference[];
    readonly previous?: Partial<CreativeSourceHandoff>;
    readonly carry?: Readonly<Record<string, string>>;
    // When given, files are placed on the open form and the model never changes.
    readonly onPlaced?: (added: GenerationReference[]) => void;
    // True while a source upload on the form is in flight: attaching waits so nothing is replaced under it.
    readonly blocked?: boolean;
    readonly onBusy?: (busy: boolean) => void;
}

// Always shown: pick several pictures, videos and audio files, and files are placed on this form and the model never changes. Only with no open model does the app choose one.
export function AttachFromDevice({ api, current, carry, settings, references = [], previous, onPlaced, blocked = false, onBusy }: Props) {
    const styles = useThemedStyles(sheets);
    const router = useRouter();
    const begin = useHandoffScope();
    const [busy, setBusy] = useState<Source | null>(null);
    const [progress, setProgress] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [choosingLibrary, setChoosingLibrary] = useState(false);
    useEffect(() => { onBusy?.(busy !== null); }, [busy]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => () => onBusy?.(false), []); // eslint-disable-line react-hooks/exhaustive-deps

    async function attach(source: Exclude<Source, 'library'>) {
        const valid = begin();
        setError(null);
        setBusy(source);
        try {
            let files: PickedFile[];
            try {
                files = await chooseMany(source);
            } catch {
                if (valid()) setError(t('attachFromDevice.couldnotopenyourfilesCheckthe'));
                return;
            }
            if (!valid() || !files.length) return;
            await place(files, [], valid);
        } catch (err) {
            if (valid()) setError(isConsentDeclined(err) ? null : uploadMessage(err));
        } finally {
            // Busy always clears, even when the screen lost focus mid-upload, so Generate is never left disabled.
            setBusy(null); setProgress(null);
        }
    }

    // Library creations picked in the Add files picker join what the form already holds; nothing is uploaded for them.
    async function attachLibrary(picks: LibraryPick[]) {
        setChoosingLibrary(false);
        const valid = begin();
        setError(null);
        setBusy('library');
        try {
            await place([], picks, valid);
        } catch (err) {
            if (valid()) setError(isConsentDeclined(err) ? null : uploadMessage(err));
        } finally {
            // Busy always clears, even when the screen lost focus mid-upload, so Generate is never left disabled.
            setBusy(null); setProgress(null);
        }
    }

    async function place(files: PickedFile[], library: readonly LibraryPick[], valid: () => boolean) {
        const picked: Picked[] = [];
        const problems: string[] = [];
        for (const file of files) {
            const kind = kindOfMime(file.mimeType);
            const checked = kind ? checkPicked(kind, file) : null;
            if (kind && checked?.ok) picked.push({ kind, file, contentType: checked.contentType });
            else problems.push(kind && checked && !checked.ok ? pickedProblem(checked.error, kind) : t('attachFromDevice.useJPEGPNGorWebPpicturesMP4'));
        }
        const openForm = !!current && !!onPlaced;
        const items: ({ kind: SlotKind; ref: GenerationReference } | Picked)[] = [
            // On an open form the references already there stay in their own slots; only new files are placed.
            ...(openForm ? [] : uniqueReferences(references).map(ref => ({ kind: referenceKind(ref), ref }))),
            ...library.map(pick => ({ kind: pick.kind, ref: { origin: 'asset' as const, slot: pick.kind as SlotName, asset_id: pick.jobId } })),
            ...picked,
        ];
        // The open model stays: files that it has no slot for are refused rather than moved to another model.
        const catalog = current ? [current] : await fetchCatalog();
        if (!valid()) return;
        const plan = openForm && current ? planOpenForm(current, items, references.map(ref => ({ slot: ref.slot, kind: referenceKind(ref) }))) : planAttachments(catalog, current, items);
        if (!plan) { setError(problems[0] ?? t('attachFromDevice.nomodeltakesthosefilesrightnow')); return; }
        const merged: GenerationReference[] = [];
        const abort = new AbortController();
        let done = 0;
        for (const { slot, item } of plan.assignments) {
            if (!valid()) { abort.abort(); return; }
            if ('ref' in item) merged.push({ ...item.ref, slot });
            else {
                setProgress(t('attachFromDevice.uploadingof', { value1: ++done, value2: picked.length }));
                const key = await uploadSource(api, item.file, item.contentType, () => {}, abort.signal);
                if (!valid()) return;
                merged.push({ origin: 'upload', slot, key });
            }
        }
        if (!valid()) return;
        if (current && onPlaced) {
            onPlaced(merged);
            if (plan.unused.length + problems.length > 0) setError(problems[0] ?? t('attachFromDevice.nomodeltakesthosefilesrightnow'));
            return;
        }
        const moved = plan.assignments.filter(a => 'ref' in a.item && a.slot !== a.item.ref.slot).length;
        router.replace(createHandoff(plan.model, carry ?? {}, settings, merged, { ...previous, rightsConfirmed: false }, plan.unused.length + problems.length + moved, !!current && plan.model.id !== current.id));
    }

    return (
        <View style={styles.box}>
            <Text variant="bodyStrong" tone="primary" style={styles.label}>{t('attachFromDevice.attachfromdevice')}</Text>
            <Text variant="footnote" tone="tertiary" style={styles.hint}>{t('attachFromDevice.pickseveralpicturesvideosoraudiofiles')}</Text>
            <View style={styles.row}>
                {(['photos', 'files'] as const).map((source) => (
                    <Button variant="secondary" containerStyle={styles.grow} key={source} accessibilityRole="button" accessibilityLabel={rawText(source === 'photos' ? t('attachFromDevice.attachpicturesandvideosfromPhotos') : t('attachFromDevice.attachfilesfromFiles'))} accessibilityState={{ disabled: busy !== null || blocked }} disabled={busy !== null || blocked} onPress={() => void attach(source)} icon="paperclip" label={source === 'photos' ? t('attachFromDevice.photosvideos') : t('attachFromDevice.files')} loading={busy === source} />
                ))}
                <Button variant="secondary" containerStyle={styles.grow} accessibilityRole="button" accessibilityLabel={rawText(t('libsrc.choose'))} accessibilityState={{ disabled: busy !== null || blocked }} disabled={busy !== null || blocked} onPress={() => setChoosingLibrary(true)} label={t('libsrc.title')} loading={busy === 'library'} />
            </View>
            {choosingLibrary ? <LibraryMultiPicker api={api} capacity={attachCapacity(current)} onConfirm={(picks) => void attachLibrary(picks)} onClose={() => setChoosingLibrary(false)} /> : null}
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
