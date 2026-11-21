import { View } from 'react-native';
import { TRANSITIONS, TRANSITION_CATEGORIES } from '../../../../../../app/veyrnox/_lib/editorEffects.mjs';
import { t, formatNumber } from '../../../lib/i18n';
import { adjacent } from '../../../lib/editorLookEdit';
import { ds } from '../../../theme';
import { Slider } from './Slider';
import { LookChoice, LookMessage, type LookContentProps } from './LookPanels';
export function TransitionsPanel({ timeline, clip, actions, disabled }: LookContentProps) {
    const selected = !clip.transition ? 'none' : clip.transitionType ?? 'dissolve';
    return <View style={{ gap: ds.space.md }}>
        <LookChoice label={t('editorLook.transition')} value={selected} disabled={disabled} onChange={actions.transitionNone}
            options={[{ value: 'none', label: t('editorLook.noTransition') }]} />
        {TRANSITION_CATEGORIES.filter(category => category !== 'All').map(category => <LookChoice key={category}
            label={t(`editorLook.category.${category}`)} value={selected} disabled={disabled} onChange={actions.transition}
            options={TRANSITIONS.filter(item => item.category === category).map(item => ({ value: item.id, label: t(`editorLook.transition.${item.id}`) }))} />)}
        {clip.transitionType === 'slide' ? <LookChoice label={t('editorLook.transition')} value={selected} disabled={disabled}
            onChange={actions.transition} options={[{ value: 'slide', label: t('editorLook.transition.slide') }]} /> : null}
        <LookMessage>{t('editorLook.export')}</LookMessage>
        {!adjacent(timeline, clip.id) ? <LookMessage>{t('editorLook.notAdjacent')}</LookMessage> : null}
        <Slider label={t('editorLook.duration')} value={clip.transition || 15} min={1} max={60} step={1} disabled={disabled || selected === 'none'}
            format={value => t('editorTools.secondsValue', { value: formatNumber(value / timeline.fps, 2) })} onChange={actions.transitionLength} />
    </View>;
}
