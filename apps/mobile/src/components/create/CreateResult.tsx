import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Text, Button, Card, themedStyles, useThemedStyles } from '../ui';
import { InlineMedia } from '../InlineMedia';
import { GeneratedChip } from '../library/GeneratedChip';
import { useJobResult, soundPassFor } from '../../lib/createResult';
import { stageCreativeSourceHandoff } from '../../lib/creativeSourceHandoff';
import { celebrateOutput } from '../../lib/celebrate';
import { parseRatio } from '../../lib/templateHandoff';
import type { ApiClient } from '../../lib/api';
import type { CatalogModel, Kind } from '../../lib/media';
import { plural, t } from '../../lib/i18n';

export interface ResultBatch {
    ids: string[]; modelId: string; kind: Kind | null; aspect: string | null; duration: number | null; count: number;
}
export function CreateResult({ api, batch, catalog, onTerminal }: { api: ApiClient; batch: ResultBatch; catalog: CatalogModel[]; onTerminal: () => void }) {
    const styles = useThemedStyles(sheets);
    const celebrated = useRef(false);
    const celebrate = (id: string, mime: string) => { if (!celebrated.current) { celebrated.current = true; celebrateOutput(id, mime, true); } };
    return <View style={batch.count > 1 ? styles.grid : styles.single}>{batch.ids.map(id => <ResultTile key={id} api={api} id={id} batch={batch} catalog={catalog} onTerminal={onTerminal} onSuccess={celebrate} />)}</View>;
}
function ResultTile({ api, id, batch, catalog, onTerminal, onSuccess }: { api: ApiClient; id: string; batch: ResultBatch; catalog: CatalogModel[]; onTerminal: () => void; onSuccess: (id: string, mime: string) => void }) {
    const styles = useThemedStyles(sheets);
    const router = useRouter();
    const result = useJobResult(api, id);
    const success = useRef(onSuccess); success.current = onSuccess;
    const callback = useRef(onTerminal); callback.current = onTerminal;
    const [seconds, setSeconds] = useState(0);
    const terminal = result.state === 'succeeded' || result.state === 'failed';
    const refunded = result.job?.refunded;
    useEffect(() => { if (terminal && result.job) callback.current(); }, [terminal, !!result.job, refunded]);
    useEffect(() => { if (result.asset) success.current(id, result.asset.mime_type); }, [id, result.asset]);
    useEffect(() => {
        if (terminal) return;
        const timer = setInterval(() => setSeconds(s => s + 1), 1000);
        return () => clearInterval(timer);
    }, [terminal]);
    const file = result.asset;
    const batchTile = batch.count > 1;
    const open = () => router.push({ pathname: '/job/[id]', params: { id } });
    const sound = !batchTile ? soundPassFor({ catalog, modelId: batch.modelId, durationSeconds: batch.duration, result }) : null;
    function addSound() {
        const sourceHandoff = stageCreativeSourceHandoff({ recipe: 'sound-pass', modelId: 'mmaudio-v2-video', uploaded: {}, fromLibrary: {}, references: [{ slot: 'video', origin: 'asset', asset_id: id }] });
        router.push({ pathname: '/create/[modelId]', params: { modelId: 'mmaudio-v2-video', recipe: 'sound-pass', sourceHandoff, prompt: t('libraryCreate.soundPrompt') } });
    }
    const failure = refunded === true ? result.job?.credits ? plural('library.refunded', result.job.credits) : t('library.refundedFree') : t('library.status.failed');
    return <Card style={[styles.card, batchTile && styles.tile]}>
        <View style={[styles.frame, batchTile ? { aspectRatio: 1 } : batch.kind === 'audio' ? { height: 120 } : { aspectRatio: parseRatio(batch.aspect) ?? (batch.kind === 'video' ? 16 / 9 : 1) }]}>
            {result.held ? <><Text accessibilityRole="header">{t('library.status.held')}</Text><Text>{t('libraryCreate.heldBody')}</Text></>
                : result.error ? <Text tone="danger">{t('job.checkError')}</Text>
                : file ? <>{file.output_stems?.length ? <Text>{t('libraryCreate.stems')}</Text> : file.mime_type.startsWith('image/') ? <Image source={{ uri: file.url }} cachePolicy="memory" contentFit="contain" style={styles.image} accessibilityLabel={t('job.title')} /> : <InlineMedia url={file.url} audio={!file.mime_type.startsWith('video/')} label={t(file.mime_type.startsWith('video/') ? 'job.playVideo' : 'job.playAudio')} />}<GeneratedChip /></>
                : result.state === 'failed' ? <Text tone="danger">{failure}</Text>
                : <><ActivityIndicator /><Text>{t(result.state === 'queued' ? 'job.queued' : 'job.running')}</Text><Text>{t('job.waiting', { elapsed: t('libraryCreate.elapsed', { seconds: String(seconds) }) })}</Text><Text>{t('job.keepsRunning')}</Text></>}
        </View>
        <Button variant="secondary" label={t('publishReporting.open')} onPress={open} />
        {sound?.kind === 'tooLong' ? <Text>{t('libraryCreate.soundTooLong', { seconds: String(sound.seconds) })}</Text> : sound ? <Card>
            <Text variant="caption">{t('libraryCreate.soundEyebrow')}</Text><Text accessibilityRole="header" variant="title3">{t('libraryCreate.soundTitle')}</Text>
            <Text>{t('libraryCreate.soundHelp')}</Text><Button label={t('libraryCreate.soundAction')} onPress={addSound} />
        </Card> : null}
    </Card>;
}
const sheets = themedStyles(p => ({
    single: { gap: 12 }, grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    card: { padding: 8, gap: 8 }, tile: { width: '48%' }, frame: { width: '100%', justifyContent: 'center', alignItems: 'center', overflow: 'hidden', backgroundColor: p.bgElevated1 },
    image: { width: '100%', height: '100%' },
}));
