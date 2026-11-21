import { Text, View } from 'react-native';
import { ds } from '../../../theme';
import { t, formatNumber } from '../../../lib/i18n';
import { AUDIO_DEFAULTS, AUDIO_EFFECT_DEFAULTS, audioSectionsVisible } from '../../../lib/editorAudioEdit';
import type { Clip, Media } from '../../../lib/nativeEditorModel';
import { Action, Choice } from '../EditorControls';
import { styles } from '../fullEditorStyles';
import { Disclosure } from './Disclosure';
import { Slider } from './Slider';
import { SegmentedChoice } from './SegmentedChoice';
import type { AudioSettingsActions } from './useAudioSettingsActions';
export function AudioSettingsSection({ clip, media, track, actions }: { clip: Clip; media?: Media; track: 'video' | 'audio'; actions: AudioSettingsActions }) {
    const eq = { low: 0, mid: 0, high: 0, ...clip.eq }, processing = { ...AUDIO_DEFAULTS, ...clip.audioProcessing };
    const effects = { ...AUDIO_EFFECT_DEFAULTS, ...clip.audioEffects };
    const db = (value: number) => t('editorAudioTools.db', { value: formatNumber(value, 0) });
    const percent = (value: number) => t('editorAudioTools.percent', { value: formatNumber(value * 100, 0) });
    const seconds = (value: number) => t('editorAudioTools.seconds', { value: formatNumber(value, 2) });
    const process = (patch: Partial<typeof processing>) => actions.patch({ audioProcessing: { ...processing, ...patch } });
    const effect = (patch: Partial<typeof effects>) => actions.patch({ audioEffects: { ...effects, ...patch } });
    const sourceSeconds = (media?.frames ?? 0) / 30;
    return <View style={{ gap: ds.space.sm }}>
        {track === 'audio' ? <Text style={styles.body}>{t('editorAudioTools.adjustAudioLaneNote')}</Text> :
            media?.kind !== 'image' && audioSectionsVisible(clip, media) ? <Text style={styles.body}>{t('editorAudioTools.previewNote')}</Text> : null}
        <Disclosure title={t('editorAudioTools.equaliser')}>
            {([{ key: 'low', label: t('editorAudioTools.low') }, { key: 'mid', label: t('editorAudioTools.mid') },
                { key: 'high', label: t('editorAudioTools.high') }] as const).map(({ key, label }) =>
                <Slider key={key} label={label} value={eq[key]} min={-24} max={24} step={1} snaps={[0]} format={db}
                    onChange={value => actions.patch({ eq: { ...eq, [key]: value } })} />)}
        </Disclosure>
        {audioSectionsVisible(clip, media) ? <>
            <Disclosure title={t('editorAudioTools.processing')}>
                <Choice label={t('editorAudioTools.keepPitch')} selected={!!clip.preservePitch} onPress={() => actions.patch({ preservePitch: !clip.preservePitch })} />
                <SegmentedChoice label={t('editorAudioTools.voice')} value={processing.voice} options={[
                    { value: 'none', label: t('editorAudioTools.none') }, { value: 'deep', label: t('editorAudioTools.deep') },
                    { value: 'bright', label: t('editorAudioTools.bright') }, { value: 'radio', label: t('editorAudioTools.radio') },
                    { value: 'robot', label: t('editorAudioTools.robot') }]} onChange={voice => process({ voice })} />
                <Slider label={t('editorAudioTools.pitch')} value={processing.pitch} min={-12} max={12} step={1}
                    format={value => t('editorAudioTools.semitones', { value: formatNumber(value, 0) })} onChange={pitch => process({ pitch })} />
                <Slider label={t('editorAudioTools.noiseReduction')} value={processing.noiseReduction} min={0} max={1} step={.01}
                    format={percent} onChange={noiseReduction => process({ noiseReduction })} />
                <Slider label={t('editorAudioTools.noiseStart')} value={processing.noiseStart} min={0} max={Math.max(0, sourceSeconds - processing.noiseLength)}
                    step={.01} format={seconds} onChange={noiseStart => process({ noiseStart })} />
                <Action label={t('editorAudioTools.usePlayhead')} onPress={actions.usePlayhead} />
                <Slider label={t('editorAudioTools.noiseLength')} value={processing.noiseLength} min={.05} max={2} step={.05}
                    format={seconds} onChange={noiseLength => process({ noiseLength })} />
                <Text style={styles.body}>{t('editorAudioTools.noiseHelp')}</Text>
                <Slider label={t('editorAudioTools.gate')} value={processing.gateDb} min={-96} max={-6} step={1}
                    format={value => value === -96 ? t('editorAudioTools.off') : db(value)} onChange={gateDb => process({ gateDb })} />
                <Action label={t('editorAudioTools.applyAll')} onPress={() => actions.applyAll(processing)} />
                <Action label={t('editorAudioTools.resetProcessing')} onPress={() => actions.patch({ audioProcessing: { ...AUDIO_DEFAULTS }, preservePitch: false })} />
            </Disclosure>
            <Disclosure title={t('editorAudioTools.effects')}>
                <Slider label={t('editorAudioTools.width')} value={effects.width} min={0} max={2} step={.01} format={percent} onChange={width => effect({ width })} />
                <Slider label={t('editorAudioTools.tremoloRate')} value={effects.tremoloRate} min={.1} max={20} step={.1}
                    format={value => t('editorAudioTools.hz', { value: formatNumber(value, 1) })} onChange={tremoloRate => effect({ tremoloRate })} />
                <Slider label={t('editorAudioTools.tremoloDepth')} value={effects.tremoloDepth} min={0} max={1} step={.01}
                    format={percent} onChange={tremoloDepth => effect({ tremoloDepth })} />
                <Slider label={t('editorAudioTools.echoDelay')} value={effects.echoDelay} min={.01} max={1} step={.01}
                    format={seconds} onChange={echoDelay => effect({ echoDelay })} />
                <Slider label={t('editorAudioTools.echoRepeats')} value={effects.echoRepeats} min={1} max={8} step={1}
                    format={value => formatNumber(value, 0)} onChange={echoRepeats => effect({ echoRepeats })} />
                <Slider label={t('editorAudioTools.echoDecay')} value={effects.echoDecay} min={.05} max={.9} step={.01}
                    format={percent} onChange={echoDecay => effect({ echoDecay })} />
                <Slider label={t('editorAudioTools.echoMix')} value={effects.echoMix} min={0} max={1} step={.01} format={percent} onChange={echoMix => effect({ echoMix })} />
                <Text style={styles.body}>{t('editorAudioTools.echoHelp')}</Text>
                <Action label={t('editorAudioTools.resetEffects')} onPress={() => actions.patch({ audioEffects: { ...AUDIO_EFFECT_DEFAULTS } })} />
            </Disclosure>
        </> : null}
    </View>;
}
