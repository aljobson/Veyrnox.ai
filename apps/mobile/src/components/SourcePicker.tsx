import { rawText } from '../lib/i18n/translate';
import { Text, Button, themedStyles, useThemedStyles } from './ui';
import * as DocumentPicker from 'expo-document-picker';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { getCacheUser, subscribeCacheUser } from '../lib/appCache';
import { claimDrawFile, deleteDrawFile, isDrawFile, releaseDrawFile } from '../lib/drawFiles';
import { loadDrawOnImage } from '../lib/drawLoader';
import type { ApiClient } from '../lib/api';
import { LibraryChooser } from './LibraryChooser';
import { t, plural } from '../lib/i18n';
import type { LibraryChoice } from '../lib/librarySource';
import { checkPicked, pickedProblem, type PickedFile, type Slot, type GenerationReference } from '../lib/sources';
import { uploadMessage, uploadSource } from '../lib/uploads';
import { ds } from '../theme';

interface SourcePickerProps {
    readonly slot: Slot;
    readonly references?: readonly GenerationReference[];
    readonly onReferences?: (references: readonly GenerationReference[]) => void;
    readonly api: ApiClient;
    // The storage key once the file is uploaded, or undefined when it is removed or fails.
    readonly onChange: (key: string | undefined) => void;
    // A Library creation chosen instead of an upload (its job id), or undefined when removed. Without it the choice is not offered.
    readonly onLibrary?: (jobId: string | undefined) => void;
    // True while a file is being sent, so the form does not run without a file still on its way.
    readonly onBusy: (busy: boolean) => void;
    // A file the app already holds (the Oddlings "animate this portrait" start image). It goes through the same checks and
    // upload as a picked file, once, as soon as it is given.
    readonly initial?: PickedFile | null;
    readonly drawable?: boolean;
    // A line under the slot's name saying what it is for (the photo a template needs).
    readonly hint?: string;
    // A source uploaded on the preceding guided-tool screen. The key itself is
    // held by the parent; this only renders the picker in its ready state.
    readonly initialReady?: boolean;
    // Human-readable state for a preselected Library creation. The route never carries its asset URL.
    readonly initialReadyLabel?: string;
}

type Status = { readonly step: 'empty' } | { readonly step: 'uploading'; readonly fraction: number } | { readonly step: 'ready' };

const NOUN = { image: 'image', video: 'video', audio: 'audio file' } as const;

export async function choose(kind: Slot['kind']): Promise<PickedFile | null> {
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
    return { uri: a.uri, mimeType: a.mimeType, size: a.fileSize, width: a.width, height: a.height, durationSeconds: typeof a.duration === 'number' ? a.duration / 1000 : undefined };
}

// Each row retains its own upload controller, progress and cancellation.
export function SourcePicker(props: SourcePickerProps) {
    const styles = useThemedStyles(sheets);
    return props.onReferences ? <ReferencePicker {...props} /> : <SourceFilePicker {...props} />;
}
function ReferencePicker(props: SourcePickerProps) {
    const styles = useThemedStyles(sheets);
    const serial = useRef(props.references?.length || 1);
    const [rows, setRows] = useState(() => (props.references?.length ? props.references : [undefined]).map((reference, id) => ({ id, reference })));
    const current = useRef(rows);
    const busy = useRef(new Set<number>());
    const max = props.slot.maxFiles ?? 1;
    function change(next: typeof rows) {
        current.current = next; setRows(next);
        props.onReferences?.(next.flatMap(row => row.reference ? [row.reference] : []));
    }
    function reference(id: number, value: GenerationReference | undefined, origin: 'upload' | 'asset') {
        change(current.current.map(row => row.id !== id ? row : { ...row, reference: value || (row.reference?.origin === origin ? undefined : row.reference) }));
    }
    function move(index: number, target: number) {
        const next = [...current.current]; next.splice(target, 0, next.splice(index, 1)[0]); change(next);
    }
    return <View style={{ gap: ds.space.md }}>
        {max > 1 && <Text variant="caption" tone="tertiary" style={styles.hint}>{plural('app.create.sources.maxFiles', max)}</Text>}
        {rows.filter(row => row.reference).length > max && <Text variant="body" tone="danger" accessibilityRole="alert" style={styles.error}>{plural('app.create.sources.overLimit', max)}</Text>}
        {rows.map((row, index) => <View key={row.id} style={{ gap: ds.space.sm }}>
            <SourceFilePicker {...props} slot={{ ...props.slot, required: props.slot.required && index === 0 }}
                initial={row.id === 0 ? props.initial : null} initialReady={!!row.reference}
                onChange={key => reference(row.id, key ? { slot: props.slot.slot, origin: 'upload', key } : undefined, 'upload')}
                onLibrary={props.onLibrary ? asset_id => reference(row.id, asset_id ? { slot: props.slot.slot, origin: 'asset', asset_id } : undefined, 'asset') : undefined}
                onBusy={value => { if (value) busy.current.add(row.id); else busy.current.delete(row.id); props.onBusy(busy.current.size > 0); }} />
            <View style={styles.row}>
                {index > 0 && <Button variant="secondary" accessibilityRole="button" accessibilityLabel={t('app.create.sources.moveEarlier')} onPress={() => move(index, index - 1)} label={t('app.create.sources.moveEarlier')} icon="arrowUp" iconOnly />}
                {index < rows.length - 1 && <Button variant="secondary" accessibilityRole="button" accessibilityLabel={t('app.create.sources.moveLater')} onPress={() => move(index, index + 1)} label={t('app.create.sources.moveLater')} icon="arrowDown" iconOnly />}
            </View>
        </View>)}
        {rows.length < max && <Button variant="secondary" accessibilityRole="button" onPress={() => change([...current.current, { id: serial.current++, reference: undefined }])} label={t(props.slot.kind === 'image' ? 'app.create.sources.image.add' : props.slot.kind === 'video' ? 'app.create.sources.video.add' : 'app.create.sources.audio.add')} />}
    </View>;
}

