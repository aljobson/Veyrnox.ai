import { Stack, router } from 'expo-router';
import { ScrollView, Share, View } from 'react-native';
import { AddressText } from '../../components/AddressText';
import { Button, Card, Chip, Text, themedStyles, useThemedStyles } from '../../components/ui';
import { t } from '../../lib/i18n';
import { ds } from '../../theme';
const API = 'https://veyrnox.ai/api/v1/developer';
const OAUTH_METADATA = 'https://veyrnox.ai/.well-known/oauth-protected-resource/api/v1/developer';
const OPENAPI = 'https://veyrnox.ai/api/developer/openapi';
const COMMANDS = ['pipx install "git+https://github.com/aljobson/Veyrnox.ai.git#subdirectory=agent-harness"', 'veyrnox auth login', 'veyrnox models list', 'veyrnox generations create --model nano-banana-kie --prompt "A blue fox"'];
const endpoints = [
    ['GET', '/models', 'developers.ep.models'], ['POST', '/estimates', 'developers.ep.estimates'],
    ['POST', '/generations', 'developers.ep.generations'], ['GET', '/generations/{id}', 'developers.ep.poll'],
    ['GET', '/generations/{id}/asset', 'developers.ep.asset'], ['GET', '/balance', 'developers.ep.balance'],
] as const;
function ShareButton({ value }: { value: string }) {
    return <Button variant="tertiary" size="sm" label={t('developers.share')} onPress={() => { void Share.share({ message: value }).catch(() => {}); }} />;
}
export default function Developers() {
    const s = useThemedStyles(sheets);
    return <ScrollView style={s.screen} contentContainerStyle={s.content}>
        <Stack.Screen options={{ title: t('developers.row') }} />
        <Text variant="micro" tone="accent">{t('developers.kicker')}</Text>
        <Text variant="display" accessibilityRole="header">{t('developers.title')}</Text>
        <Text variant="body" tone="secondary">{t('developers.lead')}</Text>
        <Card style={s.section}>
            <Text variant="title2" accessibilityRole="header">{t('developers.cli.kicker')}</Text>
            <Text variant="title3" accessibilityRole="header">{t('developers.cli.title')}</Text>
            {COMMANDS.map(command => <View key={command} style={s.well}><Text variant="footnote" selectable>{command}</Text><ShareButton value={command} /></View>)}
            <Text variant="footnote" tone="secondary">{t('developers.cli.note')}</Text>
        </Card>
        <View style={s.section}>
            <Text variant="micro" tone="accent">{t('developers.api.kicker')}</Text>
            <Text variant="title2" accessibilityRole="header">{t('developers.api.title')}</Text>
            <AddressText address={API} /><ShareButton value={API} />
            {endpoints.map(([method, path, key]) => <View key={path} style={s.section}>
                <View style={s.row}><Chip label={method} /><Text variant="bodyStrong" selectable>{path}</Text></View>
                <Text variant="footnote" tone="secondary">{t(key)}</Text>
            </View>)}
        </View>
        <View style={s.section}>
            <Text variant="micro" tone="accent">OAuth 2.1 + PKCE</Text>
            <Text variant="title2" accessibilityRole="header">{t('developers.oauth.title')}</Text>
            <Text variant="footnote" tone="secondary">{t('developers.oauth.p')}</Text>
            <AddressText address={OAUTH_METADATA} /><ShareButton value={OAUTH_METADATA} />
            {(['s1', 's2', 's3'] as const).map(step => <View key={step} style={s.section}>
                <Text variant="bodyStrong">{t(`developers.oauth.${step}.head`)}</Text>
                <Text variant="footnote" tone="secondary">{t(`developers.oauth.${step}.body`, { code: step === 's1' ? 'token_endpoint_auth_method: none' : 'Authorization: Bearer …' })}</Text>
            </View>)}
        </View>
        <Card style={s.section}>
            <Text variant="micro" tone="accent">{t('developers.safety.kicker')}</Text>
            <Text variant="title2" accessibilityRole="header">{t('developers.safety.title')}</Text>
            <Text variant="footnote" tone="secondary">{t('developers.safety.p1', { code: 'confirmed_credits' })}</Text>
            <Text variant="footnote" tone="secondary">{t('developers.safety.p2')}</Text>
            <Text variant="footnote" tone="secondary">{t('developers.safety.p3')}</Text>
        </Card>
        <Button variant="secondary" label={t('developers.models')} onPress={() => router.push('/models')} />
        <Button variant="secondary" label={t('developers.mcp')} onPress={() => router.push('/mcp')} />
        <AddressText address={OPENAPI} />
    </ScrollView>;
}
const sheets = themedStyles(p => ({
    screen: { flex: 1, backgroundColor: p.bg }, content: { padding: ds.space.lg, paddingBottom: ds.space.huge, gap: ds.space.lg },
    section: { gap: ds.space.md }, row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: ds.space.sm },
    well: { backgroundColor: p.bgElevated2, padding: ds.space.md, borderRadius: ds.radius.md, gap: ds.space.sm },
}));
