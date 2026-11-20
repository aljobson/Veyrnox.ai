import { useEffect, useState } from 'react';
import { ScrollView, Switch, View } from 'react-native';
import { Text, Chip } from '../ui';
import { BEST_CUT_LANGUAGES } from '../../lib/bestCutPlan';
import { readBestCutSettings, writeBestCutSettings, type BestCutSettings as Settings } from '../../lib/bestCutSettings';
import { t } from '../../lib/i18n';
import { languageFlag } from '../../lib/language';
export function BestCutSettings({ onChange, disabled = false, showTitle = true }: { disabled?: boolean; showTitle?: boolean; onChange?: (value: Settings) => void }) {
    const [value, setValue] = useState<Settings>({ captions: true, language: 'auto' });
    useEffect(() => { let live = true; void readBestCutSettings().then(v => { if (live) { setValue(v); onChange?.(v); } }); return () => { live = false; }; }, [onChange]);
    const change = (v: Settings) => { setValue(v); onChange?.(v); void writeBestCutSettings(v).catch(() => {}); };
    return <View style={{ gap: 10 }}>{showTitle ? <Text variant="title3">{t('bestCut.settings')}</Text> : null}
        <Text>{t('bestCut.captions')}</Text><Switch disabled={disabled} accessibilityLabel={t('bestCut.captions')} value={value.captions} onValueChange={captions => change({ ...value, captions })} />
        <Text>{t('bestCut.language')}</Text><ScrollView horizontal contentContainerStyle={{ gap: 8 }}>
            {['auto', ...BEST_CUT_LANGUAGES].map(language => {
                const label = language === 'auto' ? t('bestCut.auto') : t(`bestCut.language.${language}`);
                const flag = languageFlag(language);
                const on = value.language === language;
                // The flag is decoration: the chip's own label (the plain name) is what VoiceOver reads.
                return <Chip disabled={disabled} key={language} selected={on} label={label} onPress={() => change({ ...value, language })}>
                    {flag ? <Text variant="caption" testID={`best-cut-flag-${language}`} accessible={false} accessibilityElementsHidden importantForAccessibility="no">{flag}</Text> : null}
                    <Text variant="caption" tone={on ? 'primary' : 'secondary'}>{label}</Text>
                </Chip>;
            })}
        </ScrollView></View>;
}
