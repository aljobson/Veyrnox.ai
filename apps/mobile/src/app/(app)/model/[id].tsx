import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Button, Card, Text, themedStyles, useThemedStyles } from '../../../components/ui';
import { fetchCatalog, type CatalogModel } from '../../../lib/media';
import { modelFacts, priceUnit } from '../../../lib/modelFacts';
import { t } from '../../../lib/i18n';
import { MIN_TARGET } from '../../../lib/a11y';
import { LIST_END_PADDING } from '../../../theme';

export default function ModelDetail() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const styles = useThemedStyles(sheets);
    const [models, setModels] = useState<CatalogModel[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        let live = true;
        setFailed(false);
        setModels(null);
        fetchCatalog().then(
            next => { if (live) setModels(next); },
            () => { if (live) setFailed(true); },
        );
        return () => { live = false; };
    }, [attempt]);
    const model = typeof id === 'string' ? models?.find(m => m.id === id) : undefined;
    const all = <Button variant="secondary" label={t('modelPage.all')} onPress={() => router.push('/models')} style={styles.target} />;
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Stack.Screen options={{ title: model?.name ?? t('mdl.title') }} />
            {failed ? <>
                <Text accessibilityRole="alert">{t('catalog.failed')}</Text>
                <Button label={t('acct.mfa.retry')} onPress={() => setAttempt(n => n + 1)} style={styles.target} />
            </> : !models ? <ActivityIndicator accessibilityLabel={t('catalog.loading')} /> : !model ? <>
                <Text>{t('modelPage.unavailable')}</Text>
                {all}
            </> : <>
                {all}
                <Text variant="title1" accessibilityRole="header">{model.name}</Text>
                <Text variant="title2">{t('modelPage.price', { credits: model.credits })}</Text>
                <Text tone="secondary">{priceUnit(model)}</Text>
                <Button label={`${t('modelPage.generate', { title: model.name })} · ${t('modelPage.price', { credits: model.credits })}`}
                    accessibilityLabel={t('modelPage.generateLabel', { title: model.name, credits: model.credits })}
                    onPress={() => router.push({ pathname: '/create/[modelId]', params: { modelId: model.id } })} style={styles.target} />
                <Button variant="secondary" label={t('modelPage.packs')} onPress={() => router.push('/pricing')} style={styles.target} />
                <Text variant="footnote" tone="secondary">{t('modelPage.note')}</Text>
                <Card style={styles.facts}>
                    {modelFacts(model).map((fact, index) => <View key={index} accessible accessibilityLabel={`${fact.label}: ${fact.value}`} style={styles.fact}>
                        <Text variant="bodyStrong">{fact.label}</Text>
                        <Text tone="secondary">{fact.value}</Text>
                    </View>)}
                </Card>
            </>}
        </ScrollView>
    );
}

const sheets = themedStyles(p => ({
    screen: { flex: 1, backgroundColor: p.bg },
    content: { padding: 16, paddingBottom: 16 + LIST_END_PADDING, gap: 16 },
    target: { minHeight: MIN_TARGET },
    facts: { gap: 16 },
    fact: { gap: 4 },
}));
