import { Stack } from 'expo-router';
import { useSyncExternalStore } from 'react';
import { View } from 'react-native';
import { FaceRetouchScreen } from '../../components/liveEdit/FaceRetouchScreen';
import { getCacheUser, subscribeCacheUser } from '../../lib/appCache';
import { t } from '../../lib/i18n';
import { ds } from '../../theme';
import { Text } from '../../components/ui';

export default function FaceRetouchRoute() {
    const owner = useSyncExternalStore(subscribeCacheUser, getCacheUser, getCacheUser);
    if (!owner) return <View style={{ padding: ds.space.gutter }}><Stack.Screen options={{ title: t('liveEdit.tool.retouch') }} />
        <Text accessibilityRole="alert">{t('liveEdit.unavailable')}</Text></View>;
    return <FaceRetouchScreen key={owner} owner={owner} />;
}
