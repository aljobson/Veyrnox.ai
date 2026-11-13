import { Stack } from 'expo-router';
import { View } from 'react-native';
import { useSyncExternalStore } from 'react';
import { PHOTO_STUDIO_ENABLED } from '../../lib/photoStudioFlag';
import { getCacheUser, subscribeCacheUser } from '../../lib/appCache';
import { t } from '../../lib/i18n';
import { Text } from '../../components/ui';
import { ds } from '../../theme';
// The route itself gates deep links. Disabled builds never load Skia, WebView or media APIs.
export default function LiveEditRoute() {
    const owner = useSyncExternalStore(subscribeCacheUser, getCacheUser, getCacheUser);
    if (!PHOTO_STUDIO_ENABLED || !owner) return <View style={{ padding: ds.space.gutter }}>
        <Stack.Screen options={{ title: t('liveEdit.title') }} />
        <Text accessibilityRole="alert">{t('liveEdit.unavailable')}</Text>
    </View>;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { LiveEditScreen } = require('../../components/liveEdit/LiveEditScreen') as typeof import('../../components/liveEdit/LiveEditScreen');
    return <LiveEditScreen key={owner} owner={owner} />;
}
