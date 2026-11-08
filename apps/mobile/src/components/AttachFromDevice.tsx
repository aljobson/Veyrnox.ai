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
import { checkPicked, kindOfMime, pickedProblem, slotsFor, type PickedFile, type SlotKind, type SlotName } from '../lib/sources';
import { pickedImageFile } from '../lib/pickedImage';
import { isConsentDeclined, uploadMessage, uploadSource } from '../lib/uploads';
import { ds } from '../theme';

type Source = 'photos' | 'files' | 'library';
interface Picked {
    readonly kind: SlotKind;
    readonly file: PickedFile;
    readonly contentType: string;
}
// The files the open model had no slot for, kept so a person's explicit "Switch to" can place them without picking again.
interface SwitchOffer {
    readonly model: CatalogModel;
    readonly files: PickedFile[];
    readonly library: readonly LibraryPick[];
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
    if (res.canceled) return [];
    // One at a time, so several large photos are never decoded together. A photo that cannot be converted
    // stays as picked: the per-file check reports it and the other picks are kept.
    const files: PickedFile[] = [];
    for (const a of res.assets) {
        if (a.type === 'video' || a.mimeType?.startsWith('video/')) {
            files.push({ uri: a.uri, mimeType: a.mimeType, size: a.fileSize, durationSeconds: typeof a.duration === 'number' ? a.duration / 1000 : undefined });
            continue;
        }
        try { files.push(await pickedImageFile(a)); } catch { files.push({ uri: a.uri, mimeType: a.mimeType ?? undefined, size: a.fileSize }); }
    }
    return files;
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
    const [offer, setOffer] = useState<SwitchOffer | null>(null);
    useEffect(() => { onBusy?.(busy !== null); }, [busy]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => () => onBusy?.(false), []); // eslint-disable-line react-hooks/exhaustive-deps

    async function attach(source: Exclude<Source, 'library'>) {
        const valid = begin();
        setError(null);
        setOffer(null);
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
        setOffer(null);
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

    // Only the person's tap on "Switch to <model>" sets `switchModel`: attaching on its own never changes the model.
    async function switchTo(chosen: SwitchOffer) {
        const valid = begin();
        setError(null);
        setOffer(null);
        setBusy('files');
        try {
            await place(chosen.files, chosen.library, valid, true);
        } catch (err) {
            if (valid()) setError(isConsentDeclined(err) ? null : uploadMessage(err));
        } finally {
            setBusy(null); setProgress(null);
        }
    }

    async function place(files: PickedFile[], library: readonly LibraryPick[], valid: () => boolean, switchModel = false) {
        const picked: Picked[] = [];
        const problems: string[] = [];
        for (const file of files) {
            const kind = kindOfMime(file.mimeType);
            const checked = kind ? checkPicked(kind, file) : null;
            if (kind && checked?.ok) picked.push({ kind, file, contentType: checked.contentType });
            else problems.push(kind && checked && !checked.ok ? pickedProblem(checked.error, kind) : t('attachFromDevice.useJPEGPNGorWebPpicturesMP4'));
        }
        const openForm = !!current && !!onPlaced && !switchModel;
        const items: ({ kind: SlotKind; ref: GenerationReference } | Picked)[] = [
            // On an open form the references already there stay in their own slots; only new files are placed.
            ...(openForm ? [] : uniqueReferences(references).map(ref => ({ kind: referenceKind(ref), ref }))),
            ...library.map(pick => ({ kind: pick.kind, ref: { origin: 'asset' as const, slot: pick.kind as SlotName, asset_id: pick.jobId } })),
            ...picked,
        ];
        // The open model stays: files that it has no slot for are refused rather than moved to another model.
        const catalog = current && !switchModel ? [current] : await fetchCatalog();
        if (!valid()) return;
        const plan = openForm && current ? planOpenForm(current, items, references.map(ref => ({ slot: ref.slot, kind: referenceKind(ref) }))) : planAttachments(catalog, current, items);
        if (!plan) {
            // Say which model is open and which one takes the files; the switch itself is the person's tap.
            const other = current && onPlaced && !problems.length ? planAttachments(await fetchCatalog(), current, items) : null;
            if (!valid()) return;
            // The open model has a slot of that kind but it is full: switching would not be the honest advice, so say what was left out.
            const hasSlot = !!current && slotsFor(current).some(slot => items.some(item => item.kind === slot.kind));
            if (current && other && other.model.id !== current.id && !hasSlot) { setOffer({ model: other.model, files, library }); return; }
            setError(problems[0] ?? (hasSlot ? plural('attachFromDevice.skippedFiles', items.length) : t('attachFromDevice.nomodeltakesthosefilesrightnow')));
            return;
        }
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
        if (current && onPlaced && !switchModel) {
            onPlaced(merged);
            if (plan.unused.length + problems.length > 0) setError(problems[0] ?? plural('attachFromDevice.skippedFiles', plan.unused.length));
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
            {offer && current ? (
                <View style={styles.offer}>
                    <Text variant="body" accessibilityLiveRegion="polite">{t('attachFromDevice.modelTakesNoFiles', { value1: current.name, value2: offer.model.name })}</Text>
                    {offer.model.id === 'seedance-2.0-reference' ? <Text variant="footnote" tone="tertiary">{t('app.create.referenceLikenessNotice')}</Text> : null}
                    <Button variant="secondary" accessibilityRole="button" disabled={busy !== null || blocked} onPress={() => void switchTo(offer)} label={t('attachFromDevice.switchTo', { value1: offer.model.name })} />
                </View>
            ) : null}
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
    offer: { gap: ds.space.sm },
}));
