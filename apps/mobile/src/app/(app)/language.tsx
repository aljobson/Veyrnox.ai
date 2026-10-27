import { Stack } from 'expo-router';
import { LanguageChoice } from '../../components/LanguageChoice';
import { t } from '../../lib/i18n';
export default function Language() {
    return <><Stack.Screen options={{ title: t('language.title') }} /><LanguageChoice returnPath="/language" /></>;
}
