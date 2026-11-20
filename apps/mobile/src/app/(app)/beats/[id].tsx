import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Text, themedStyles, useThemedStyles } from '../../../components/ui';
import { EmptyState } from '../../../components/EmptyState';
import { MusicNotice } from '../../../components/music/MusicNotice';
import { PadGrid } from '../../../components/beats/PadGrid';
import { StepGrid } from '../../../components/beats/StepGrid';
import { BeatInstrumentsSection, openPiano } from '../../../components/beats/BeatInstrumentsSection';
import { MixerStrip } from '../../../components/beats/MixerStrip';
import { createBeatAudio, type BeatAudio } from '../../../lib/beatNative/audio';
import {
    addKitTrack, audibleGain, DRUM_KITS, MAX_BPM, MAX_TRACKS, MIN_BPM, removeTrack, setTempo, setTrackGain, setTrackKit, setTrackMute, setTrackPan, setTrackSolo, toggleStep, tryOp,
    type BeatDoc, type Edit, type PadId,
} from '../../../lib/beatNative/doc';
import { beatStore, getBeat, listBeats, putBeat, subscribeBeats } from '../../../lib/beatNative/store';
import { t } from '../../../lib/i18n';
import { useAnnouncement } from '../../../lib/useAnnouncement';
import { ds } from '../../../theme';

import { createHistory, record, replacePresent, travel, canUndo, canRedo, type History } from '../../../lib/beatNative/history';
import { useLocalBeatLifecycle } from '../../../lib/beatNative/useLocalBeatLifecycle';
import { BeatSaveControls } from '../../../components/beats/BeatSaveControls';

const clampBpm = (n: number) => Math.min(MAX_BPM, Math.max(MIN_BPM, n));

