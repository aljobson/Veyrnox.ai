import { useEffect, useState } from 'react';
import { ScrollView, Switch, View } from 'react-native';
import { Text, Chip } from '../ui';
import { BEST_CUT_LANGUAGES } from '../../lib/bestCutPlan';
import { readBestCutSettings, writeBestCutSettings, type BestCutSettings as Settings } from '../../lib/bestCutSettings';
import { t } from '../../lib/i18n';
export function BestCutSettings({ onChange, disabled = false }: { disabled?: boolean; onChange?: (value: Settings) => void }) {
    const [value, setValue] = useState<Settings>({ captions: true, language: 'auto' });
    useEffect(() => { let live = true; void readBestCutSettings().then(v => { if (live) { setValue(v); onChange?.(v); } }); return () => { live = false; }; }, [onChange]);
    const change = (v: Settings) => { setValue(v); onChange?.(v); void writeBestCutSettings(v).catch(() => {}); };
    return <View style={{ gap: 10 }}><Text variant="title3">{t('bestCut.settings')}</Text>
        <Text>{t('bestCut.captions')}</Text><Switch disabled={disabled} accessibilityLabel={t('bestCut.captions')} value={value.captions} onValueChange={captions => change({ ...value, captions })} />
        <Text>{t('bestCut.language')}</Text><ScrollView horizontal contentContainerStyle={{ gap: 8 }}>
            {['auto', ...BEST_CUT_LANGUAGES].map(language => <Chip disabled={disabled} key={language} selected={value.language === language} label={language === 'auto' ? t('bestCut.auto') : t(`bestCut.language.${language}`)} onPress={() => change({ ...value, language })} />)}
        </ScrollView></View>;
}
