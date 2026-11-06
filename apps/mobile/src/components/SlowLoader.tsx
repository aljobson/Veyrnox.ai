import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { t } from '../lib/i18n';
import { useAnnouncement } from '../lib/useAnnouncement';
import { colors } from '../theme';
import { Action } from './account/shared';
import { Text } from './ui/Text';

export const SLOW_AFTER_MS = 8000;
export const TIMEOUT_AFTER_MS = 20000;

export type LoadPhase = 'loading' | 'slow' | 'timeout';

export function loadPhase(elapsedMs: number): LoadPhase {
    return elapsedMs >= TIMEOUT_AFTER_MS ? 'timeout' : elapsedMs >= SLOW_AFTER_MS ? 'slow' : 'loading';
}

// A spinner that explains itself: after 8 s it says it is still loading, after 20 s it offers Try again.
// Mount it with a fresh `key` per attempt so the clock restarts when the person retries.
export function SlowLoader({ label, onRetry }: { label?: string; onRetry: () => void }) {
    const [phase, setPhase] = useState<LoadPhase>('loading');
    useEffect(() => {
        const slow = setTimeout(() => setPhase('slow'), SLOW_AFTER_MS);
        const late = setTimeout(() => setPhase('timeout'), TIMEOUT_AFTER_MS);
        return () => { clearTimeout(slow); clearTimeout(late); };
    }, []);
    const message = phase === 'timeout' ? t('loading.timeout') : phase === 'slow' ? t('loading.still') : null;
    // iOS ignores accessibilityLiveRegion on native views, so the change is announced explicitly.
    useAnnouncement(message);
    return (
        <View style={{ gap: 12, padding: 16 }}>
            {phase === 'timeout' ? null : <ActivityIndicator color={colors.accent} accessibilityLabel={label} />}
            {message ? <Text variant="inherit" style={{ color: colors.muted, fontSize: 14 }} accessibilityRole="alert">{message}</Text> : null}
            {phase === 'timeout' ? <Action label={t('recovery.retry')} onPress={onRetry} /> : null}
        </View>
    );
}
