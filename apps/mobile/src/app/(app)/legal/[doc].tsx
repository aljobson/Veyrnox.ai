import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { LegalDocumentView } from '../../../components/legal/LegalDocumentView';
import { Text } from '../../../components/ui';
import { isLegalDoc, legalData } from '../../../lib/legal';
import { getLocale, t } from '../../../lib/i18n';

export default function LegalScreen() {
    const { doc, locale, anchor } = useLocalSearchParams<{ doc: string; locale?: string; anchor?: string }>();
    const router = useRouter();
    if (!isLegalDoc(doc)) return <Text>{t('common.error')}</Text>;
    const language = typeof locale === 'string' ? locale : getLocale();
    return <>
        <Stack.Screen options={{ title: legalData(doc, language).messages.title }} />
        <LegalDocumentView doc={doc} locale={language} anchor={typeof anchor === 'string' ? anchor : undefined} onNavigate={location => router.push({ pathname: '/legal/[doc]', params: location })} />
    </>;
}
