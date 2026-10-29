import { rawText } from '../../lib/i18n/translate';
import { Link, Stack } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { Card, Icon, Text, themedStyles, useThemedStyles } from '../../components/ui';
import { CatalogList, kindTitleKey } from '../../components/CatalogList';
import { needs, priceLines } from '../../lib/catalogPages';
import { t } from '../../lib/i18n';
import { LIST_END_PADDING } from '../../theme';

// Open and gated catalog rows share their kind group and link to model details.
export default function Models() {
    const styles = useThemedStyles(sheets);
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Stack.Screen options={{ title: t('mdl.title') }} />
            <Text variant="footnote" tone="secondary">{t('mdl.intro')}</Text>
            <CatalogList includeGated render={group => <>
                <Text variant="title3" accessibilityRole="header">{t(kindTitleKey(group.kind))}</Text>
                {group.models.map(model => {
                    const extra = needs(model);
                    const from = priceLines(model)[0].credits;
                    return <Link key={model.id} href={`/model/${encodeURIComponent(model.id)}`} asChild>
                        <Card style={styles.row} accessibilityRole="button"
                            accessibilityLabel={rawText(`${t('mdl.rowLabel', { name: model.name, credits: from })}${model.gated ? `, ${t('projectHome.premium')}` : ''}`)}>
                            <Text variant="bodyStrong">{model.name}</Text>
                            {model.gated ? <View style={styles.tag}>
                                <Icon name="sparkleFill" size={20} /><Text>{t('projectHome.premium')}</Text>
                            </View> : null}
                            <Text variant="footnote" tone="secondary">
                                {t('mdl.from', { credits: from })}
                                {extra.length ? ` · ${t('mdl.needs', { items: extra.join(', ') })}` : ''}
                            </Text>
                        </Card>
                    </Link>;
                })}
            </>} />
        </ScrollView>
    );
}

const sheets = themedStyles(p => ({
    screen: { flex: 1, backgroundColor: p.bg },
    content: { padding: 16, paddingBottom: 16 + LIST_END_PADDING, gap: 20 },
    row: { minHeight: 44, padding: 14, gap: 4 },
    tag: { flexDirection: 'row', alignItems: 'center', gap: 8 },
}));
