import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Text, Button, Card, themedStyles, useThemedStyles } from '../ui';
import { useReducedMotion } from '../ui/useReducedMotion';
import { VeyCharacter } from '../VeyCharacter';
import { GenerationProgress } from '../GenerationProgress';
import { ds } from '../../theme';
import { InlineMedia } from '../InlineMedia';
import { GeneratedChip } from '../library/GeneratedChip';
import { useJobResult, soundPassFor } from '../../lib/createResult';
import { stageCreativeSourceHandoff } from '../../lib/creativeSourceHandoff';
import { celebrateOutput } from '../../lib/celebrate';
import { parseRatio } from '../../lib/templateHandoff';
import type { ApiClient } from '../../lib/api';
import type { CatalogModel, Kind } from '../../lib/media';
import { plural, t } from '../../lib/i18n';
import { failedJobMessage } from '../../lib/failedJob';

export interface ResultBatch {
    ids: string[]; modelId: string; kind: Kind | null; aspect: string | null; duration: number | null; count: number;
}

export function CreateResult({ api, batch, catalog, onTerminal }: { api: ApiClient; batch: ResultBatch; catalog: CatalogModel[]; onTerminal: () => void }) {
    const styles = useThemedStyles(sheets);
    const celebrated = useRef(false);
    const celebrate = (id: string, mime: string) => {
        if (celebrated.current) return;
        celebrated.current = true;
        // The rating ask waits until the person has opened the result (the job screen asks); it no longer
        // appears while the result is still arriving on Create (QA-006).
        celebrateOutput(id, mime, true);
    };
    return <View style={batch.count > 1 ? styles.grid : styles.single}>{batch.ids.map(id => <ResultTile key={id} api={api} id={id} batch={batch} catalog={catalog} onTerminal={onTerminal} onSuccess={celebrate} />)}</View>;
}
function ResultTile({ api, id, batch, catalog, onTerminal, onSuccess }: { api: ApiClient; id: string; batch: ResultBatch; catalog: CatalogModel[]; onTerminal: () => void; onSuccess: (id: string, mime: string) => void }) {
    const styles = useThemedStyles(sheets);
    const router = useRouter();
    const result = useJobResult(api, id);
    const success = useRef(onSuccess); success.current = onSuccess;
    const callback = useRef(onTerminal); callback.current = onTerminal;
    const terminal = result.state === 'succeeded' || result.state === 'failed';
    const refunded = result.job?.refunded;
    useEffect(() => { if (terminal && result.job) callback.current(); }, [terminal, !!result.job, refunded]);
    useEffect(() => { if (result.asset) success.current(id, result.asset.mime_type); }, [id, result.asset]);
    const file = result.asset;
    const batchTile = batch.count > 1;
    const open = () => router.push({ pathname: '/job/[id]', params: { id, fromCreate: '1' } });
    const sound = !batchTile ? soundPassFor({ catalog, modelId: batch.modelId, durationSeconds: batch.duration, result }) : null;
    function addSound() {
        const sourceHandoff = stageCreativeSourceHandoff({ recipe: 'sound-pass', modelId: 'mmaudio-v2-video', uploaded: {}, fromLibrary: {}, references: [{ slot: 'video', origin: 'asset', asset_id: id }] });
        router.push({ pathname: '/create/[modelId]', params: { modelId: 'mmaudio-v2-video', recipe: 'sound-pass', sourceHandoff, prompt: t('libraryCreate.soundPrompt') } });
    }
    const failure = refunded === true ? result.job?.credits ? plural('library.refunded', result.job.credits) : t('library.refundedFree') : t('library.status.failed');
    return <Card style={[styles.card, batchTile && styles.tile]}>
        <View style={[styles.frame, batchTile ? { aspectRatio: 1 } : batch.kind === 'audio' ? { minHeight: 120, paddingVertical: 8 } : { aspectRatio: parseRatio(batch.aspect) ?? (batch.kind === 'video' ? 16 / 9 : 1) }]}>
            {result.held ? <><Text accessibilityRole="header">{t('library.status.held')}</Text><Text>{t('libraryCreate.heldBody')}</Text></>
                : result.error ? <Text tone="danger">{t('job.checkError')}</Text>
                : file ? <>{file.output_stems?.length ? <Text>{t('libraryCreate.stems')}</Text> : file.mime_type.startsWith('image/') ? <Image source={{ uri: file.url }} cachePolicy="memory" contentFit="contain" style={styles.image} accessible accessibilityRole="image" accessibilityLabel={t('job.title')} /> : <InlineMedia url={file.url} audio={!file.mime_type.startsWith('video/')} label={t(file.mime_type.startsWith('video/') ? 'job.playVideo' : 'job.playAudio')} />}<GeneratedChip /></>
                : result.state === 'failed' ? <Text tone="danger">{result.job?.error_code === 'user_cancelled'
                    ? failure : failedJobMessage(result.job?.error_code, refunded, failure)}</Text>
                : <><View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><VeyCharacter width={batchTile ? 40 : 48} mood="working" /></View><Text style={styles.centred}>{t(result.state === 'queued' ? 'job.queued' : 'job.running')}</Text><GenerationProgress jobId={id} modelId={batch.modelId} kind={batch.kind} compact={batchTile} leaveNote={false} /><Text style={styles.centred}>{t('job.keepsRunning')}</Text></>}
        </View>
        <Button variant="secondary" label={t('publishReporting.open')} onPress={open} />
        {sound?.kind === 'tooLong' ? <Text>{t('libraryCreate.soundTooLong', { seconds: String(sound.seconds) })}</Text> : sound ? <Card>
            <Text variant="caption">{t('libraryCreate.soundEyebrow')}</Text><Text accessibilityRole="header" variant="title3">{t('libraryCreate.soundTitle')}</Text>
            <Text>{t('libraryCreate.soundHelp')}</Text><Button label={t('libraryCreate.soundAction')} onPress={addSound} />
        </Card> : null}
    </Card>;
}
const COST_RISE = 6;
// The cost figure on the Create form: when a setting changes the price, the new figure fades in and rises into place.
// Presentation only; with reduced motion the figure simply changes.
export function CostTick({ value, children }: { value: number; children: ReactNode }) {
    const reduced = useReducedMotion();
    const tick = useRef(new Animated.Value(1)).current;
    const shown = useRef(value);
    // A layout effect, so the new figure is hidden before it is painted (no one-frame flash at full opacity).
    useLayoutEffect(() => {
        if (shown.current === value) return;
        shown.current = value;
        if (reduced) return;
        tick.setValue(0);
        const run = Animated.timing(tick, { toValue: 1, duration: ds.motion.state, easing: Easing.out(Easing.cubic), useNativeDriver: true });
        run.start();
        return () => { run.stop(); tick.setValue(1); };
    }, [value, reduced, tick]);
    return <Animated.View style={{ opacity: tick, transform: [{ translateY: tick.interpolate({ inputRange: [0, 1], outputRange: [COST_RISE, 0] }) }] }}>{children}</Animated.View>;
}
const sheets = themedStyles(p => ({
    single: { gap: 12 }, grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    card: { padding: 8, gap: 8 }, tile: { width: '48%' }, frame: { width: '100%', justifyContent: 'center', alignItems: 'center', overflow: 'hidden', backgroundColor: p.bgElevated1 },
    image: { width: '100%', height: '100%' },
    // The progress lines sit under the centred character and title, so they centre too.
    centred: { textAlign: 'center', paddingHorizontal: 8 },
}));