function SourceFilePicker({ slot, api, onChange, onLibrary, onBusy, initial, drawable = false, hint, initialReady = false, initialReadyLabel }: SourcePickerProps) {
    const styles = useThemedStyles(sheets);
    const [status, setStatus] = useState<Status>(initialReady ? { step: 'ready' } : { step: 'empty' });
    const [preview, setPreview] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [choosing, setChoosing] = useState(false);
    const [libraryName, setLibraryName] = useState<string | null>(initialReadyLabel ?? null);
    const [drawing, setDrawing] = useState<number | null>(null);
    const DrawScreen = useMemo(() => drawable ? loadDrawOnImage() : null, [drawable]);
    const owned = useRef<string | null>(null);
    const mounted = useRef(true);
    const drawEpoch = useRef(0);
    const pickRun = useRef(0);
    const controller = useRef<AbortController | null>(null);

    useEffect(
        () => {
            mounted.current = true;
            return () => {
                mounted.current = false;
                pickRun.current++;
                drawEpoch.current++;
                releaseOwned();
                controller.current?.abort();
                onBusy(false);
            };
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps -- cleanup on unmount only
        [],
    );

    function releaseOwned() {
        if (owned.current) { releaseDrawFile(owned.current); owned.current = null; }
    }
    useEffect(() => subscribeCacheUser(() => {
        pickRun.current++;
        drawEpoch.current++;
        setDrawing(null);
        if (owned.current) remove();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- current owner is held in a ref
    }), []);

    async function pick() {
        const run = ++pickRun.current, owner = getCacheUser();
        const current = () => run === pickRun.current && mounted.current && owner === getCacheUser();
        setError(null);
        let file: PickedFile | null;
        try {
            file = await choose(slot.kind);
        } catch {
            if (!current()) return;
            setError(t('sourcePicker.couldnotopenyourfilesCheckthe'));
            return;
        }
        if (!current()) return;
        if (file) await accept(file);
    }

    async function accept(file: PickedFile) {
        setError(null);
        const checked = checkPicked(slot.kind, file, slot);
        if (!checked.ok) {
            if (isDrawFile(file.uri)) deleteDrawFile(file.uri);
            setError(pickedProblem(checked.error, slot.kind));
            return;
        }
        if (owned.current !== file.uri) {
            releaseOwned();
            if (isDrawFile(file.uri)) { claimDrawFile(file.uri); owned.current = file.uri; }
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
            const key = await uploadSource(api, file, checked.contentType, (fraction) => { if (!current.signal.aborted) setStatus({ step: 'uploading', fraction }); }, current.signal);
            if (current.signal.aborted || !mounted.current) return;
            setStatus({ step: 'ready' });
            onChange(key);
            onBusy(false);
        } catch (err) {
            if (current.signal.aborted) return;
            onBusy(false);
            setStatus({ step: 'empty' });
            setPreview(null);
            releaseOwned();
            setError(uploadMessage(err));
        }
    }

    // The given file is sent once; choosing or removing something afterwards is the person's own call.
    const sentInitial = useRef<string | null>(null);
    useEffect(() => {
        if (!initial || sentInitial.current === initial.uri) return;
        sentInitial.current = initial.uri;
        void accept(initial);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- once per given file
    }, [initial]);

    function chooseFromLibrary(choice: LibraryChoice) {
        releaseOwned();
        drawEpoch.current++;
        setDrawing(null);
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
        releaseOwned();
        drawEpoch.current++;
        setDrawing(null);
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
            <Text variant="bodyStrong" tone="primary" style={styles.label}>
                {slot.label}
                {slot.required ? '' : t('sourcePicker.optional')}
            </Text>
            {hint ? <Text variant="footnote" tone="tertiary" style={styles.slotHint}>{hint}</Text> : null}
            {status.step === 'empty' ? (
                <Button variant="secondary" accessibilityRole="button" accessibilityLabel={rawText(t('sourcePicker.choosefor', { value1: NOUN[slot.kind], value2: slot.label }))} onPress={pick} label={t('sourcePicker.choose', { value1: NOUN[slot.kind] })} />
            ) : (
                <View style={styles.row}>
                    {preview ? <Image source={{ uri: preview }} style={styles.thumb} contentFit="cover" /> : <View style={[styles.thumb, styles.thumbPlain]} />}
                    <View style={styles.grow}>
                        {status.step === 'uploading' ? (
                            <View style={styles.status}>
                                <ActivityIndicator color={styles.accentInk.color} />
                                <Text variant="body" tone="secondary" style={styles.body}>{t('sourcePicker.uploading', { value1: Math.round(status.fraction * 100) })}</Text>
                            </View>
                        ) : (
                            <Text variant="body" tone="secondary" style={styles.body}>{libraryName ? t('libsrc.ready', { name: libraryName }) : t('sourcePicker.ready')}</Text>
                        )}
                    </View>
                    <Button variant="secondary" accessibilityRole="button" accessibilityLabel={rawText(t('sourcePicker.remove', { value1: slot.label }))} onPress={remove} hitSlop={12} label={status.step === 'uploading' ? t('sourcePicker.cancel') : t('sourcePicker.remove2')} />
                </View>
            )}
            {status.step === 'empty' && onLibrary ? (
                <Button variant="secondary" accessibilityRole="button" accessibilityLabel={rawText(t('libsrc.chooseLabel', { kind: NOUN[slot.kind], slot: slot.label }))} onPress={() => setChoosing(true)} label={t('libsrc.choose')} />
            ) : null}
            {drawable && DrawScreen && status.step === 'ready' && preview && !libraryName ? (
                <Button variant="secondary" accessibilityRole="button" accessibilityLabel={t('draw.open')} onPress={() => setDrawing(++drawEpoch.current)} label={t('draw.open')} />
            ) : null}
            {drawing !== null && DrawScreen && preview ? <DrawScreen uri={preview} maxPixels={slot.maxPixels} onCancel={() => { drawEpoch.current++; setDrawing(null); }} onDone={file => {
                if (!mounted.current || drawing !== drawEpoch.current) { deleteDrawFile(file.uri); return; }
                drawEpoch.current++;
                setDrawing(null);
                void accept(file);
            }} /> : null}
            {choosing ? <LibraryChooser api={api} kind={slot.kind} onPick={chooseFromLibrary} onClose={() => setChoosing(false)} /> : null}
            {slot.kind === 'video' && slot.minSeconds != null ? <Text variant="caption" tone="tertiary" style={styles.hint}>{t('app.create.sources.video.mp4Hint')}</Text> : null}
            {slot.minSeconds ? <Text variant="caption" tone="tertiary" style={styles.hint}>{slot.maxSeconds
                ? t('app.create.sources.secondsRange', { min: slot.minSeconds, max: slot.maxSeconds })
                : t('app.create.sources.minSeconds', { min: slot.minSeconds })}</Text>
                : slot.maxSeconds ? <Text variant="caption" tone="tertiary" style={styles.hint}>{t('sourcePicker.uptoseconds', { value1: slot.maxSeconds })}</Text> : null}
            {slot.minSide || slot.maxSide ? <Text variant="caption" tone="tertiary" style={styles.hint}>{slot.minSide && slot.maxSide
                ? t('app.create.sources.sideRange', { min: slot.minSide, max: slot.maxSide })
                : slot.minSide ? t('app.create.sources.minSide', { min: slot.minSide }) : t('app.create.sources.maxSide', { max: slot.maxSide! })}</Text> : null}
            {error ? <Text variant="body" tone="danger" style={styles.error}>{error}</Text> : null}
        </View>
    );
}

const sheets = themedStyles((p) => ({
    accentInk: { color: p.accent },
    box: { gap: ds.space.sm },
    label: { color: p.textPrimary, },
    slotHint: { color: p.textTertiary, },
    row: { flexDirection: 'row', alignItems: 'center', gap: ds.space.md },
    thumb: { width: 64, height: 64, borderRadius: ds.radius.sm, backgroundColor: p.bgElevated1 },
    thumbPlain: { borderColor: p.borderSubtle, borderWidth: 1 },
    grow: { flex: 1 },
    status: { flexDirection: 'row', alignItems: 'center', gap: ds.space.sm },
    body: { color: p.textSecondary },
    hint: { color: p.textTertiary, },
    error: { color: p.danger },
}));
