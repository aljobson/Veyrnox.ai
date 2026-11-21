import { View } from 'react-native';
import { Button, Text } from '../ui';
import { t } from '../../lib/i18n';
import { RENDER_OPERATIONS, stepRenderValue, type RenderForm } from '../../lib/music/renderForm';

export function MusicRenderForm({ form, duration, reverse, locked, edit }: {
    form: RenderForm; duration: number | null; reverse: boolean; locked: boolean; edit(patch: Partial<RenderForm>): void;
}) {
    const stepper = (field: 'fadeIn' | 'fadeOut' | 'speed' | 'split', min: number, max: number, step: number) => {
        const label = t(`musicRender.${field}`), value = form[field];
        const disabled = locked || ((field === 'fadeIn' || field === 'fadeOut' || field === 'split') && duration === null);
        return <View key={field}>
            <Text>{label}</Text><Text accessibilityLiveRegion="polite">{value.toFixed(step === 0.05 ? 2 : 1)}</Text>
            <Button variant="secondary" label={t('musicRender.less', { field: label })} disabled={disabled || value <= min}
                onPress={() => edit({ [field]: stepRenderValue(value, step, -1, min, max) })} />
            <Button variant="secondary" label={t('musicRender.more', { field: label })} disabled={disabled || value + step > max}
                onPress={() => edit({ [field]: stepRenderValue(value, step, 1, min, max) })} />
        </View>;
    };
    return <>
        <View accessibilityRole="radiogroup" accessibilityLabel={t('musicRender.operation')}>
            {RENDER_OPERATIONS.filter(op => op !== 'reverse' || reverse).map(operation => <Button key={operation}
                variant="secondary" accessibilityRole="radio" accessibilityState={{ checked: form.operation === operation }}
                label={t(`musicRender.${operation}`)} disabled={locked || (duration === null && (operation === 'fade' || operation === 'reorder'))}
                onPress={() => edit({ operation })} />)}
        </View>
        {form.operation === 'fade' ? <>{stepper('fadeIn', 0, 30, 0.5)}{stepper('fadeOut', 0, 30, 0.5)}</> : null}
        {form.operation === 'speed' ? <>{stepper('speed', 0.5, 2, 0.05)}<Text>{t('musicRender.speedHint')}</Text></> : null}
        {form.operation === 'reorder' ? <>{stepper('split', 1, Math.min(86399, Math.max(1, (duration ?? 2) - 1)), 0.5)}<Text>{t('musicRender.reorderHint')}</Text></> : null}
        {form.operation === 'remaster' ? <>
            <View accessibilityRole="radiogroup" accessibilityLabel={t('musicRender.peak')}>
                <Text>{t('musicRender.peak')}</Text>
                {[-3, -2, -1].map(peak => <Button key={peak} variant="secondary" accessibilityRole="radio"
                    accessibilityState={{ checked: form.peak === peak }} label={`${peak} dBFS`} disabled={locked} onPress={() => edit({ peak })} />)}
            </View><Text>{t('musicRender.remasterHint')}</Text>
        </> : null}
        {form.operation === 'reverse' ? <Text>{t('musicRender.reverseHint')}</Text> : null}
    </>;
}
