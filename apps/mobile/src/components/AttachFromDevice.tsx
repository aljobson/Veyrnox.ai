import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ApiClient } from '../lib/api';
import { modelForAttachment } from '../lib/attachModel';
import { stageCreativeSourceHandoff } from '../lib/creativeSourceHandoff';
import { fetchCatalog, type CatalogModel } from '../lib/media';
import { checkPicked, pickedProblem, type SlotKind } from '../lib/sources';
import { uploadMessage, uploadSource } from '../lib/uploads';
import { colors } from '../theme';
import { choose } from './SourcePicker';

const KINDS: readonly { readonly kind: SlotKind; readonly label: string }[] = [
    { kind: 'image', label: 'Picture' },
    { kind: 'video', label: 'Video' },
    { kind: 'audio', label: 'Audio' },
];

interface Props {
    readonly api: ApiClient;
    readonly current: CatalogModel | null;
}

// Shown on a model that takes no files: the person attaches anyway, and the app
// moves them to the nearest model that accepts that kind, with the file already uploaded.
export function AttachFromDevice({ api, current }: Props) {
    const router = useRouter();
    const [busy, setBusy] = useState<SlotKind | null>(null);
    const [error, setError] = useState<string | null>(null);
    const controller = useRef<AbortController | null>(null);

    async function attach(kind: SlotKind) {
        setError(null);
        setBusy(kind);
        try {
            let file;
            try {
                file = await choose(kind);
            } catch {
                setError('Could not open your files. Check the permission in Settings.');
                return;
            }
            if (!file) return;
            const checked = checkPicked(kind, file);
            if (!checked.ok) { setError(pickedProblem(checked.error, kind)); return; }
            const target = modelForAttachment(await fetchCatalog(), current, kind);
            if (!target) { setError('No model takes that kind of file right now.'); return; }
            const abort = new AbortController();
            controller.current = abort;
            const key = await uploadSource(api, file, checked.contentType, () => {}, abort.signal);
            const handoff = stageCreativeSourceHandoff({ recipe: 'attach', modelId: target.id, uploaded: { [kind]: key }, fromLibrary: {} });
            router.replace({ pathname: '/create/[modelId]', params: { modelId: target.id, recipe: 'attach', sourceHandoff: handoff } });
        } catch (err) {
            setError(uploadMessage(err));
        } finally {
            setBusy(null);
        }
    }

    return (
        <View style={styles.box}>
            <Text style={styles.label}>Attach from device</Text>
            <Text style={styles.hint}>A picture, video or audio file as a reference. If this model cannot use it, we move you to one that can.</Text>
            <View style={styles.row}>
                {KINDS.map(({ kind, label }) => (
                    <Pressable key={kind} accessibilityRole="button" accessibilityLabel={`Attach ${label.toLowerCase()} from device`} accessibilityState={{ disabled: busy !== null }}
                        disabled={busy !== null} style={styles.pick} onPress={() => void attach(kind)}>
                        {busy === kind ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.pickText}>{label}</Text>}
                    </Pressable>
                ))}
            </View>
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
