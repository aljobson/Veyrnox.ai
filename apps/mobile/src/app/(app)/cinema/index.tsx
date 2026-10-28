import { useEffect } from 'react';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { CinemaHome } from '../../../components/cinema/CinemaHome';
import { t } from '../../../lib/i18n';

// Social Cinema is a drawer destination rather than one of the five bottom tabs.
export default function Cinema() {
    const { section } = useLocalSearchParams<{ section?: string }>();
    const sections = ['watch', 'series', 'vote', 'saved', 'following', 'winners', 'profile'] as const;
    const requestedSection = sections.find(key => key === section) ?? null;
    useEffect(() => { if (requestedSection !== null) router.setParams({ section: undefined }); }, [requestedSection]);
    return <><Stack.Screen options={{ title: t('menu.cinema') }} /><CinemaHome requestedSection={requestedSection} /></>;
}
