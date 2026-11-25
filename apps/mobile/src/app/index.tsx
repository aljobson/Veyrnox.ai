import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { readPreAuthOnboarding } from '../lib/preAuthOnboarding';
import { colors } from '../theme';

export default function Index() {
    const { status } = useAuth();
    const [signedOutDestination, setSignedOutDestination] = useState<'onboarding' | 'sign-in' | 'personalised' | 'preview' | null>(null);
    useEffect(() => {
        if (status !== 'signedOut') return;
        let alive = true;
        void readPreAuthOnboarding().then((onboarding) => {
            if (alive) setSignedOutDestination(
                !onboarding.completed
                    ? 'onboarding'
                    : onboarding.resume === 'preview'
                        ? 'preview'
                        : onboarding.pending
                            ? 'personalised'
                            : 'sign-in',
            );
        });
        return () => { alive = false; };
    }, [status]);
    if (status === 'loading' || (status === 'signedOut' && signedOutDestination === null)) {
        return (
            <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center' }}>
                <ActivityIndicator color={colors.accent} />
            </View>
        );
    }
    if (status === 'signedIn') return <Redirect href="/(app)/(tabs)" />;
    if (signedOutDestination === 'preview') return <Redirect href="/preview" />;
    if (signedOutDestination === 'personalised') return <Redirect href={{ pathname: '/sign-in', params: { from: 'onboarding' } }} />;
    return <Redirect href={signedOutDestination === 'onboarding' ? '/onboarding' : '/sign-in'} />;
}
