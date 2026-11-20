import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Button, Card, Text, themedStyles, useThemedStyles } from '../../../components/ui';
import { fetchCatalog, type CatalogModel } from '../../../lib/media';
import { fetchPremiumModels } from '../../../lib/premiumModels';
import { canCompare, compareRows } from '../../../lib/modelCompare';
import { internalModelId } from '../../../lib/publicModelIds';
import { t } from '../../../lib/i18n';
import { rawText } from '../../../lib/i18n/translate';
import { MIN_TARGET } from '../../../lib/a11y';
import { LIST_END_PADDING } from '../../../theme';

export default function ModelCompare() {
    const { a, b } = useLocalSearchParams<{ a: string; b: string }>();
    const router = useRouter();
    const styles = useThemedStyles(sheets);
    const [models, setModels] = useState<CatalogModel[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        let live = true;
        setFailed(false);
        setModels(null);
        Promise.all([fetchCatalog(), fetchPremiumModels().catch(() => [])]).then(
            ([open, premium]) => { if (live) setModels([...open, ...premium]); },
            () => { if (live) setFailed(true); },
        );
        return () => { live = false; };
    }, [attempt]);
    const left = typeof a === 'string' ? models?.find(model => model.id === internalModelId(a)) : undefined;
    const right = typeof b === 'string' ? models?.find(model => model.id === internalModelId(b)) : undefined;
    const valid = left && right && canCompare(left, right);
    const title = valid ? t('modelCompare.pair', { a: left.name, b: right.name }) : t('modelCompare.title');
    const all = <Button variant="secondary" label={t('modelPage.all')} onPress={() => router.push('/models')} style={styles.target} />;
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Stack.Screen options={{ title }} />
            {failed ? <>
                <Text accessibilityRole="alert">{t('catalog.failed')}</Text>
                <Button label={t('acct.mfa.retry')} onPress={() => setAttempt(n => n + 1)} style={styles.target} />
            </> : !models ? <ActivityIndicator accessibilityLabel={t('catalog.loading')} /> : !valid ? <>
                <Text>{t('modelCompare.unavailable')}</Text>
                {all}
            </> : <>
                <Text variant="title1" accessibilityRole="header">{title}</Text>
                {compareRows(left, right).map(row => {
                    const lines = row.values.map((value, index) => t('modelCompare.value', { name: index === 0 ? left.name : right.name, value }));
                    const spokenLines = lines.map(line => rawText(line).replace(/[.。]$/, ''));
                    return <Card key={row.label} accessible accessibilityLabel={rawText(`${row.label}. ${spokenLines.join('. ')}`)} style={styles.row}>
                        <Text variant="bodyStrong">{row.label}</Text>
                        <Text>{lines[0]}</Text>
                        <Text>{lines[1]}</Text>
                    </Card>;
                })}
                {[left, right].map(model => <Button key={model.id} label={t('modelPage.generate', { title: model.name })}
                    onPress={() => router.push({ pathname: '/create/[modelId]', params: { modelId: model.id } })} style={styles.target} />)}
                {all}
            </>}
        </ScrollView>
    );
}

const sheets = themedStyles(p => ({
    screen: { flex: 1, backgroundColor: p.bg },
    content: { padding: 16, paddingBottom: 16 + LIST_END_PADDING, gap: 16 },
    target: { minHeight: MIN_TARGET },
    row: { gap: 8 },
}));
