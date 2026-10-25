import { Stack } from 'expo-router';
import { CinemaHome } from '../../../components/cinema/CinemaHome';
import { t } from '../../../lib/i18n';

// Social Cinema is a drawer destination rather than one of the five bottom tabs.
export default function Cinema() {
    return <><Stack.Screen options={{ title: t('menu.cinema') }} /><CinemaHome /></>;
}
