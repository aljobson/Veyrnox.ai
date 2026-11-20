import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { createNativeBeatEngine, loadNativeContext } from '../../lib/beatNative/nativeContext';
import { createSession, hermesHeapBytes, N0_MAX_PAD_MS, N0_PLAY_SECONDS, type PadReading, type Session, type Stats } from '../../lib/beatNative/session';

// Dev-only harness for slice N0 (docs/mobile/spikes/N0-NATIVE-ENGINE.md). Real-device numbers come from the owner's run.
export function NativeBeatEngineHarness({ deviceLabel }: { deviceLabel: string }) {
    const session = useRef<Session | null>(null);
    const gaps = useRef<string[]>([]);
    const [stats, setStats] = useState<Stats | null>(null);
    const [pads, setPads] = useState<PadReading[]>([]);
    const [log, setLog] = useState<string[]>([]);
    const [running, setRunning] = useState(false);
    const note = useCallback((text: string) => setLog((l) => [`${new Date().toISOString().slice(11, 19)} ${text}`, ...l].slice(0, 40)), []);

    const start = useCallback(async () => {
        try {
            if (!session.current) {
                const native = createNativeBeatEngine({ Context: loadNativeContext() });
                gaps.current = native.report.gaps;
                session.current = createSession({
                    engine: native.engine, wall: () => performance.now(),
                    setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
                    heapBytes: () => hermesHeapBytes(),
                });
            }
            await session.current.start();
            setRunning(true);
            note(`started; gaps: ${gaps.current.join(', ') || 'none'}`);
        } catch (e) {
            note(`start failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    }, [note]);

    const stop = useCallback(() => { session.current?.stop(); setRunning(false); note('stopped'); }, [note]);
    const pad = useCallback(() => {
        if (!session.current) return;
        const reading = session.current.pad();
        setPads((p) => [reading, ...p].slice(0, 20));
    }, []);

    useEffect(() => {
        const timer = setInterval(() => session.current && setStats(session.current.stats()), 1000);
        const sub = AppState.addEventListener('change', (state) => note(`app ${state}; ctx ${session.current?.stats().ctxState ?? 'none'}; audio ${session.current?.stats().audioTime.toFixed(1) ?? '-'}s`));
        return () => { clearInterval(timer); sub.remove(); void session.current?.close(); };
    }, [note]);

    const worst = pads.reduce((m, p) => Math.max(m, p.estimateMs), 0);
    return (
        <ScrollView contentContainerStyle={s.page}>
            <Text style={s.h}>{`N0 native beat engine | ${deviceLabel}`}</Text>
            <Text style={s.m}>{stats ? `tracks ${stats.tracks} | ${stats.seconds}/${N0_PLAY_SECONDS}s | ctx ${stats.ctxState} | audio ${stats.audioTime.toFixed(1)}s | notes ${stats.notes} | stalls ${stats.stalls} | heap ${stats.heapMb ?? 'n/a'} MB` : 'not started'}</Text>
            <View style={s.row}>
                <Pressable accessibilityRole="button" accessibilityLabel={running ? 'Stop the eight tracks' : 'Start the eight tracks'} onPress={running ? stop : start} style={s.btn}>
                    <Text style={s.t}>{running ? 'Stop' : 'Start 8 tracks'}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Hit the kick pad" onPressIn={pad} style={[s.btn, s.pad]}>
                    <Text style={s.t}>Pad</Text>
                </Pressable>
            </View>
            <Text style={s.m}>{pads.length ? `pad estimate (JS + base + output latency): latest ${pads[0].estimateMs.toFixed(1)} ms, worst ${worst.toFixed(1)} ms of ${N0_MAX_PAD_MS} | ${worst <= N0_MAX_PAD_MS ? 'within' : 'OVER'} the bar. Estimate only, not a speaker loopback.` : 'hit Pad to measure'}</Text>
            {pads.slice(0, 5).map((p, i) => <Text key={i} style={s.m}>{`js ${p.jsMs.toFixed(2)} | base ${p.baseMs.toFixed(1)} | out ${p.outMs.toFixed(1)} | est ${p.estimateMs.toFixed(1)} ms`}</Text>)}
            {log.map((l, i) => <Text key={i} style={s.m}>{l}</Text>)}
        </ScrollView>
    );
}

const s = StyleSheet.create({
    page: { padding: 16, gap: 10 },
    h: { fontSize: 16, fontWeight: '600' },
    m: { fontSize: 13, fontVariant: ['tabular-nums'] },
    row: { flexDirection: 'row', gap: 12 },
    btn: { flex: 1, minHeight: 56, borderRadius: 12, backgroundColor: '#333', alignItems: 'center', justifyContent: 'center' },
    pad: { backgroundColor: '#7a2cff' },
    t: { color: '#fff', fontSize: 17, fontWeight: '600' },
});
