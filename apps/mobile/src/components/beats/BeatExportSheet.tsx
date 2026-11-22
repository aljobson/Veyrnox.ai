import { useState } from 'react';
import { router } from 'expo-router';
import { View } from 'react-native';
import { Button, Checkbox, Text, TextField, themedStyles, useThemedStyles } from '../ui';
import { BeatModal } from './BeatModal';
import { t } from '../../lib/i18n';
import { ds } from '../../theme';
import type { BeatDoc } from '../../lib/beatNative/doc';
import { mixdownSources, mixTailSeconds, patternTailSeconds, type ExportOptions } from '../../lib/beatNative/exportShared';
import { useBeatExport } from '../../lib/beatNative/useBeatExport';
import { validMixdownTitle } from '../../lib/beatNative/mixdownSave';
import type { NativeHeldAssets } from '../../lib/beatNative/nativeHeldAssets';

function Choices<T extends string>({ label, value, options, disabled, onChange }: {
    label: string; value: T; options: { value: T; label: string; disabled?: boolean }[]; disabled: boolean; onChange(value: T): void;
}) {
    const s = useThemedStyles(sheets);
    return <View accessibilityRole="radiogroup" accessibilityLabel={label} style={s.group}>
        <Text variant="bodyStrong">{label}</Text>
        <View style={s.choices}>{options.map(option => <Button key={option.value} label={option.label} accessibilityLabel={`${label}: ${option.label}`}
            accessibilityRole="radio" accessibilityState={{ checked: value === option.value, disabled: disabled || option.disabled }}
            disabled={disabled || option.disabled} variant={value === option.value ? 'primary' : 'secondary'} onPress={() => onChange(option.value)} />)}</View>
    </View>;
}
export function BeatExportSheet({ doc, recording, replacing = false, prepare, heldAssets, onClose }: { doc: BeatDoc; recording: boolean; replacing?: boolean; prepare(): Promise<void>; heldAssets: NativeHeldAssets; onClose(): void }) {
    const [options, setOptions] = useState<ExportOptions>({ kind: 'song', loops: 1, range: 'song', output: 'mix', bitDepth: 16,
        editTrackId: doc.tracks.find(track => !track.kind || track.kind === 'drums')?.id });
    const [title, setTitle] = useState(doc.title), [rights, setRights] = useState(false);
    const x = useBeatExport(doc, prepare, recording, replacing, heldAssets);
    const patch = (change: Partial<ExportOptions>) => {
        if (change.range !== undefined && change.range !== options.range) x.resetSaved();
        setOptions(value => ({ ...value, ...change }));
    };
    const empty = !doc.tracks.some(track => track.regions.length);
    const blocked = x.busy || recording || replacing || x.state === 'opening' || x.state === 'unavailable';
    const song = options.kind === 'song';
    let hasTakes = false, sourcesValid = true;
    try { hasTakes = mixdownSources(doc, { range: options.range }).hasTakes; } catch { sourcesValid = false; }
    const tail = song ? mixTailSeconds(doc) : patternTailSeconds(doc, doc.tracks.find(track => track.id === options.editTrackId));
    const close = () => { if (!x.busy) onClose(); };
    return <BeatModal title={t('beatExport.title')} onClose={close}>
        <Choices label={t('beatExport.kind')} value={options.kind} disabled={x.busy}
            options={[{ value: 'song', label: t('beatExport.song') }, { value: 'pattern', label: t('beatExport.pattern') }]} onChange={kind => patch({ kind })} />
        {song ? <>
            <Choices label={t('beatExport.range')} value={options.range} disabled={x.busy}
                options={[{ value: 'song', label: t('beatExport.whole') }, { value: 'cycle', label: t('beatExport.cycle'), disabled: !doc.cycle.on }]} onChange={range => patch({ range })} />
            {!doc.cycle.on && <Text variant="footnote" tone="secondary">{t('beatExport.cycleHint')}</Text>}
            <Choices label={t('beatExport.output')} value={options.output} disabled={x.busy}
                options={[{ value: 'mix', label: t('beatExport.mix') }, { value: 'stems', label: t('beatExport.stems') }]} onChange={output => patch({ output })} />
            <Choices label={t('beatExport.depth')} value={String(options.bitDepth)} disabled={x.busy}
                options={[16, 24].map(depth => ({ value: String(depth), label: t('beatExport.bits', { depth }) }))} onChange={depth => patch({ bitDepth: Number(depth) as 16 | 24 })} />
        </> : <Choices label={t('beatExport.loops')} value={String(options.loops)} disabled={x.busy}
            options={[1, 2, 4, 8].map(loops => ({ value: String(loops), label: t('beatExport.loopCount', { count: loops }) }))} onChange={loops => patch({ loops: Number(loops) })} />}
        <Text variant="footnote" tone="secondary">{t('beatExport.tail', { seconds: tail.toFixed(1) })}</Text>
        {recording && <Text accessibilityLiveRegion="polite">{t('beatExport.recording')}</Text>}
        {replacing && <Text accessibilityLiveRegion="polite">{t('beatTakes.replacing')}</Text>}
        {song && empty && <Text>{t('beatExport.empty')}</Text>}
        {x.state === 'opening' && <Text>{t('beatExport.opening')}</Text>}
        {x.state === 'ready' && <Text>{t('beatExport.ready')}</Text>}
        {x.state === 'unavailable' && <Text accessibilityRole="alert">{t('beatExport.unavailable')}</Text>}
        {x.message && <Text accessibilityLiveRegion="polite" accessibilityRole={x.state === 'error' ? 'alert' : undefined}>{x.message}</Text>}
        {x.busy && <View accessible accessibilityRole="progressbar" accessibilityLabel={x.message || t('beatExport.opening')}
            accessibilityValue={{ min: 0, max: 100, now: x.percent }} />}
        <Button label={t(x.state === 'error' && x.failedAction === 'share' ? 'beatExport.retryShare' : 'beatExport.render')} disabled={blocked || (song && empty) || (!song && !options.editTrackId)} onPress={() => void x.run(options)} />
        {x.offline && <Text>{t('beatExport.offline')}</Text>}
        {x.probe === 'off' ? <Text variant="footnote" tone="secondary">{t('beatExport.saveOff')}</Text> : song && x.foreign ? <Text>{t('beatExport.otherAccount')}</Text> : song && <>
            {x.probe === 'opening' ? <Text>{t('beatExport.saveOpening')}</Text> : x.probe !== 'on' ? <>
                <Text>{t(x.probe === 'signedOut' ? 'beatExport.signIn' : x.probe === 'offline' ? 'beatExport.offline' : 'beatExport.saveError')}</Text>
                <Button label={t('beat.retry')} disabled={x.busy} onPress={() => void x.retryProbe()} />
            </> : <>
                <TextField label={t('beatExport.songTitle')} accessibilityLabel={t('beatExport.songTitle')} value={title} onChangeText={value => { if (value !== title) x.resetSaved(); setTitle(value); }} editable={!x.busy}
                    error={validMixdownTitle(title) ? undefined : t('beatExport.titleInvalid')} />
                {hasTakes && <Checkbox checked={rights} onChange={setRights} disabled={x.busy} accessibilityLabel={t('beatExport.rights')}><Text>{t('beatExport.rights')}</Text></Checkbox>}
                <Text variant="footnote" tone="secondary">{t('beatExport.saveFormat')}</Text>
                <Button label={t(x.state === 'error' && x.failedAction === 'save' ? 'beatExport.retrySave' : 'beatExport.save')} disabled={blocked || !!x.saved || empty || x.offline || !sourcesValid || !validMixdownTitle(title) || (hasTakes && !rights)} onPress={() => void x.run(options, { title, rights })} />
            </>}
        </>}
        {x.saved && <Button label={t('beatExport.openMusic')} onPress={() => { close(); router.push({ pathname: '/music/[id]', params: { id: x.saved!.song_id } }); }} />}
        <Button label={t('common.close')} variant="secondary" disabled={x.busy} onPress={close} />
    </BeatModal>;
}
const sheets = themedStyles(() => ({ group: { gap: ds.space.sm }, choices: { flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.sm } }));
