import { View } from 'react-native';
import { BACKGROUND_DEFAULTS } from '../../../../../../app/veyrnox/_lib/editorBackground.mjs';
import { t } from '../../../lib/i18n';
import { ds } from '../../../theme';
import type { Background } from '../../../lib/editorLookEdit';
import { Action } from '../EditorControls';
import { Slider } from './Slider';
import { ColourField } from './ColourField';
import { LookChoice, LookMessage, number, type LookContentProps } from './LookPanels';
export function ClipBackgroundSection({ timeline, clip, actions, disabled }: LookContentProps) {
    const background = (clip.background ?? BACKGROUND_DEFAULTS) as Background;
    const images = Object.values(timeline.media).filter(m => m.kind === 'image' || m.kind === 'graphic');
    const types = images.length ? ['none', 'solid', 'blur', 'image'] : ['none', 'solid', 'blur'];
    return <View style={{ gap: ds.space.md }}>
        <LookChoice label={t('editorLook.background')} value={background.type} disabled={disabled}
            options={types.map(id => ({ value: id, label: t(`editorLook.background.${id}`) }))}
            onChange={type => actions.background({ type: type as Background['type'] })} />
        {background.type !== 'none' ? disabled ? <LookMessage>{t('editorLook.backgroundColour')}: {background.color}</LookMessage>
            : <ColourField label={t('editorLook.backgroundColour')} value={background.color} swatches={[timeline.background]}
                onChange={color => actions.background({ color })} /> : null}
        {background.type === 'blur' ? <Slider label={t('editorLook.parameter.blur')} value={background.blur} min={0} max={60} step={1}
            disabled={disabled} format={number} onChange={blur => actions.background({ blur })} /> : null}
        {background.type === 'image' && images.length ? <LookChoice label={t('editorLook.backgroundImage')} value={background.mediaId}
            disabled={disabled} options={images.map(m => ({ value: m.id, label: (m.name ?? m.id).slice(0, 40) }))}
            onChange={mediaId => actions.background({ mediaId })} /> : null}
        {!images.length ? <LookMessage>{t('editorLook.noImages')}</LookMessage> : null}
        <Action label={t('editorLook.applyAll')} disabled={disabled} onPress={() => actions.backgroundAll(background)} />
    </View>;
}