export default function BeatEditor() {
    const { id } = useLocalSearchParams<{ id: string }>();
    useSyncExternalStore(subscribeBeats, listBeats, listBeats);
    const doc = getBeat(String(id));
    const s = useThemedStyles(sheets);
    const history = useRef<History | null>(null);
    if (doc && history.current?.present !== doc) history.current = createHistory(doc);
    const audio = useRef<BeatAudio | null>(null);
    const docRef = useRef<BeatDoc | undefined>(doc);
    docRef.current = doc;
    const [pad, setPad] = useState<PadId>('kick');
    const [playing, setPlaying] = useState(false);
    const [step, setStep] = useState<number | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [said, setSaid] = useState<string | null>(null);
    useAnnouncement(notice ?? said, { everywhere: true });
    useLocalBeatLifecycle();
    useEffect(() => () => { void audio.current?.close(); audio.current = null; }, []);

    // The native module is touched only when the person first asks for sound.
    const engine = useCallback((): BeatAudio | null => {
        if (audio.current) return audio.current;
        try { audio.current = createBeatAudio(); return audio.current; } catch { setNotice(t('beat.audioError')); return null; }
    }, []);
    const apply = useCallback((operation: Edit, announce?: string) => {
        const current = docRef.current;
        if (!current) return false;
        let result;
        try { result = tryOp(current, operation); } catch { setNotice(t('beat.refused', { reason: '' })); return false; }
        if (result.refused) { setNotice(t('beat.refused', { reason: result.refused })); return false; }
        if (result.doc !== current) {
            if (!putBeat(result.doc)) { setNotice(t('beat.local.busy')); return false; }
            docRef.current = getBeat(current.id)!;
            history.current = record(history.current ?? createHistory(current), docRef.current, { label: announce });
        }
        setNotice(null); setSaid(announce ?? null); return true;
    }, []);

    const navigateHistory = (direction: 'undo' | 'redo') => {
        if (!history.current) return;
        const next = travel(history.current, direction);
        if (next === history.current) return;
        if (!putBeat(next.present)) { setNotice(t('beat.local.busy')); return; }
        docRef.current = getBeat(next.present.id)!;
        history.current = replacePresent(next, docRef.current);
    };
    if (!doc && beatStore.hydrationState() !== 'ready') return <><Text accessibilityLiveRegion="polite">{t(beatStore.hydrationState() === 'error' ? 'beat.local.loadError' : 'beat.home.checking')}</Text><Button label={t('beat.retry')} onPress={() => void beatStore.hydrateBeats().catch(() => undefined)} /></>;
    if (!doc) return <EmptyState title={t('beat.missing')} body={t('beat.missingBody')} actionLabel={t('beat.back')} href="/beats" />;
    const play = async () => {
        const a = engine(); if (!a) return;
        try { await a.play(() => docRef.current as BeatDoc, n => setStep(n)); setPlaying(true); setSaid(t('beat.playing')); } catch { setNotice(t('beat.audioError')); }
    };
    const stop = () => { audio.current?.stop(); setPlaying(false); setStep(null); setSaid(t('beat.stopped')); };
    const hit = (p: PadId) => { setPad(p); engine()?.hitPad(p, doc.tracks[0]?.kit ?? DRUM_KITS[0].id); };
    const mixOf = (trackId: string, next: BeatDoc) => {
        const track = next.tracks.find(x => x.id === trackId);
        if (track) audio.current?.setTrackMix(trackId, { gain: audibleGain(next, track), pan: track.pan });
    };
    const mix = (trackId: string, operation: Edit, announce?: string) => {
        apply(operation, announce);
        const next = getBeat(doc.id); if (next) { mixOf(trackId, next); next.tracks.forEach(x => mixOf(x.id, next)); }
    };
    const nameOf = (i: number) => t('beat.track', { n: i + 1 });
    const bpm = doc.tempo.bpm;
    const bump = (by: number) => apply(d => setTempo(d, clampBpm(bpm + by)));
    return (
        <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
            <Stack.Screen options={{ title: doc.title }} />
            <BeatSaveControls id={doc.id} apply={apply} />
            <Button label={t('beat.undo')} disabled={!history.current || !canUndo(history.current) || beatStore.saveState(doc.id) === 'busy'} onPress={() => navigateHistory('undo')} />
            <Button label={t('beat.redo')} disabled={!history.current || !canRedo(history.current) || beatStore.saveState(doc.id) === 'busy'} onPress={() => navigateHistory('redo')} />
            {notice ? <MusicNotice message={notice} /> : null}
            <View style={s.transport} accessibilityLabel={t('beat.transport')}>
                <Button label={playing ? t('beat.stop') : t('beat.play')} onPress={() => void (playing ? stop() : play())} containerStyle={s.play} />
                <View style={s.tempo} accessibilityLabel={t('beat.tempo')}>
                    <View style={s.stepper}>
                        <Button size="md" variant="secondary" label="−5" accessibilityLabel={t('beat.tempoDown5')} onPress={() => bump(-5)} disabled={bpm <= MIN_BPM} containerStyle={s.flex} />
                        <Button size="md" variant="secondary" label="−" accessibilityLabel={t('beat.tempoDown')} onPress={() => bump(-1)} disabled={bpm <= MIN_BPM} containerStyle={s.flex} />
                        <Button size="md" variant="secondary" label="+" accessibilityLabel={t('beat.tempoUp')} onPress={() => bump(1)} disabled={bpm >= MAX_BPM} containerStyle={s.flex} />
                        <Button size="md" variant="secondary" label="+5" accessibilityLabel={t('beat.tempoUp5')} onPress={() => bump(5)} disabled={bpm >= MAX_BPM} containerStyle={s.flex} />
                    </View>
                    <Text variant="title3" accessibilityLiveRegion="polite">{t('beat.tempoValue', { bpm })}</Text>
                </View>
            </View>
            <Text variant="bodyStrong" accessibilityRole="header">{t('beat.pads')}</Text>
            <PadGrid selected={pad} onHit={hit} />
            <Text variant="bodyStrong" accessibilityRole="header">{t('beat.steps', { pad: t(`beat.pad.${pad}`) })}</Text>
            <StepGrid doc={doc} pad={pad} current={playing ? step : null} onToggle={n => apply(d => toggleStep(d, pad, n))} />
            <Text variant="bodyStrong" accessibilityRole="header">{t('beat.mixer')}</Text>
            {doc.tracks.map((track, i) => (
                <MixerStrip key={track.id} track={track} index={i} canRemove={doc.tracks.length > 1}
                    onGain={v => mix(track.id, d => setTrackGain(d, track.id, Math.round(v * 100) / 100))}
                    onPan={v => mix(track.id, d => setTrackPan(d, track.id, v))}
                    onMute={v => mix(track.id, d => setTrackMute(d, track.id, v), t(v ? 'beat.muted' : 'beat.unmuted', { track: nameOf(i) }))}
                    onSolo={v => mix(track.id, d => setTrackSolo(d, track.id, v), t(v ? 'beat.soloOn' : 'beat.soloOff', { track: nameOf(i) }))}
                    onKit={kit => apply(d => setTrackKit(d, track.id, kit))}
                    onRemove={() => apply(d => removeTrack(d, track.id))} />
            ))}
            <BeatInstrumentsSection doc={doc} apply={apply} audio={engine} onOpen={regionId => { stop(); openPiano(doc.id, regionId); }} />
            <Button variant="secondary" label={t('beat.track.add')} disabled={doc.tracks.length >= MAX_TRACKS}
                onPress={() => apply(d => addKitTrack(d, DRUM_KITS[0].id))} />
            {doc.tracks.length >= MAX_TRACKS ? <Text variant="footnote" tone="secondary">{t('beat.track.max', { max: MAX_TRACKS })}</Text> : null}
        </ScrollView>
    );
}
const sheets = themedStyles(p => ({
    screen: { flex: 1, backgroundColor: p.bg },
    content: { padding: ds.space.gutter, gap: ds.space.lg, paddingBottom: ds.space.hero },
    transport: { gap: ds.space.md },
    play: { alignSelf: 'stretch' },
    tempo: { gap: ds.space.sm, alignItems: 'center' },
    stepper: { flexDirection: 'row', gap: ds.space.sm },
    flex: { flex: 1 },
}));
