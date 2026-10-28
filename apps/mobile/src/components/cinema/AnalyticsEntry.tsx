import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { useAuth } from '../../auth/AuthProvider';
import { creatorAnalyticsOpen } from '../../lib/cinemaViewer';
import { t } from '../../lib/i18n';
import { Button, Card, Text } from '../ui';

export function AnalyticsEntry() {
    const { api } = useAuth();
    const router = useRouter();
    const [open, setOpen] = useState(false);
    useEffect(() => {
        let live = true;
        setOpen(false);
        void creatorAnalyticsOpen(api).then(value => { if (live) setOpen(value); });
        return () => { live = false; };
    }, [api]);
    return open ? <Card style={{ gap: 8 }}>
        <Text variant="title3" accessibilityRole="header">{t('cinema.creatorAnalytics.yourAudience')}</Text>
        <Button variant="secondary" label={t('cinemaCreator.analytics.open')} onPress={() => router.push('/cinema/analytics')} />
    </Card> : null;
}
