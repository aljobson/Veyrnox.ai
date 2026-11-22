import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { getCacheUser } from '../../lib/appCache';
import { runEditorMediaProbe, type EditorMediaProbeEvidence } from '../../lib/editorMedia/probe';
import { colors, radius, space, text } from '../../theme';

export function EditorMediaProbeHarness() {
    const abort = useRef<AbortController | null>(null), [running, setRunning] = useState(false), [status, setStatus] = useState('Ready');
    const [evidence, setEvidence] = useState<EditorMediaProbeEvidence | null>(null);
    useEffect(() => () => abort.current?.abort(), []);
    const run = async () => {
        const account = getCacheUser(); if (!account) { setStatus('Sign in before running the S9 probe.'); return; }
        abort.current?.abort(); const controller = new AbortController(); abort.current = controller; setRunning(true); setEvidence(null);
        try { setEvidence(await runEditorMediaProbe({ account, signal: controller.signal, onStatus: setStatus })); }
        finally { if (abort.current === controller) { abort.current = null; setRunning(false); } }
    };
    return (
        <ScrollView contentContainerStyle={styles.page}>
            <Text style={styles.eyebrow}>DEVELOPMENT BENCHMARK</Text>
            <Text accessibilityRole="header" style={styles.title}>S9 editor media probe</Text>
            <Text style={styles.body}>Renders 900 unique 720p Skia frames, passes only public file batches to the native writer, and records honest architecture evidence.</Text>
            <Pressable accessibilityRole="button" disabled={running} onPress={run} style={({ pressed }) => [styles.button, pressed && !running && styles.pressed, running && styles.disabled]}>
                <Text style={styles.buttonText}>{running ? 'Running…' : 'Run probe'}</Text>
            </Pressable>
            <View style={styles.card}>
                <Text style={styles.label}>Status</Text><Text selectable style={styles.mono}>{status}</Text>
                {evidence ? <Text selectable style={styles.report}>{JSON.stringify(evidence, null, 2)}</Text> : null}
            </View>
        </ScrollView>
    );
}
const styles = StyleSheet.create({
    page: { flexGrow: 1, gap: space.md, padding: space.xl, backgroundColor: colors.background },
    eyebrow: { ...text.micro, color: colors.accent }, title: { ...text.display, color: colors.text }, body: { ...text.body, color: colors.body },
    button: { minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.accent },
    pressed: { opacity: .82 }, disabled: { opacity: .5 }, buttonText: { ...text.bodyStrong, color: colors.accentInk },
    card: { gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colors.surface }, label: { ...text.caption, color: colors.muted },
    mono: { color: colors.body, fontFamily: 'monospace' }, report: { color: colors.body, fontFamily: 'monospace', fontSize: 11, lineHeight: 16 },
});
